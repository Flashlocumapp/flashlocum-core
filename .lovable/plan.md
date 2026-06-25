## Audit summary

### Issue 1 — "Reconnecting…" pill stuck after payment + rating

`ReconnectingPill` (`src/features/app/CoverageScreen.tsx:211`) is driven by `realtime-health` which exposes three channel keys: `coverage`, `invalidations`, `presence`. It shows when any of them is in `reconnecting` for ≥ 800 ms.

Tracing each watchdog in `src/lib/coverage-remote.ts`:

- **`coverage` channel** (line 743) — on `CHANNEL_ERROR/TIMED_OUT/CLOSED`, calls `scheduleReconnect("coverage", run)`. `run` invokes `ensureChannelForUser`, which re-enters the same full subscribe (error states handled recursively). Self-healing — OK.
- **`invalidations` channel** (line 850) — first subscribe is correct, but the **re-subscribe inside `scheduleReconnect("invalidations", …)` at line 869 only handles `SUBSCRIBED`**. If the rebuilt channel ever emits `CHANNEL_ERROR / TIMED_OUT / CLOSED` (mobile flap, server-side socket reset after a burst of post-payment row updates, etc.), nothing reschedules another reconnect and nothing flips health back to `ok`. The pill is left permanently at `reconnecting`.
- **`presence` channel** (`src/lib/presence-remote.ts:250`) — `openPresenceChannel` is recursive via `schedulePresenceReconnect` → `openPresenceChannel`. Self-healing — OK.

This matches the reported behaviour: it appears specifically *after* the payment/rating flow because that flow generates a burst of `coverage_invalidations` broadcasts (`mark_settlement_paid` → row update trigger → multiple invalidate messages) which is the exact moment the broadcast channel is most likely to flap and trip the buggy re-subscribe path.

The recent realtime.messages policy is verified correct (SELECT for `topic='coverage_invalidations'` is allowed for `authenticated`), so the channel will subscribe successfully on retry — the only thing missing is the retry itself.

### Issue 2 — Doctor-side History re-opens rating modal on completed shifts

In `DoctorCoverageDetail` (`src/features/app/CoverageScreen.tsx:1525`) the gate is:

```ts
const showRating = isHist(item) && item.outcome === "completed" && item.rating === undefined;
```

`item.rating` comes from `derivedHistory[].rating = historyRatings[r.id]` in `src/features/cover/dispatch.ts:220`. `historyRatings` is an **in-memory object** populated only by `recordHistoryRating()` in the current tab. It is never:
- hydrated from the `ratings` table,
- persisted to `sessionStorage`/`localStorage`,
- updated by realtime when a rating is written.

Consequences:
1. Page refresh / new tab / app reopen → `historyRatings = {}` → every completed shift re-shows the rating form, even though the rating exists in the DB.
2. After the post-shift `RatingOverlay` in `CoverDispatchPortal` submits, it does call `recordHistoryRating(...)` — that hides it within the session, but the bug returns on the next reload, exactly matching "initially shows submitted, later opens again".

The requester side already solved this with `rated-shifts.ts` (`isRated` + `markRated` + DB hydration via `hydrateRatedShifts`). The doctor history path was never wired to it. The submit handler at line 1652-1658 also doesn't call `markRated`.

## Fix plan

### Fix 1 — Invalidations re-subscribe self-healing

In `src/lib/coverage-remote.ts`, extract the invalidations subscribe into a single internal helper (e.g. `openInvalidationChannel()`) that:

- Creates the channel + binds the `invalidate` broadcast handler.
- In its `.subscribe()` callback handles **all** lifecycle statuses:
  - `SUBSCRIBED` → `resetBackoff("invalidations")` + `setChannelHealth("invalidations", "ok")`.
  - `CHANNEL_ERROR | TIMED_OUT | CLOSED` → `scheduleReconnect("invalidations", openInvalidationChannel)`.

Then use this helper both for the initial subscribe (replace the block at lines 845-877) and for the watchdog `run` callback, eliminating the broken inner subscribe. This mirrors how the `coverage` and `presence` channels already self-heal.

No change to security, RLS, broadcast topic, or message contract.

### Fix 2 — Doctor history rating persistence

1. In `src/features/app/CoverageScreen.tsx` `DoctorCoverageDetail`:
   - Import `isRated`, `markRated`, `useRatedShiftsVersion` from `@/lib/rated-shifts` (already used elsewhere in the file).
   - Subscribe via `useRatedShiftsVersion()` inside `DoctorCoverage` so the list re-renders when hydration completes.
   - Change the gate to `showRating = isHist(item) && item.outcome === "completed" && item.rating === undefined && !isRated(item.id)`.
   - In the submit `onClick` (line 1654), after `recordHistoryRating(item.id, rating)` also call `markRated(item.id)`.
2. `hydrateRatedShifts()` already pulls every row from `ratings` where `rater_user_id = auth.uid()` — covers both doctor- and requester-submitted ratings, so no DB or RPC change is needed. The doctor will see "already rated" on reload because the same shared store is used.
3. Show a small "You've already rated this coverage" line in the `DoctorCoverageDetail` body when the gate is hidden because of `isRated`, mirroring the requester `HistoryDetailSheet` UX, so the detail doesn't look empty.

### Verification

- Issue 1: After completing a shift and submitting payment + rating end-to-end, the pill must not appear once channels are healthy. Force a CLOSED state (simulate by toggling network) twice in a row and confirm the pill clears within < 1 s of reconnection. Console must show one `setChannelHealth("invalidations", "ok")` per reconnect cycle.
- Issue 2: Submit a rating from `RatingOverlay`, hard-refresh the doctor app, open History → the modal must NOT reappear; the detail shows "You've already rated this coverage." Repeat across browser session (sessionStorage) and after clearing storage (DB hydration path).

## Scope / non-goals

- No database migration.
- No change to rating RPC, trust scoring, or notification logic.
- No change to channel topic names or broadcast payload shape.
- Only files touched: `src/lib/coverage-remote.ts` and `src/features/app/CoverageScreen.tsx`.
