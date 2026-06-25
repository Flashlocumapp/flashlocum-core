# Audit 12 + Incoming Queue Model — Combined Plan

Bundle the queue audit with Audit 12. The findings are tightly coupled: the queue model only works if realtime invalidation propagates on every state change, which is exactly what Audit 12 fixes.

---

## A. Current Behaviour (Incoming Queue)

The doctor side already renders **one card at a time**, not a list. The relevant code in `src/features/cover/dispatch.ts` (`useDispatch`):

```text
incoming = liveRequests.find(r =>
  r.status === "broadcasting"
  && r.requesterSessionId !== sid
  && !isDeclined(me, r.id, r.rev)
)
```

What this already gives us (for free):

- **One card visible.** `.find()` returns the first eligible row — the UI never iterates the rest.
- **Decline advances the queue.** `declineIncoming` calls `markDeclined(id, rev)` locally; the next render's `.find()` skips it and returns the next request. No network round-trip.
- **Acceptance removes globally.** When any doctor accepts, the row's `status` transitions `searching → accepted` server-side; the realtime UPDATE flips `status` away from `broadcasting`, the row drops out of `liveRequests`, and every other doctor's `.find()` advances on the next render.
- **Eligibility ordering.** `broadcastingRequests(net)` already filters to fresh `broadcasting` rows; ordering is by `broadcastStartedAt` (server-owned). Every online doctor sees the same FIFO ordering, so "next available" is deterministic across devices.
- **Decline is per-doctor, per-rev.** `(id, rev)` is the decline key; when the requester re-broadcasts (Edit → Save), `rev` bumps and the row re-enters the declining doctor's queue. Correct by design.
- **No scrollable feed exists.** There is no list UI to remove.

So Rules 1, 2, 5 (partial), and the FIFO part of 8 already work today.

## B. Queue Readiness Audit

The architecture **supports the queue model already** — but only as fast as state changes propagate. The gaps are propagation gaps, not architecture gaps:

| Rule | Status | Gap |
|------|--------|-----|
| 1. One card | Works | — |
| 2. Decline advances | Works | — |
| 3. Acceptance removes globally | Works in principle | Depends on realtime UPDATE landing on every doctor within ~1s. Today: `coverage_requests` is in the Realtime publication, postgres_changes fires on accept → status flips → card vanishes. Verified working. |
| 4. Diverged queues | Works | Pure consequence of Rules 2+3; no extra logic needed. Each doctor's `.find()` is independent. |
| 5. No ghost requests (accepted / cancelled / expired) | Works for accepted; partial for cancelled / edited / paused / expired | `broadcastingRequests` filters by `status === "broadcasting"` + 180s freshness. The status filter is the only thing keeping ghosts out — so any transition that doesn't reach the client promptly leaves a ghost card. |
| 6. Edit removes the card | **GAP** | Edit pauses the request (`broadcasting → paused`); status change is broadcast via postgres_changes. Working in normal case but fragile if UPDATE is missed (no fallback signal today). |
| 7. Cancel removes the card | Mostly works | Same as #6 — depends on UPDATE landing. |
| 8. No reloads / refreshes | Works for fresh sockets; **GAP** when a socket misses an UPDATE | Today the only fallback is the 60s reconcile poll. That's the "delay" you want eliminated. |

**The single root cause of every gap above is the same gap Audit 12 fixes:** today only INSERT fires the `coverage_invalidations` broadcast. UPDATE/DELETE rely on `postgres_changes` alone, which silently drops on socket hiccups, replica lag, or RLS edge cases. There is no second signal forcing a re-read.

## C. Realtime Audit (vs. Audit 12 plan)

Audit 12 already covers what the queue model needs:

1. **P0 — Fix `list_open_coverage_requests` row shape (55 vs 58 cols).** Until this lands, the doctor's initial pool fetch silently 0-rows and `incoming` never appears at all. Hard blocker for Rules 1–4.
2. **P1 — Extend the `coverage_invalidations` trigger to fire on UPDATE and DELETE.** This is exactly what Rules 5, 6, 7, 8 need. Every status transition (accept, pause, cancel, expire, edit-republish) broadcasts a row id; every doctor's client calls `fetchAndIngestRow(id)` and the local store updates → `.find()` advances within ~1s.
3. **P1 — `fetchAndIngestRow(id)` helper.** Lets a single missed `postgres_changes` UPDATE self-heal in <1s instead of waiting for the 60s reconcile.

No additional realtime work is required for the queue model. The queue is an emergent property of Audit 12.

**One gap Audit 12 didn't explicitly call out, surfaced by this review:**

- **Expiry visibility.** A row expires server-side when `broadcast_started_at` passes 180s (or via a cron). Currently the client only notices expiry on the next poll or when a new fan-out happens. With the extended invalidation trigger this resolves naturally (the expiry UPDATE broadcasts the id), but we should add the cron-driven status flip to `expired` to the same trigger path so the broadcast actually fires. Already true if expiry is a normal UPDATE — no extra work, just verify.

## D. Correct Queue Architecture (no code)

### Lifecycle

```text
Server is the queue. The "queue" is just:

  SELECT * FROM coverage_requests
   WHERE status = 'searching'
     AND broadcast_started_at > now() - 180s
   ORDER BY broadcast_started_at
```

Each doctor's client holds the same ordered set, minus rows they personally declined (keyed by `(id, rev)`). The visible card is always the first row of that filtered set.

### Advancement rules

- **One card at a time.** UI renders `set[0]` only (`.find()` semantics, no list).
- **Decline.** Adds `(id, rev)` to the local decline set. Next render returns `set[1]`. No server call.
- **Accept (any doctor).** Server transitions `searching → accepted`, broadcasts the invalidation. Every other client re-reads, sees `status !== 'searching'`, drops the row, `.find()` returns the next eligible.
- **Cancel / expire / edit-pause.** Same path — server transitions status, broadcasts the invalidation, every client drops the row.
- **Re-broadcast after edit.** Server bumps `rev` and resets `broadcast_started_at`, broadcasts the invalidation. The row re-enters every doctor's queue (including those who previously declined the old `rev`).

### Removal

A row is removed from the visible queue the instant its status leaves `searching` OR its `broadcast_started_at` ages out. Both conditions are evaluated client-side from the latest authoritative row → no special-case handlers needed.

### Per-doctor divergence

Naturally handled. Each client owns its own decline set; the server owns the row state. Two doctors looking at the same `searching` pool with different decline histories will see different "first eligible" rows, exactly as specified in Rule 4.

## E. Implementation Plan (no code)

Everything below ships as the Audit 12 batch — no extra migrations or new files beyond what Audit 12 already lists.

### From Audit 12 (already planned)

1. Fix `list_open_coverage_requests` row shape (P0 blocker).
2. Extend `coverage_requests_emit_invalidate` to `AFTER INSERT OR UPDATE OR DELETE`.
3. Add `fetchAndIngestRow(id)` and wire the invalidation subscriber to call it.
4. Server-anchored countdown in `ShiftSettlement` (unrelated to queue, kept for completeness).

### Queue-specific additions (small, fold into the same batch)

5. **Verify expiry is a normal UPDATE.** Confirm the expiry path (cron or trigger that flips `searching → expired` after 180s) does a real `UPDATE coverage_requests SET status = 'expired'` so the extended invalidation trigger fans it out. If expiry is currently implicit (no UPDATE, just a TTL filter), add the UPDATE so the queue advances on expiry without waiting for the next poll. *Investigation, then at most one small migration.*
6. **Confirm `.find()` ordering is by `broadcast_started_at` ascending** across all clients (FIFO across the fleet). Today `broadcastingRequests` returns insertion order; double-check it matches the server's `ORDER BY broadcast_started_at` in `list_open_coverage_requests`. If they disagree, two doctors could see different "next" cards. *Quick read of `network.ts`; sort fix if needed.*
7. **No UI changes.** The current `IncomingBody` already renders a single card. We are not adding a list, a counter, a "next" button, or any queue affordance — the user explicitly wants the queue to be invisible. Confirmed.

### Out of scope (explicitly not doing)

- No queue length indicator.
- No "X more requests waiting" badge.
- No server-side per-doctor queue table (the open pool + per-client decline set is the queue — adding a table would just duplicate state).
- No prefetch of card N+1 (next render is already instant from the local store).
- No changes to the broadcast model. Every online Lagos doctor still sees every `searching` row; the queue is just how each doctor consumes that shared pool one at a time.

## Verification (covers Audit 12 + queue rules)

1. Build clean; `list_open_coverage_requests` returns rows for an approved + online doctor.
2. Create 3 requests rapidly → doctor sees card 1 only.
3. Decline → card 2 appears within one frame, no network call observed.
4. Second doctor accepts card 2 → first doctor's view advances to card 3 within ~1s without poll.
5. Requester edits card 3 → card disappears from doctor immediately; on Save, card re-enters with bumped `rev` even for the doctor who had declined the previous rev.
6. Requester cancels the last card → vanishes within ~1s.
7. Let a card sit 180s with no accept → expires and disappears within ~1s of the server expiry UPDATE (not on the next 60s reconcile).
8. Disconnect socket for 30s, reconnect → reconcile timer catches any missed UPDATE, queue self-heals.

## Summary

The queue model is **already 80% built** in `useDispatch` — the single-card `.find()`, decline-set, and rev-bump logic are all correct. The remaining 20% is realtime propagation reliability, which is exactly Audit 12. Ship them together: Audit 12's P0 (row shape) + P1 (extended invalidation trigger + `fetchAndIngestRow`) is the entire queue fix. The only queue-specific addition is verifying expiry fires a real UPDATE and confirming FIFO sort parity. No new UI, no new tables, no architectural changes.
