# Remediation Plan — Straight Coverage Lifecycle + Stale Payment + 24h/48h Billing

Single plan covering three connected issues:
1. Make `straight_24h` / `straight_48h` behave as one continuous shift (lifecycle).
2. Fix the stale payment-amount display after surcharge.
3. Fix the `₦0` and stale-amount bugs in the 24h / 48h billing engine.

---

## Part A — Straight Coverage as One Continuous Shift

### A1. Booking flow (`src/features/request/RequesterHome.tsx`)
- Hide the `<DaysStepper>` when `coverage === "24h"` or `coverage === "weekend"`. Render it only for `standard` and `home`.
- `setCoverage("weekend")` pins `days = 1` (same pattern already used for `"24h"`). Published booking always has `days = 1` for both straight products.
- No change to `durationHrsOf`: weekend stays at fixed 48h, 24h stays at 24h.

### A2. Server guard — block segmentation for straight products
New migration. In each function, classify with `_effective_product(coverage_type, booked_per_day_min, days)`; if `straight_24h` or `straight_48h`:
- `pause_shift`: return clean no-op error (`reason: 'straight_no_pause'`). No segment close, no status flip.
- `resume_shift`: same — straight shifts are never paused.
- `_auto_advance_day_boundary` cron: skip the row entirely (today it filters only `days > 1`).
- `start_shift` / `end_shift`: unchanged. Straight branches already sum `sum_worked_min` across all segments.

### A3. Client lifecycle UI (`src/features/app/CoverageScreen.tsx`)
Add helper `isStraightProduct(item)` = `coverageKindFromLabel(item.coverage) === "straight24" || "straight48"`.
Gate on `!isStraightProduct(item)`:
- Pause Shift button (compact card ~860, expanded card ~1071).
- "Day X of Y" header (~819, ~1002, ~1426).
- Any client-side day-advance toast.
End Shift / Start Shift stay visible.

---

## Part B — Stale Payment Amount Display

### B1. Surcharge cron fix
Migration replaces `drain_surcharge_due()`:
- Loop rows typed as `public.coverage_requests` (not `record`) so `_surcharge_block_amount(rec)` accepts the row type — eliminates `cannot cast type record to coverage_requests`.
- Each tick: add one surcharge block, advance `payment_due_at` by 15 min, increment `payment_extension_count`, clear `payment_account` / `payment_reference` / `payment_url`, broadcast `coverage_invalidations` (reason `surcharge`).
- Align `extend_payment_window()` to the same account-clearing + invalidation behavior.

### B2. Client refresh from server truth (`src/features/request/ShiftSettlement.tsx`)
- Replace the ref-only billing poll with React state for `serverAmount` and `serverPaymentDueAt`.
- Pipe both into `CustomTransferPane` so the visible total and countdown re-render whenever the server changes.
- When `serverAmount` increases OR `serverPaymentDueAt` advances:
  - drop the old account/reference from UI,
  - reset checkout state,
  - call `beginSettlementCheckout()` again,
  - render the freshly minted account + reference,
  - re-anchor the countdown to the new `payment_due_at`.
- Immediate-expiry path: when the visible timer hits `00:00`, refetch billing state instead of sitting stale.

---

## Part C — 24h / 48h Billing Logic Fix

### C1. Root cause of `₦0`
In the straight branches of `end_shift`:
```
ELSIF sum_worked_min < st24_lo THEN
  hr_used := CEIL(sum_worked_min::numeric / 60.0)::int;   -- 0 when sum=0
  v_total := ROUND(hr_used * st_ph * busy_mult);          -- = ₦0
```
A shift started and ended within seconds yields `sum_worked_min = 0`, `hr_used = 0`, `v_total = ₦0`. Same path for `straight_48h`.

### C2. Root cause of "stale amount" on multi-end test
- `_auto_advance_day_boundary` currently auto-pauses straight bookings booked as `days > 1` (e.g. legacy Weekend with `days = 2`) — producing multiple segments. Billing sums correctly across segments, but the per-day cron pause can race with manual End Shift and leave the displayed amount unsynced with the final `total_billed_amount`. Part A removes the underlying segmentation; this section fixes the math.

### C3. Fixes (single migration)
- Straight-product minimum: in `end_shift` straight branches, when `sum_worked_min < st24_lo` / `st48_lo`, charge `MAX(1, CEIL(sum_worked_min/60))` hours × `st_ph × busy_mult`, with a hard floor at `st_ph × busy_mult` (1 hour minimum). No straight shift may bill `₦0`.
- Apply the same 1-hour minimum to `compute_quote` straight branches so pre-shift quote = post-shift floor when `sum_worked_min = 0`.
- Multi-day standard: in the per-day loop of `_price_standard_day`, apply the same MAX(1, …) floor so a day with 0 worked minutes still bills 1 hour at the standard `per_hour` rate. Prevents the "10h × 3 days, all ended in <1 min" scenario from totaling ₦0.
- After Part A removes pause/resume for straight shifts, `sum_worked_min` for straight products will always be one contiguous interval — the cumulative-segment sum stays correct.

### C4. Verification queries
- Recreate a 24h booking, start, end within seconds → expect `total_billed_amount = st_ph × busy_mult` (₦1,500 normal / ₦1,800 busy), not ₦0.
- Recreate a 48h Weekend booking, run to 47h → expect flat ₦72,000.
- Standard 10h × 3 days, each day ended within seconds → expect 3 × (1h × `per_hour`), not ₦0.
- Surcharge expiry → confirm `drain_surcharge_due()` log has no cast error, `payment_extension_count` increments, account fields clear, client UI shows new amount + new account + reset 15-min timer without manual refresh.

---

## Part D — Verification Pass (end-to-end)

- 24h booking: stepper hidden; published `days=1`; no Pause button; no Day X of Y.
- Weekend booking: stepper hidden; published `days=1`; classified as `straight_48h`; no Pause; no Day X of Y.
- Standard / home multi-day: stepper still shown; Pause + Day X of Y still work (regression check).
- Calling `pause_shift` on a straight row returns the guard error.
- `_auto_advance_day_boundary` does not touch straight rows past `booked_per_day_min`.
- `drain_surcharge_due()` runs without cast errors; client UI re-renders amount + timer + account on surcharge.
- 24h / 48h / multi-day standard with near-zero worked minutes all bill ≥ 1 hour at the correct rate.

---

## Out of scope
- No backfill of historical `coverage_requests` rows.
- No change to Monnify checkout / disbursement code.
- Trust-info wording update and Delete Account modal refactor remain in `.lovable/plan.md` and will be handled in a separate pass unless you ask to fold them in here.
