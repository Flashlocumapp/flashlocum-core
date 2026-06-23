# FlashLocum — Billing Engine Correction Plan (revised, launch-blocking)

Single migration. Fixes the three confirmed gaps: wrong surcharge rate, mis-classified 24h Standard bookings, and heuristic multi-day allocation. Snapshot-only, deterministic, reproducible.

---

## Scope

| # | Fix | Why launch-blocking |
|---|---|---|
| E1 | Surcharge uses **day-rate-of-locked-tier** when day-minutes present, else night-rate; reads only from `rate_snapshot` | Today's ₦375/block on day shifts under-charges by ₦125/block (₦6,250 already lost on one live shift) |
| E2 | Auto-upgrade to `straight_24h` / `straight_48h` only when **`booked_per_day_min == 1440` AND `days ∈ {1,2}`** | "Standard 08:00→08:00, 1 day" currently bills ₦44,000 instead of ₦36,000 |
| E4 | Per-segment multi-day billing — each day priced from its own `shift_segments` row, not a greedy allocator | Booking B (5-day uneven actuals) attributes ₦18,000 to a day the doctor worked 10 seconds |
| E3 | Snapshot-only surcharge math; live pricing tables never read after lock | Guarantees same shift → same bill, forever |
| E6 | SQL test fixtures (Examples A–I + Booking A + Booking B + 24h-Standard case) asserted on every migration | Prevents silent regressions |
| Backfill | One-shot UPDATE: recompute `surcharge_amount`, `total_billed_amount`, `settled_amount` for every locked in-flight row | Brings outstanding balances into spec |

**Deferred (not in this migration):** E5 (symmetric vs one-sided tolerance) — keep current symmetric behaviour, document it in spec. Revisit post-launch with usage data.

---

## Behavioural contracts after the fix

**Booking A** (09:00→17:00, 3 days, Standard quote): stays Standard, **₦48,000**. The classifier refuses to upgrade because `booked_per_day_min = 480 ≠ 1440`.

**Booking B** (08:00→17:00, 5 days, actuals 9h12 / 10s / 8h33 / 44m / 4h05): per-segment billing produces **₦48,000** with the correct per-day attribution shown below — not today's ₦48,500 with ₦18,000 wrongly billed for Day 2.

| Day | Worked | Billed min | Day amount |
|---|---|---|---|
| 1 | 9h 12m | 540 (tolerance) | ₦18,000 |
| 2 | 10 sec | 60 (first-hour floor) | ₦2,000 |
| 3 | 8h 33m | 525 (ceiling) | ₦17,500 |
| 4 | 44 m | 60 (first-hour floor) | ₦2,000 |
| 5 | 4h 05m | 255 (ceiling) | ₦8,500 |

**24h-Standard case** (08:00→08:00, 1 day, Standard): classifier upgrades to `straight_24h`. Quote and end-shift both return **₦36,000** (or ₦45,000 busy). Surcharge = ₦375/block via `straight_per_hour/4`.

**Spec validation suite** (already passing on end-shift math, will be locked in as fixtures): all eight A–I worked examples produce the spec's exact naira amounts.

---

## Technical changes (single migration)

```text
supabase/migrations/<ts>_billing_engine_correction.sql
├── _effective_product(coverage_type, booked_per_day_min, days) → text
│     'home' | 'straight_24h' | 'straight_48h' | 'standard'
│     - honours explicit coverage_type ("24-Hour", "48-Hour", "Weekend", "Home Care")
│     - else upgrades to straight_24h when booked_per_day_min=1440 AND days=1
│     - else upgrades to straight_48h when booked_per_day_min=1440 AND days=2
│     - else standard (or home for "home%")
│
├── compute_quote() — route through _effective_product (not coverage_type text)
│
├── end_shift() — three changes:
│     1. classify via _effective_product
│     2. multi-day Standard / Home loops over shift_segments by day_index,
│        calling _price_standard_day / _price_home_day per row, summing
│        billed_minutes + billed_amount into the request totals
│     3. write per-day breakdown into shift_segments.billed_minutes /
│        billed_amount so get_request_billing_state.days_breakdown is truthful
│
├── extend_payment_window() — surcharge from rate_snapshot:
│     hourly = (snapshot.day_window_min > 0) ? snapshot.rate_day : snapshot.rate_night
│     straight → snapshot.straight_per_hour; home → snapshot.home_hour
│     block_amount = hourly / 4 (or 3000 flat for home, per spec)
│
├── drain_surcharge_due() — same snapshot-only formula; never reads
│     pricing_rates / pricing_flats / pricing_modifiers
│
├── BACKFILL block (idempotent, wrapped in DO $$ ... $$):
│     for each coverage_request with billing_locked_at IS NOT NULL
│       AND payment_extension_count > 0:
│         recompute corrected surcharge_amount,
│         delta = corrected − stored,
│         update surcharge_amount, total_billed_amount, settled_amount,
│         INSERT row into payment_surcharge_log with reason='backfill_v2'
│
└── TEST FIXTURES (SELECT ... assert via RAISE EXCEPTION on mismatch):
      A–I worked examples, Booking A (₦48,000 quote),
      Booking B (₦48,000 from per-segment actuals),
      24h-Standard upgrade case (₦36,000)
```

Frontend mirror (`src/lib/pricing.ts`) gets the same `_effective_product` rule in `coverageKindFromLabel` so booking-time estimates can never disagree with what the server bills. No other client changes — quote/settlement screens already read server amounts.

---

## Out of scope for this migration

- Symmetric vs one-sided tolerance policy (E5) — current symmetric behaviour preserved.
- Pricing table editor changes.
- Any UI copy beyond what the backend dictates.

---

## Order of work

1. Write migration (functions + backfill + fixtures) — one file, one approval.
2. Update `src/lib/pricing.ts` classifier in the same turn so dev-build estimates match.
3. Spot-check the live locked shift (`e240b8aa-…`, LASUTH 10h day-only) to confirm `surcharge_amount` flips ₦18,750 → ₦25,000 after backfill.

No code written until you approve this plan.
