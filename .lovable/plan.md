# Hard 1-Hour Minimum Bill

## Goal

Any shift that was started — no matter how briefly — must bill at least 1 full hour at the correct rate. No shift can ever resolve to ₦0 or unpriced. After the first hour, current 15-minute-block billing is unchanged. Rate selection (6am–10pm normal, 10pm–6am night, busy multiplier) is unchanged.

## What's broken today

For a shift ended after ~22 seconds:

- `end_shift` computes `seg_worked = 22 / 60 = 0` (integer minutes)
- The first-hour floor is gated by `IF sum_worked > 0`, so it's skipped when worked = 0
- `billable_total = 0`, `total_billed_amount = ₦0`
- `ShiftSettlement` treats 0 as "not ready for payment" → PaymentPane spinner hangs forever
- Same bug exists in the frontend mirror (`src/lib/pricing.ts`)

## Changes

### 1. Backend — `public.end_shift` (migration)

- Replace the gated first-hour floor with an unconditional floor for any started shift:
  - `working_min := GREATEST(sum_worked, first_hour_min)` when the request was active/paused (i.e. always, in this function — `end_shift` requires status in `('active','paused')`)
  - Result: `working_min ≥ 60` always
- Compute `billable_total` as today: tolerance branch first, else `CEIL(working_min / block_min) * block_min`. With the floor, this is always ≥ 60.
- Day/night split for short shifts: when `sum_d + sum_n = 0` (shift too short to register minutes), derive the 60-minute split from the first segment's `started_at` using `_split_day_night_minutes(started_at, started_at + 60 min)` instead of falling through to "all day". This keeps night-rate shifts correctly billed at night.
- Keep tolerance, busy multiplier, flats (24h/48h), home product, and the rate-tier picker untouched.
- Snapshot (`rate_snapshot`) keeps the same shape; `billable_min` will now be ≥ 60.

### 2. Frontend — `src/lib/pricing.ts`

In `computeWorkedPricing`, replace:

```ts
if (working > 0 && working < t.modifiers.first_hour_min) working = t.modifiers.first_hour_min;
```

with:

```ts
working = Math.max(working, t.modifiers.first_hour_min);
```

`billableMinutes()` already does `Math.max(first_hour_min, …)` but only when `workedMin > 0`. Adjust it the same way so a 0-minute worked value still yields 60. This keeps the local quote on the settlement screen consistent with the server.

### 3. No changes to

- Rate tiers / day-night windows / busy multiplier
- 15-min block logic after the first hour
- Flats (`straight_24h`, `straight_48h`), home product
- Tolerance window
- PaymentPane, Monnify flow, RPC contracts, types
- Pricing tables / admin pricing UI

## Verification

1. **Unit-style:** end a shift after ~5 seconds in the active pricing version. Expect `total_billed_amount = day rate` (or night rate if started 10pm–6am), `billable_min = 60`, `payment_status = 'pending'`.
2. **Boundary:** 59 min 59 s → still bills exactly 1 hour. 60 min 1 s → bills 1h 15min (block).
3. **Night shift:** start at 02:00, end 30 s later → bills 60 min at night rate, not day rate.
4. **Busy:** busy environment short shift → 60 min × rate × busy_mult.
5. **Tolerance unaffected:** booked 60 min, worked 58 min → tolerance fires, bills booked window as today.
6. **PaymentPane:** spinner advances to account creation; no "shift isn't ready for payment" path.

## Out of scope

- The separate silent-spinner UX bug (PaymentPane not surfacing `endShiftError`). With this fix, that error path no longer fires for short shifts, so the user-visible symptom disappears. Tell me if you also want me to harden PaymentPane to surface end-shift errors regardless.

## Irreversibility

The migration replaces the `end_shift` function body (CREATE OR REPLACE). No data is mutated by the migration itself. Existing settled shifts are unaffected; only future `end_shift` calls use the new floor.
