
# P0 Pricing Correctness Fixes

DB migration **already applied** (Supabase auto-runs migrations). Remaining changes are code-only — approve to apply.

## Already done (migration)

`compute_quote` and `end_shift` rewritten:
- Home Care never gets the ×1.25 Busy multiplier.
- <4h tier: ₦3,000/hr day **and** night.
- 4–6h tier: ₦2,500/hr day **and** night.
- `end_shift` now sums worked time across **all** segments, applies the 60-min floor + 15-min ceil **once** at assignment level, picks **one** tier from the total, scales day/night proportionally, and writes a single `total_billed_amount`. Per-segment `billed_amount` becomes display-only (stamped on the last segment).

## Code changes to apply (3 files)

### 1. `src/lib/pricing.ts`
- `RATE_NIGHT_MID`: `2000` → `2500`.
- `RATE_NIGHT_SHORT`: `2500` → `3000`.
- Home branches in `computeCoveragePricing` and `computeWorkedPricing`: skip `applyEnvironment` — Home Care never multiplies by Busy.

### 2. `src/lib/settlement.functions.ts` (`beginSettlementCheckout`)
- Drop `amount` from `InputSchema` (clients can no longer suggest an amount).
- Select `total_billed_amount, billing_locked_at` from `coverage_requests` alongside the existing columns.
- Derive `serverAmount = round(reqRow.total_billed_amount)`; if `billing_locked_at` is null or amount ≤ 0, throw "Shift is not ready for payment — end the shift first."
- Pass `serverAmount` (not `data.amount`) to `initiateSplitTransaction`.

### 3. `src/features/request/ShiftSettlement.tsx`
- In `startMonnifyCheckout`, drop the `amount` from the `beginCheckout({ data: … })` call. The client now sends only `{ requestId }`.
- Keep the local `frozenAmount` / `totalAmount` only for **display**; never sent to the server.

## Out of scope (intentionally not touched)

- DB-backed pricing rules / admin pricing controls (V6).
- `extend_payment_window` hardcoded ₦2,000/hr (V5).
- Removing the client/server dual pricing engine (V7).
- 24h/48h flat-rate path in billing engine (still falls through to per-hour bucketed pricing on multi-segment 24h shifts).

Approve to apply the three code edits.
