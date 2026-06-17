# Pricing Engine — Strict Ordered Pipeline

Tier selection and billable-duration calculation are independent.
Tier is **only ever** derived from booked duration (or coverage
product). Billable duration follows a strict, ordered sequence —
no step may be reordered or skipped.

## Strict execution order (do exactly in this sequence)

```text
STEP 1 — Read inputs
   coverage_type, environment, booked_min (per day), worked_min (per day)

STEP 2 — Resolve coverage product (early exit for specials)
   if coverage_type == 24-Hour Straight → amount = 36,000 (×1.25 if busy); END
   if coverage_type == 48-Hour Straight → amount = 72,000 (×1.25 if busy); END
   if coverage_type == Home Care        → product = home; continue
   else                                  → product = standard; continue

STEP 3 — Determine TIER  (from booked_min ONLY; never from worked, never from billable)
   booked_hr = booked_min / 60
   if product == home → tier = home_flat
   elif booked_hr > 6  → tier = >6h
   elif booked_hr >= 4 → tier = 4-6h
   else                → tier = <4h
   (Tier is now frozen for the rest of the pipeline. It must not be
    recomputed in any later step.)

STEP 4 — Determine RATE  (from tier + environment ONLY)
   if tier == home_flat:
       rate_day = 15,000;  rate_night = 15,000;  busy_mult = 1.0
   else:
       (rate_day, rate_night) =
           tier == <4h   → (3,000, 2,500)
           tier == 4-6h  → (2,500, 2,000)
           tier == >6h   → (2,000, 1,500)
       busy_mult = 1.25 if environment == busy else 1.0
   (Rate is frozen. Never re-derived from billable_min.)

STEP 5 — Compute BILLABLE minutes from worked_min
   STEP 5a — First-Hour Rule
       if 0 < worked_min < 60:
           working_min := 60
       else:
           working_min := worked_min

   STEP 5b — ±15-min Tolerance  (MUST run BEFORE any 15-min rounding)
       if booked_min > 0 and abs(working_min − booked_min) ≤ 15:
           billable_min := booked_min
           GOTO STEP 6        # rounding is skipped entirely

   STEP 5c — 15-minute block rounding  (only if tolerance did NOT fire)
       billable_min := ceil(working_min / 15) * 15

STEP 6 — Compute day/night split of billable_min
   if product == home OR special flat product → skip (not needed)
   elif tolerance fired in 5b:
       (day_min, night_min) := split_of(booked window)   # from booked, matches anchor
   else:
       (day_min, night_min) := proportional_rescale(
           actual_worked_day_min, actual_worked_night_min, billable_min)

STEP 7 — Compute AMOUNT  (using rate from STEP 4, NEVER recomputed)
   if product == home:
       amount := round( (billable_min / 60) × 15,000 )
   else:
       base := (day_min / 60) × rate_day + (night_min / 60) × rate_night
       amount := round( base × busy_mult )

STEP 8 — Return  { tier, rate_day, rate_night, busy_mult,
                   billable_min, day_min, night_min, amount }
```

Invariants the implementation must enforce:

- Tier is assigned exactly once, in STEP 3, from `booked_min` only.
- STEP 5b runs before STEP 5c. If 5b fires, 5c is skipped.
- STEP 7 reads `rate_day`/`rate_night`/`busy_mult` only — never
  re-buckets based on `billable_min`.
- Multi-day (`days > 1`): the entire pipeline runs **per day**
  against that day's booked window. Per-day amounts sum to
  `total_billed_amount`. Steps 2's Straight branches are never
  triggered by accumulated multi-day totals.

## Rate table

| Tier      | Day      | Night    |
|-----------|----------|----------|
| <4h       | ₦3,000   | ₦2,500   |
| 4-6h      | ₦2,500   | ₦2,000   |
| >6h       | ₦2,000   | ₦1,500   |
| Home Care | ₦15,000  | ₦15,000  |

Busy ×1.25 for Standard only.

## Files to change

**SQL migration** (single migration, two functions):
- `compute_quote` — implement STEPS 1–7. Tier from total booked
  minutes. New <4h / 4-6h night rates.
- `end_shift` — derive `booked_min` from `r.start_time`/`r.end_time`
  (overnight +1 day). Run STEPS 1–7 per active day. Per-segment
  billing fields stay nulled (already from P0). Last segment is
  stamped with aggregate `billed_minutes`/`billed_amount` for display.

**Client (`src/lib/pricing.ts`):**
- `computeWorkedPricing` gains required `bookedMinutes` argument and
  follows STEPS 1–7 identically.
- `computeCoveragePricing` updated with new <4h / 4-6h night rates so
  quote and end-of-shift agree.

**Call sites** (`rg "computeWorkedPricing"`): pass `bookedMinutes`
from already-in-scope `startHHMM`/`endHHMM`.
- `src/features/request/ShiftSettlement.tsx` is the known consumer.

## Worked test matrix (post-change)

Each row exercises the strict ordering; "tolerance?" shows whether
STEP 5b fired (and therefore STEP 5c was skipped).

Standard, Normal:

| Booked | Worked   | Tier (STEP 3) | 5a→working | 5b tolerance? | billable | Rate (day) | Bill     |
|--------|----------|---------------|------------|---------------|----------|------------|----------|
| 10h    | 20 min   | >6h           | 60         | no (|60-600|=540) | 60 (ceil) | 2,000  | ₦2,000   |
| 10h    | 9h 50m   | >6h           | 590        | yes           | 600      | 2,000      | ₦20,000  |
| 10h    | 10h 14m  | >6h           | 614        | yes           | 600      | 2,000      | ₦20,000  |
| 10h    | 10h 16m  | >6h           | 616        | no            | 630      | 2,000      | ₦21,000  |
| 10h    | 10h 31m  | >6h           | 631        | no            | 645      | 2,000      | ₦21,500  |
| 5h     | 20 min   | 4-6h          | 60         | no            | 60       | 2,500      | ₦2,500   |
| 5h     | 5h 10m   | 4-6h          | 310        | yes           | 300      | 2,500      | ₦12,500  |
| 3h     | 20 min   | <4h           | 60         | no            | 60       | 3,000      | ₦3,000   |
| 3h     | 3h 05m   | <4h           | 185        | yes           | 180      | 3,000      | ₦9,000   |

Standard, Busy, 5h booked, 5h 10m worked → tier 4-6h frozen → 300 × 2,500 × 1.25 = ₦15,625.

Home Care, 3h booked, 20 min worked → home_flat tier → 60 × 15,000 = ₦15,000.
Home Care, 3h busy → busy_mult forced 1.0.

24h Straight worked 23h 45m / 24h 15m → STEP 2 exits at ₦36,000 (₦45,000 busy).
48h Straight worked 47h 45m / 48h 15m → STEP 2 exits at ₦72,000 (₦90,000 busy).

Multi-Day 3×8h booked, day 1 worked 8h 03m → tier >6h (8h booked) frozen for that day; tolerance fires → 480 min × 2,000 = ₦16,000 for that day. Total never collapses to flat.

## Out of scope (unchanged)

- F2 underpayment enforcement in `mark_settlement_paid`.
- `extend_payment_window` ₦2,000/hr hardcode.
- DB-backed / admin pricing controls.
- Removing the client-side pricing mirror (kept in lockstep instead).
