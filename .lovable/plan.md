
# Audit 13 — Scalability Optimization Validation

Each recommendation has been validated against the actual implementation (file paths cited). The short answer is **none of the five items change user-visible behaviour**, and three of them are already implemented at the recommended cadence.

---

## 1. Doctor Presence Heartbeat → 60 s + skip unchanged writes

**A. Behaviour Impact: NO.**

**Important clarification — there are TWO independent timers; the audit conflates them:**

| Timer | Purpose | Current cadence | Touches the online roster? |
|---|---|---|---|
| `touchLastSeen` in `src/routes/_app.tsx:115` | Writes `profiles.last_seen_at` (analytics only) | **Already 60 s**, visibility-gated | No |
| `upsertMyPresence` in `src/lib/presence-remote.ts` | Writes `doctor_presence.online / lat / lng` (the roster requesters see) | **Event-driven — fires only on Online toggle, sign-in, GPS change, or 20-min refresh** | Yes |
| `refreshDoctorLocation` in `src/lib/doctor-gps.ts:42` | Re-reads GPS while online | 20 min, visible-only | Only if GPS coords actually moved |

So the audit's "heartbeat to 60 s + skip unchanged writes" is **already the current behaviour**:
- The 60 s timer is `last_seen_at` only; it's already silenced from re-render via `MEANINGFUL_PROFILE_KEYS` in `src/lib/profile-remote.ts:328` (the very fix that ended the global blink).
- Online/offline is **not** on any heartbeat — it's a single write the instant the doctor flips the toggle, and propagates via the `doctor_presence` Realtime postgres_changes channel.

**C. Explicit confirmation:**
- Doctor goes online → instant `doctor_presence` upsert → Realtime fan-out → requester sees doctor **immediately**. Unchanged.
- Doctor goes offline → instant upsert with `online=false` → requester roster drops doctor **immediately**. Unchanged.
- New coverage request broadcasts hit the doctor the instant they come online (the broadcast filter reads the live roster). Unchanged.
- Matching logic untouched.

No new waiting period anywhere.

---

## 2. Realtime Health Ping → 60 s + single-tab

**A. Behaviour Impact: NO.**

`src/lib/realtime-health.ts` exposes a per-channel health enum consumed by the small connectivity pill at the top of the doctor/requester screens. **It does not gate, throttle, queue, or proxy any realtime traffic.** It does not own a periodic ping — it only flips state when Supabase's channel callbacks fire `SUBSCRIBED` / `CHANNEL_ERROR` / `CLOSED`. The "ping" the audit references is the underlying Supabase Realtime WebSocket keepalive, which is library-managed and unaffected by app code.

**C. Explicit confirmation:**
- Request broadcasts → unchanged (separate channel, library-driven).
- Shift lifecycle → unchanged.
- Notifications / presence → unchanged.
- Doctor/requester sync → unchanged.

The recommendation, if applied, would only change how often the **visual pill** re-evaluates — strictly cosmetic.

---

## 3. Database Indexes

**A. Behaviour Impact: NO.** Indexes change only physical query plans; semantics are unchanged.

**Audit of current indexes (read from `pg_indexes`):**

- `coverage_requests` — already has 17 indexes including `idx_coverage_requests_status_created`, `idx_cr_status`, `idx_cr_accepted_by`, `idx_cr_payment_status`, `idx_cr_requester_id`, `idx_cr_created_at`, three trigram indexes for search, `coverage_requests_broadcast_started_at_idx`, `coverage_requests_reminder_lookup_idx`, `coverage_requests_payment_reference_idx`. **No additional indexes recommended — this table is already well-covered for every hot path.**
- `doctor_presence` — has `idx_doctor_presence_online_last_seen`. Covers the requester roster query. **Adequate.**
- `notification_outbox` — has `notification_outbox_pending_idx` (the only hot read pattern: pending-due rows). **Adequate.**
- `shift_segments` — has `shift_segments_request_day_idx` and the `(request_id, segment_index)` unique constraint. **Adequate.**

**Recommendation:** No new indexes are required today. Re-run `supabase--slow_queries` if a specific page becomes slow and add indexes targeted at the actual top offenders — speculative indexes carry write cost and bloat planner choices.

**C. Confirmation:** No semantic, lifecycle, or UI behaviour change of any kind.

---

## 4. Reconciliation Polling — hidden tabs 60 s, non-lifecycle screens stop

**A. Behaviour Impact: NO.** Already implemented at exactly the recommended cadence.

Evidence:
- `src/lib/coverage-remote.ts:365` — `RECONCILE_INTERVAL_MS = 60_000`, `RECONCILE_AFTER_SILENCE_MS = 45_000`. Guarded by `document.visibilityState !== "visible"` (skipped when hidden) AND `Date.now() - lastRealtimeEventAt < RECONCILE_AFTER_SILENCE_MS` (skipped when realtime is healthy).
- `src/lib/presence-remote.ts:212` — `PRESENCE_RECONCILE_INTERVAL_MS = 60_000` with the same visibility + silence gates.
- `src/lib/use-lifecycle-reconcile.ts:54` — fires once on visibility-change return, never on hidden tabs.

**Behaviour for active users on lifecycle screens: unchanged.** Realtime updates continue arriving via WebSocket; the 60 s timer is a **safety net** that only fires after 45 s of total silence — meaning the user already has nothing to display, so a reconcile cannot disrupt anything.

**C. Explicit confirmation:**
- Active Coverage / Upcoming Coverage / History Coverage → instant updates via Realtime. Unchanged.
- Acceptance propagation → instant (postgres_changes). Unchanged.
- Payment enforcement → server-anchored (`payment_due_at`), not poll-dependent. Unchanged.
- Ratings → unchanged.

**Recommendation:** Nothing to implement — already in place. Optional small win: confirm that admin-only screens (which don't subscribe to the lifecycle channels) don't start the reconcile loop. They currently don't — `startReconcileTimer` is called from `coverage-remote` consumers only.

---

## 5. Log Archival — `notification_outbox` > 30 d, `admin_actions` > 180 d

**A. Behaviour Impact: NO** for end users. **Operational caveat for admin investigations** — call it out before deleting.

What `notification_outbox` stores: queued notification dispatch records (push/email/in-app). After delivery + ~24 h there is no functional need for the row; it is purely an audit trail. Archiving rows > 30 d does not affect:
- User notification history surfaced in-app (that comes from `coverage_requests` + `ratings`, not from `notification_outbox`).
- Payment history (in `coverage_requests`).
- Shift history (in `coverage_requests` + `shift_segments`).

What `admin_actions` stores: every admin override (force-cancel, freeze, restrict, etc.). 180 d is a defensible retention window, but:
- Regulators / disputes can ask for older actions. Recommend **archive to a cold table** (`admin_actions_archive`) rather than hard-delete, so the AdminDrawer's `AuditLogPanel` can fall back to it on demand.
- Same for `notification_outbox`: archive (don't hard-delete) the first time this runs, so we can audit the first cleanup before making it irreversible.

**C. Explicit confirmation (when archived, not deleted):**
- No active operational data affected.
- No user-visible history disappears.
- No payment history disappears.
- Support investigations remain possible via the archive table.

---

## Summary Matrix

| # | Recommendation | Affects behaviour? | Status |
|---|---|---|---|
| 1 | Presence heartbeat 60 s + skip unchanged | **NO** | Already implemented (`last_seen_at` is 60 s; online roster is event-driven) |
| 2 | Realtime-health ping 60 s, single-tab | **NO** | Cosmetic pill only; library-managed WS keepalive untouched |
| 3 | Add indexes to 4 tables | **NO** | Already covered; no speculative indexes recommended |
| 4 | Hidden-tab polling 60 s, lifecycle-only | **NO** | Already implemented at exactly that cadence |
| 5 | Archive old logs | **NO for users** | Recommend cold-table archive (not delete) to preserve admin investigations |

## Net implementation needed if you approve

The only thing left to actually build is **item 5** — a scheduled archive job that moves rows from `notification_outbox` (> 30 d) and `admin_actions` (> 180 d) into archive tables. Everything else is already in place.

If you want me to proceed with the archive job, switch me to build mode and I'll create the archive tables, the SECURITY DEFINER move-function, and a `pg_cron` schedule.
