# Make payment confirmation the sole gate for COMPLETED

## Rule we are enforcing

```text
ACTIVE → End Shift → AWAITING_PAYMENT (payment window) → Monnify webhook → COMPLETED
```

`completed` must be reachable **only** from `mark_settlement_paid` (webhook / verify path). End Shift must never write `completed`.

## What's wrong today (observed)

- `end_shift()` writes `status='completed'` + `payment_status='pending'` in one UPDATE.
- DB trigger `_cr_after_status_change` recomputes trust for both parties on that flip.
- Client `dispatch.ts` + `network.ts` arm the rating overlay + PaymentSummary on the same flip.
- `CoverageScreen`, `EarningsScreen`, and dispatch history all treat `status='completed'` as "done / counted as earnings", so the shift jumps to history before the money lands.

## Fix

### 1. DB — introduce `awaiting_payment` status

A single migration that:

1. Adds `'awaiting_payment'` to whatever constraint/check governs `coverage_requests.status` (today it's a text column; verify and either extend the CHECK or, if it's an enum, `ALTER TYPE … ADD VALUE 'awaiting_payment'`).
2. Rewrites `public.end_shift(_request_id uuid)` so the final UPDATE uses `status = 'awaiting_payment'` instead of `'completed'`. Everything else in `end_shift` is unchanged (segment closing, `billing_locked_at`, `total_billed_amount`, `payment_due_at`, `settled_amount`, `payment_status='pending'`, snapshot).
3. Updates `public.mark_settlement_paid(_payment_reference text, _amount int)` so that, in addition to flipping `payment_status='paid'`, it now also performs the status promotion:

   ```sql
   UPDATE coverage_requests
      SET status = 'completed',
          paid_at = now()
    WHERE payment_reference = _payment_reference
      AND status = 'awaiting_payment';
   ```

   The existing day-rollover branch (paused multi-day shifts that flip back to `accepted`) stays intact — those rows are not in `awaiting_payment` so the new clause won't fight it.
4. Leaves `_cr_after_status_change` unchanged. It already fires on `completed | cancelled | no_show`. Because `end_shift` no longer writes `completed`, **trust recalculation now happens only on the webhook-driven `awaiting_payment → completed` transition**, exactly as required.
5. Data backfill (one-off, same migration): rows currently in `status='completed' AND payment_status <> 'paid'` are mid-flow under the old behaviour. Move them to `awaiting_payment` so the new gate is consistent. Rows with `payment_status='paid'` stay `completed`.

### 2. Generated types

After the migration runs, `src/integrations/supabase/types.ts` is regenerated automatically. No manual edit.

### 3. Client — teach the app about `awaiting_payment`

Goal: the doctor's rating overlay, the PaymentSummary, the move-to-history, and the earnings counter must all wait for `status='completed'`, not for End Shift.

Files to touch:

- `src/lib/network.ts`
  - Add `awaiting_payment` to the `NetRequest` status union.
  - In the postgres-changes branch (line ~317): keep `newStatus === 'completed'` as the `complete` action trigger. **Do not** treat `awaiting_payment` as `complete`. Add a new no-op (or `update`) branch for `* → awaiting_payment` so we don't synthesize a `complete` event prematurely. Same change for the snapshot-diff branch (line ~401): only synthesize `complete` when the new status is `completed`.
- `src/features/cover/dispatch.ts`
  - History pile filter (line ~188) and `pendingRating` arming (line ~259) already key off `status === 'completed'` — leave them. Add `awaiting_payment` to whatever lane represents "shift finished, awaiting payment" so the doctor card still shows the right state but does not move to history or trigger the rating overlay yet.
  - The `ev.action === 'complete'` handler at line ~368 stays gated on the real `complete` action, which now only fires post-webhook.
- `src/features/app/CoverageScreen.tsx`
  - Lines 109, 115, 191, 705, 1014, 1248: anywhere it groups by `status === 'completed'` for history/earnings, ensure `awaiting_payment` is shown in the active/settlement lane, not history.
- `src/features/app/EarningsScreen.tsx`
  - Line 113: keep `outcome === 'completed'` for the earnings total so unpaid shifts don't inflate earnings.
- `src/lib/admin.functions.ts`
  - Admin counters (lines 555, 558, 719): keep `'completed'` as the "done & paid" bucket. Add an `awaiting_payment` bucket if useful for ops visibility, but do not collapse the two.
- `src/features/request/ShiftSettlement.tsx`
  - Now that End Shift is wired to the `endShift` server fn (separate plan), the post-end UI path stays on the settlement screen until `payment_status === 'paid'` (which now also flips status to `completed`). No new logic needed beyond exposing `awaiting_payment` in any status-guarded copy ("Shift finished — awaiting payment").

### 4. Verification after deploy

1. New shift: start → end. Expect row: `status='awaiting_payment'`, `payment_status='pending'`, `billing_locked_at` set, `shift_segments[1].ended_at` set. **No** trust recompute fires (audit `recompute_trust` log / `trust_blocks` last-touched).
2. Doctor's app: rating overlay does **not** appear; shift does **not** jump to history; earnings do **not** increment. Settlement screen shows real amount.
3. Pay via Monnify (or call `verifySettlementPayment`). Expect: `payment_status='paid'`, `status='completed'`, `paid_at` set. **Now** trust recompute fires, rating overlay appears, shift moves to history, earnings increment.
4. Cancel path (`status='cancelled'`) and no-show path (`status='no_show'`) still trigger trust recompute as before — unchanged.

## Out of scope

- The separate fix that wires the End Shift button to the `endShift` server fn (already planned). Both changes are needed; this one is independent and can ship in either order, but the "shift not ready for payment" error only goes away once both are in.
- No fallbacks, no client-side status forcing, no optimistic completion.
