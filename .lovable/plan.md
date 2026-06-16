## Goal

Multi-day shifts must follow the new rule: **one continuous timed assignment, one final payment at End Shift only**. Today, the code bills and opens Monnify on every Pause. This plan removes pause-time billing on both the backend and the requester UI without touching any other lifecycle, ratings, reliability, or admin behaviour.

## Current behaviour (verified)

- `pause_shift` RPC (migration `20260614185952`) closes the open segment, runs `_bill_segment`, adds to `total_billed_amount`, sets `payment_due_at`, resets `payment_status='pending'`, clears `payment_reference/url/paid_at/settled_amount`.
- `resume_shift` RPC (migration `20260614090509`) hard-blocks resume with `"Previous segment must be paid before resuming"` whenever any closed segment is unsettled.
- `end_shift` already closes the final segment, sums `total_billed_amount`, and sets `payment_status='pending'` with a 15-minute `payment_due_at` — this is what we keep.
- Requester UI (`CoverageScreen.tsx` ~L274–321) calls `pause_shift` then opens `ShiftSettlement` in `intent="pause"`, auto-launching Monnify checkout and only flipping local state to "Upcoming" after webhook confirmation.

## Changes

### 1. Backend (new migration)

Redefine **only** `pause_shift` and `resume_shift` (keep `start_shift`, `end_shift`, `_bill_segment`, Monnify webhook, `mark_settlement_paid` untouched).

`pause_shift`:
- Validate requester + status `'active'`.
- Close the open `shift_segments` row (`ended_at = now()`).
- **Do not call `_bill_segment`. Do not touch `total_billed_amount`, `payment_*`, `settled_amount`, `paid_at`, `billing_locked_at`.**
- `UPDATE coverage_requests SET status = 'paused'`.
- Return `{ paused_at }`.

`resume_shift`:
- Validate requester + status `'paused'`.
- **Remove** the "previous segment must be paid" guard entirely.
- Insert next `shift_segments` row with `segment_index = max+1`, `started_at = now()`.
- `UPDATE coverage_requests SET status = 'active', payment_due_at = NULL`.

End-of-shift billing in `end_shift` already sums all closed segments via `_bill_segment` over the final open segment and pre-existing `total_billed_amount`. Because pause no longer bills mid-shift, `total_billed_amount` will be 0 before `end_shift` runs. To keep total billing correct for multi-segment shifts, `end_shift` must bill **every** closed-but-unbilled segment, not just the last one. Update `end_shift` to:

- For each `shift_segments` row where `settled_at IS NULL`, close it if still open and call `_bill_segment`, summing into `total_billed_amount`.
- Then set `status='completed'`, `billing_locked_at=now()`, `payment_due_at=now()+15min`, `settled_amount = total_billed_amount`, `payment_status='pending'`, clear `payment_reference/url/paid_at` (unchanged from today otherwise).

Grants and `SECURITY DEFINER` stay the same. Keep the `app.lifecycle_bypass` pattern so the requester guard trigger still allows the writes.

### 2. Requester UI (`src/features/app/CoverageScreen.tsx`)

- After `callServerPauseShift` resolves, **do not** open `ShiftSettlement`. Instead:
  - Call local `netPauseShift(id)` immediately.
  - `shiftCue("pause")`, `setTab("upcoming")`, show a "Shift paused" notice.
- Remove `settlingIntent = "pause"` branch from `confirmEnd` (the pause path no longer reaches the settlement sheet).
- Leave the End Shift path exactly as is: it still opens `ShiftSettlement` with `intent="end"`, runs Monnify, and only on webhook-confirmed payment moves to History + triggers ratings.
- Update the inline code comments above `callServerPauseShift` / `confirmEnd` to reflect the new "pause = no billing" rule.

No changes to `RequestCard`, timers, doctor `CoverHome`, or `ShiftSettlement` itself. The doctor's Active/Upcoming/History state is already derived from `coverage_requests.status`, which both updated RPCs continue to drive — so both sides stay in sync.

### 3. Timer

The existing accumulated-time model (`accumulated_ms` + open segment with `started_at`) already pauses on `status='paused'` and resumes on the next segment's `started_at`, server-clocked. No changes needed — removing pause-time billing does not affect timer math.

### 4. Out of scope / explicitly unchanged

- `start_shift`, `_bill_segment`, `mark_settlement_paid`, Monnify webhook route, ratings RPCs.
- Doctor app (`CoverHome.tsx`, `CoverDispatchPortal.tsx`).
- Admin dashboards, finance, unpaid, risk.
- Pricing logic in `src/lib/pricing.ts`.
- Cancellation flow.

## Technical details

- One new migration file containing only `CREATE OR REPLACE FUNCTION` for `pause_shift`, `resume_shift`, `end_shift`, preserving signatures and grants.
- One edit to `CoverageScreen.tsx` (~30 lines around the pause flow).
- No schema, table, RLS, or grants changes.
- No new packages, no new server functions, no client API changes.

## Verification

- Manual: requester starts a shift → pauses → no Monnify dialog appears, card moves to Upcoming, doctor side shows Upcoming, timer freezes. Resume → both sides return to Active, timer resumes from prior elapsed. End → Monnify opens with total of all segments → on webhook, both sides move to History with ratings prompt.
- DB: after pause, `coverage_requests.payment_status` stays `NULL`/prior value, `total_billed_amount` stays 0, `shift_segments` row for the closed segment has `settled_at IS NULL`.
- After end + webhook: `payment_status='paid'`, `total_billed_amount` equals sum across all segments, `settled_amount` matches.
