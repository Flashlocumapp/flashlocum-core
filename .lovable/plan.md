## Findings

1. **Surcharge/payment page is still stale**
   - The latest database function does clear `payment_account`, `payment_reference`, and advances `payment_due_at`, but the cron endpoint is failing repeatedly with: `cannot cast type record to coverage_requests`.
   - That error comes from `drain_surcharge_due()` passing a loop `record` into `_surcharge_block_amount(rec)`, where the helper expects a `coverage_requests` row type.
   - Evidence: the current awaiting-payment request still has `payment_extension_count = 0`, old `payment_due_at`, and cached account/reference still present after expiry.
   - Client-side issue also remains: the billing poll only updates internal refs, not React state/props, so even when the server changes, the visible amount/timer/account may not reliably re-render.

2. **Info icon wording**
   - Wording is hardcoded in two places:
     - `RequesterHome.tsx` for requester rating/reliability.
     - `CoverHome.tsx` for doctor rating/reliability.

3. **Delete Account modal style**
   - `DeleteAccountSheet` is currently an account-page bottom sheet (`absolute inset-0 flex items-end`) rather than the existing app confirmation modal style used by Pause Shift / End Shift (`ConfirmDialog` over the page background).

## Implementation plan

### 1. Properly fix surcharge processing
- Add a migration replacing `drain_surcharge_due()` so each loop row is loaded into a typed `public.coverage_requests` variable before calling `_surcharge_block_amount()`.
- Keep the intended behavior:
  - add one surcharge block,
  - advance `payment_due_at` by 15 minutes,
  - increment `payment_extension_count`,
  - clear `payment_account`, `payment_reference`, and `payment_url`,
  - broadcast `coverage_invalidations` with reason `surcharge`.
- Also keep `extend_payment_window()` aligned with the same account-clearing and invalidation behavior.

### 2. Make the payment UI refresh from server truth, not local refs
- In `ShiftSettlement.tsx`, replace the current “ref-only” billing poll with React state for the server billing amount and due time.
- Feed the effective server amount and due time into `CustomTransferPane` so the visible total and countdown re-render when the backend changes.
- When server billing changes after surcharge:
  - clear the old account UI,
  - reset checkout state,
  - force a fresh `beginSettlementCheckout()` call,
  - show the newly minted account/reference and reset timer from the new `payment_due_at`.
- Add an immediate expiry check path so if the visible timer reaches `00:00` before the invalidation lands, the sheet asks the server for fresh billing state instead of sitting stale.

### 3. Update trust info text exactly as requested
- Doctor rating: `Reflects how satisfied requesters are with your service. Minimum: 4.0 stars.`
- Requester rating: `Reflects how satisfied doctors are with their experience working with your facility. Minimum: 3.5 stars.`
- Doctor reliability: `Frequently cancelling accepted shifts may reduce your reliability score. Minimum: 85%.`
- Requester reliability: `Frequently cancelling accepted shifts may reduce your reliability score. Minimum: 75%.`

### 4. Convert Delete Account to modal-over-account pattern
- Refactor the delete-account UI in `AccountScreen.tsx` to use the same modal behavior as Pause Shift / End Shift:
  - account tab remains visible behind the overlay,
  - centered confirmation content,
  - same destructive-button style.
- Preserve existing eligibility rules and final confirmation flow.
- Keep deletion backend logic unchanged.

### 5. Verification
- Check database evidence after migration: `drain_surcharge_due()` no longer returns the cast error, expired pending payments get extension count > 0, updated amount, new due time, and cleared cached account fields.
- Verify the UI code path: server billing updates drive visible amount/timer/account refresh.
- Verify wording locations were updated.
- Verify Delete Account appears as a modal over the Account tab, not a bottom sheet.