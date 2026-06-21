
# Scalability Assessment — Realtime, Presence, Invalidations

Honest read of the current design plus a staged remediation plan. No code has changed yet; this is the proposal you asked for.

---

## 1. Real-time scaling capacity

Current shape:
- Every signed-in client opens **2 Supabase Realtime channels**: `coverage_requests` (postgres_changes, filtered) and `doctor_presence_changes` (postgres_changes, table-wide `event:"*"`).
- Doctors additionally receive an `invalidate` broadcast on `coverage_invalidations` triggered by `coverage_requests_emit_invalidate`.
- `presence-remote` subscribes to the **entire `doctor_presence` table** (no filter); RLS gates rows but the fan-out still happens server-side.

Verdict against your targets:

| Target | Verdict | Why |
|---|---|---|
| 10,000 concurrent doctors | **Will not hold on Supabase Realtime defaults.** | Supabase Realtime soft-caps around ~10k concurrent connections per project on standard plans, and `postgres_changes` is the most expensive subscription type (each WAL row is evaluated per subscriber). 10k doctors × 2 channels = 20k subs minimum. |
| 1,000 shift updates / minute | **Borderline.** | Each `UPDATE` on `coverage_requests` fans out to every subscribed doctor via `postgres_changes`, plus a `broadcast` fan-out. At ~17/sec sustained with 10k subscribers that's ~170k messages/sec egress — well past the realtime tenant ceiling. |
| Bottleneck point | **~1.5k–2k concurrent doctors** with current `postgres_changes`-heavy design, or sooner if a single shift edit storm hits (rev bump on every edit republishes). |

---

## 2. Presence system scalability

- `doctor_presence` subscribed table-wide → every heartbeat UPDATE (25s cadence per doctor) is fanned out to every other subscriber. At 10k online doctors that's **~400 writes/sec × 10k subscribers = 4M msgs/sec** theoretical fan-out. RLS filters reads, not the WAL evaluation cost.
- Heartbeat cadence 25s + 90s cron expiry is correct in concept but the cron job `expire_stale_doctor_presence` runs an unbounded `UPDATE ... WHERE last_seen < now()-90s`. Under load this becomes a long-running write that competes with heartbeats for row locks.
- No batching, no `presence` channel (Supabase's purpose-built presence primitive is unused).

**Degradation point:** noticeable jitter around **500–1000 concurrent online doctors**; lock contention on `doctor_presence` and realtime egress become the dominant cost.

---

## 3. Invalidation broadcast load

- `coverage_requests_emit_invalidate` fires on every status/rev/broadcast_started_at change → one broadcast per change to the `coverage_invalidations` topic, received by **every** doctor.
- `bump_request_rev_on_change` bumps `rev` on every material edit while `status IN (searching,paused)` — a requester rapidly editing an offer produces a broadcast storm proportional to keystrokes-as-edits.
- No debouncing, no batching, no per-doctor targeting (geographic / role / availability scoping is done client-side after delivery).

**Storm risk:** real. A national rollout with 200 simultaneous requesters editing offers ≈ tens of broadcasts/sec, each multiplied by every online doctor.

---

## 4. Database load under high activity

- Each accept goes through `claim_coverage_request` (SECURITY DEFINER, single UPDATE with `WHERE status='searching' AND accepted_by IS NULL`) — that part is correct and race-safe.
- Hot paths that will hurt at scale:
  - `coverage_requests` has many wide triggers (`bump_request_rev_on_change`, `_cr_enforce_account_restriction`, `_lock_rate_on_insert`, `coverage_requests_emit_invalidate`) — every UPDATE pays all of them.
  - `_auto_advance_day_boundary` and `drain_surcharge_due` are cron jobs doing `FOR UPDATE` loops up to 200 rows; fine today, will need pagination + batching at >5k active shifts.
  - `list_open_coverage_requests` returns up to 500 rows on every reconnect for every doctor — at scale this is the dominant read.

---

## 5. Polling-removal impact (the most important risk)

This is where the current design is most fragile. After the recent removal of polling fallback:

- `coverage-remote` and `network.ts` rely on the realtime SUBSCRIBED callback to reconcile state on reconnect. If the websocket drops and silently fails to resubscribe (Supabase has had cases where `CHANNEL_ERROR`/`TIMED_OUT` arrives but reconnect backoff stalls), **Incoming Coverage can stay stale indefinitely**.
- `doctor_presence` rows can be flipped offline server-side by cron, and if the realtime channel is dead the doctor's UI still shows themselves "online" — they'll think they're receiving offers when they aren't.
- `ShiftSettlement` still has an adaptive billing fallback (good); `CoverageScreen` does not.
- **There is no last-resort reconciliation timer.** A single dropped websocket = stale UI until manual refresh.

This is the single highest-priority fix regardless of scale plans.

---

## 6. Overall verdict

**Not production-scalable for a Nigeria-wide rollout as-is.** It is fine for Lagos pilot scale (low hundreds of concurrent doctors). What breaks first, in order:

1. **Realtime fan-out on `doctor_presence` table-wide subscription** — first symptom around 500–1000 online doctors: presence updates lag, then drop.
2. **`coverage_invalidations` broadcast storms** during edit-heavy periods — first symptom around 200+ concurrent requesters.
3. **Per-doctor `postgres_changes` on `coverage_requests`** — first symptom around 1.5k–2k online doctors: missed events, reconnect storms after any Supabase Realtime hiccup.
4. **Silent stale UI** from realtime drops — can happen *today* at any scale; not load-dependent.

---

## Remediation plan (staged)

### Stage 0 — Safety net (do first, small, low-risk)

Goal: eliminate the "silent stale UI" class of bug regardless of future redesign.

1. **Reconciliation timer in `coverage-remote.ts` and `presence-remote.ts`.**
   - Low-frequency safety poll: every **60s when tab visible**, paused when hidden, and a one-shot fetch on `visibilitychange → visible` and on `online` events.
   - This is *not* the old per-second poll — it's a slow heartbeat that re-fetches the snapshot only if `(now - lastRealtimeEventAt) > 45s`.
2. **Channel health watchdog.** When `channel.subscribe` returns `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED`, force `removeChannel` + re-subscribe with capped exponential backoff (1s → 30s) and a visible "Reconnecting…" indicator in CoverageScreen.
3. **Heartbeat-driven self-check.** After each heartbeat, if our own `doctor_presence.online` row read back disagrees with local state, trust the server and surface a toast.

### Stage 1 — Cut realtime fan-out (medium effort)

4. **Replace table-wide `doctor_presence` postgres_changes with Supabase Presence channel** (`channel.track({...})`). Presence is gossip-based, scales O(participants) per region, and removes WAL fan-out entirely for heartbeats. Keep the `doctor_presence` table only as a recovery snapshot, written every ~2 minutes instead of every 25s.
5. **Targeted `coverage_requests` subscriptions.** Doctors subscribe with a `filter` scoped to their service area (state/region), not table-wide. Add a `region` column + index; partition broadcasts.
6. **Debounce `bump_request_rev_on_change`.** Only bump `rev` + `broadcast_started_at` once per request per 2s window; collapse keystroke-storm edits.

### Stage 2 — Move fan-out off Postgres (larger redesign, once Stage 1 metrics justify it)

7. **Edge-function fanout via a dedicated message bus.** Put a Cloudflare Worker (or Supabase Edge Function) in front of `coverage_invalidations`. Triggers `NOTIFY` once; the worker maintains per-region SSE/WebSocket rooms and pushes a *coalesced* "something changed since cursor X" message every 250ms max. Clients then pull only their own slice via `list_open_coverage_requests`. This decouples DB write rate from client fan-out cost.
8. **Read-side caching.** `list_open_coverage_requests` results cached per region for 1s in the edge worker; cuts duplicate reads on reconnect storms.
9. **Cron jobs become incremental.** `expire_stale_doctor_presence`, `drain_surcharge_due`, `_auto_advance_day_boundary` move to keyset-paginated batches with `FOR UPDATE SKIP LOCKED`.

### Load thresholds the plan unlocks

| Stage | Safe concurrent doctors | Safe edits/min |
|---|---|---|
| Today | ~500 | ~100 |
| After Stage 0 | ~500 (same, but no silent staleness) | ~100 |
| After Stage 1 | ~5,000 | ~600 |
| After Stage 2 | 50,000+ | 5,000+ |

---

## What I'd build first if you approve

Only Stage 0 in this first pass — it is small, reversible, and removes the most dangerous failure mode (silent stale UI) without touching architecture. Concretely:

- `src/lib/coverage-remote.ts`: add `lastRealtimeEventAt` watermark, 60s visibility-gated reconciliation, channel health watchdog, exponential reconnect.
- `src/lib/presence-remote.ts`: same watchdog + reconciliation; trust-server self-check after heartbeat.
- `src/features/app/CoverageScreen.tsx`: small "Reconnecting…" pill when watchdog is in backoff.

Stage 1 and Stage 2 are separate approvals — they involve a schema change (region column), pricing-time DB migration, and an edge worker, and I want metrics from Stage 0 before committing to them.

### Out of scope for this plan

- No changes to `claim_coverage_request`, billing, Monnify, or settlement code.
- No changes to RLS or auth.
- No changes to admin dashboards.
