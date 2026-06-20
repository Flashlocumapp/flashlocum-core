## Yes — this plan fixes the Monnify page UI lie

The Monnify page shows ₦42,000 because of **two independent frontend bugs**. The plan fixes both at their root. Server, billing engine, `end_shift`, `shift_segments`, `total_billed_amount`, and Monnify integration are already correct (verified: DB row shows `total_billed_amount = 6,000`, `payment_account.amount = 6,000`) — no migration needed.

---

### Root cause 1 — Monnify pane overrides the locked amount

`CustomTransferPane` in `src/features/request/ShiftSettlement.tsx` renders `Math.max(account.amount, liveAmount)`. The Monnify virtual account is locked at ₦6,000, but the local estimate (₦42,000) wins. An auto `onRetry()` then re-mints a fresh virtual account at the inflated amount once the hold expires.

### Root cause 2 — `computeWorkedPricing` over-estimates prior days

`src/lib/pricing.ts` prices every prior closed day at full booked length (e.g. day 1 + day 2 = 2 × ₦20,000 = ₦40,000) instead of reading each day's authoritative `billed_amount` from `shift_segments`. Day 3 (10 sec) correctly floors to ₦2,000 → total surfaces as ₦42,000. This is exactly what you described.

### Root cause 3 — Coverage list ignores the locked bill

`CoverageScreen.tsx` `toRequestItem` shows the original booked `r.amount` for `awaiting_payment` rows instead of the server-frozen `settledAmount` / `totalBilledAmount`.

---

## Fix (frontend only — no server, billing, or Monnify changes)

### 1. `src/features/request/ShiftSettlement.tsx`
- `CustomTransferPane.displayAmount` → always `account.amount` (no `Math.max`).
- Remove the `amount > account.amount` auto-`onRetry()` path that re-mints virtual accounts.
- `SettlementPane` / `OvertimePane` pass `amount={amount}` (frozen, server-authoritative) instead of `liveAmount ?? amount`.
- `ConfirmedPane` shows `frozenAmount`.
- Fetch `get_request_billing_state` once per render → derive `priorBilled = sum(billed_amount where ended_at != null)` → pass into the three `computeWorkedPricing` call sites.

### 2. `src/lib/pricing.ts`
- Add optional `priorBilledAmount?: number` to `computeWorkedPricing`.
- When provided, closed-day total = `priorBilledAmount` (authoritative). Only the **current** day is estimated locally.
- Fallback to today's booked-length estimate stays for the case where the server total isn't loaded yet.

### 3. `src/features/app/CoverageScreen.tsx`
- `toRequestItem` for `awaiting_payment` / `completed` → prefer `settledAmount` → `totalBilledAmount` → fall back to `amount`.

### 4. `src/lib/coverage-remote.ts` + `src/lib/network.ts`
- Project `total_billed_amount` from DB → `totalBilledAmount` on `NetRequest` so the coverage card can read it before final settlement.

---

## What you will see after the fix

For your 3-day, 10h/day shift ended in seconds each day:
- Monnify page headline: **₦6,000** (matches the locked virtual account exactly).
- Coverage card pending amount: **₦6,000**.
- Headline updates live each day as `shift_segments.billed_amount` accrues — no assumed full-day pricing for closed days.

If Monnify previously minted a virtual account for ₦42,000 on this row, that stale account stays but the new code will only ever show / mint at the server-frozen ₦6,000. Existing locked rows render correctly immediately.
