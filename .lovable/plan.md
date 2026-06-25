# Payment Lifecycle — Eliminate All Client-Side Pricing Displays

## A. Root Cause (stale ₦42,000 / ₦77,500)

In `src/features/request/ShiftSettlement.tsx`, the displayed payable amount is seeded from a **client-side estimate** before the server reply lands. For multi-day shifts whose prior days were already closed on the server at the 1-hour minimum, the local estimator doesn't know the real prior-day totals and falls back to "every prior day ran its full booked window." That assumption produces the inflated numbers the user is seeing.

Three call sites perform this client estimate today:

1. **`totalAmount` memo (lines 212–235)** — calls `computeWorkedPricing(..., priorBilled)` where `priorBilled` is derived from `segments`. `segments` is `[]` until `getRequestBillingState` resolves, so the pricer guesses prior-day totals from booked length.
2. **`handleEndShift` pre-seed (lines 415–427)** — writes a local estimate into `frozenAmountRef` *before* awaiting `endShiftRpc`. The SettlementPane mounts and renders the inflated value during the round-trip; line 451 then overwrites it with the server total.
3. **Open useEffect fallback (lines 328–345)** — re-runs the same client estimator whenever `serverTotalBilledAmount` is null/0 on first open (typical on refresh / reopened payment sessions).

`computeWorkedPricing` is doing what it was asked. The bug is that we are calling it at all for any amount the user sees on the payment screen.

## B. Why the Display Flashes

```
t0  End Shift tapped
t0  handleEndShift seeds frozenAmountRef = ₦42,000   ← client estimate
t0  setPhase("settlement") → SettlementPane shows ₦42,000  ← USER SEES
t0+Δ endShiftRpc resolves → frozenAmountRef = ₦6,000      ← server total
t0+Δ re-render → ₦6,000                                    ← FLIPS
```

On a refresh into `awaiting_payment`, the same flip happens via the open-effect fallback while `getRequestBillingState` is in flight.

## C. Hardened Requirement (user-mandated)

**Nowhere in the payment lifecycle may the UI display a client-side pricing calculation.** No estimated totals, no temporary totals, no fallback totals, no locally-priced numbers. When the server-authoritative amount is unknown, show a loading state and disable payment actions.

Scope covered: Settlement screen, Overtime screen, Payment summary, Awaiting payment, Reopened sessions, Multi-day, Single-day, Straight 24h, Straight 48h.

The only authoritative sources for any payable number are:
- `coverage_requests.total_billed_amount` (server, set by `end_shift`)
- `shift_segments.billed_amount` summed (server ledger)
- Server-returned settlement records (for the Confirmed pane history)

## D. Audit — Surfaces That Currently Display a Number in the Payment Lifecycle

All in `src/features/request/ShiftSettlement.tsx` unless noted.

| # | Site | Currently fed by | Action |
|---|---|---|---|
| 1 | `SettlementPane` amount (L1086) | `frozenAmount` (mixed: server or client estimate) | Make server-only |
| 2 | `SettlementPane` liveAmount (L982) | `totalAmount` memo (client estimate) | Replace with server amount or skeleton |
| 3 | `OvertimePane` total (L1203) | `totalAmount` memo (client estimate) | Replace with server amount or skeleton |
| 4 | `OvertimePane` "+₦X" surcharge tag (L1234) | `totalAmount − frozenAmount` (client math) | Derive from server `total_billed_amount − base` (server-known) |
| 5 | `Pay with Monnify` button label (L1255) | `total` (client estimate) | Use server amount; show "Calculating…" + disabled while unknown |
| 6 | `ConfirmedPane` total (L1429, L1467, L1475) | `frozenAmount` + server `segments` | Already server-derived; assert no estimate fallback |
| 7 | Final receipt amount (L1654) | `displayAmount` | Trace and ensure server-only |
| 8 | `PaymentSummaryOverlay` totals (L125–127) | Props from caller | Audit caller; require server amount |

`RequesterHome.tsx` `computePricing` (L141, L473, L1210) is the **request-builder** preview before a request is created (no shift exists, no server bill possible). That is outside the payment lifecycle and stays as-is.

`EarningsScreen.tsx` / `HistoryDetailSheet.tsx` render historical settled rows from the server — already server-authoritative; will be re-verified, not changed.

## E. Correct Behaviour

For every payment-lifecycle surface:
1. Render the amount only when a server-authoritative number is in hand.
2. Otherwise render a skeleton with the copy **"Calculating final amount…"**.
3. Disable all payment-trigger actions (Pay with Monnify, "I've paid", manual transfer copy CTA) while the amount is unknown.
4. Never call `computeWorkedPricing` (or any local pricer) inside a payment-lifecycle component.

## F. Implementation Plan

All changes in `src/features/request/ShiftSettlement.tsx` plus a small prop tightening in `src/components/PaymentSummaryOverlay.tsx`. No SQL changes. No pricing-engine changes.

1. **Make the displayed amount strictly server-sourced.**
   - Change `frozenAmountRef` initial value to `null`. Introduce `serverAmount: number | null` derived from: `serverTotalBilledAmount` prop → `endShiftRpc` response → `getRequestBillingState` poll. Whichever lands first wins; later server values may only raise it (Math.max) — never a client value.
   - Delete the pre-seed in `handleEndShift` (lines 415–427) and the fallback in the open useEffect (lines 331–345). Replace with: kick `getRequestBillingState` immediately on mount whenever `serverAmount === null`.

2. **Stop computing `totalAmount` for any payment-lifecycle pane.**
   - Remove `liveAmount` / `total` props sourced from `totalAmount` on `SettlementPane` and `OvertimePane`. They consume `serverAmount` only.
   - Retain the `totalAmount` memo **only** as input to `ActivePane`'s live ticker during the *running shift* (pre-end). That is not a payment screen. To eliminate the same booked-length over-estimate from leaking into the live ticker for multi-day, gate `ActivePane`'s amount on `segments.length > 0`; until then show "—".

3. **Surface a real loading state.**
   - Add an `AmountLine` subcomponent: renders `fmtNaira(serverAmount)` when present; otherwise renders the shimmer + text "Calculating final amount…".
   - Use it in `SettlementPane`, `OvertimePane`, and the final receipt row (L1654).

4. **Gate all payment actions on `serverAmount !== null`.**
   - `Pay with Monnify` button: `disabled` until `serverAmount` is known; label switches to "Calculating final amount…".
   - `I've paid` / manual confirm CTA: same gate.
   - Bank-transfer copy CTA: visible, but the amount line above it shows the loading state until known.
   - `settlementReadyRef` already gates End-Shift path; extend the same gate to the reopen path so the button is never enabled with an unknown amount.

5. **Derive overtime "+₦X" from server data only.**
   - Replace `extensionAmount = totalAmount − frozenAmount` with `extensionAmount = serverAmount − baseAmount`, where `baseAmount` is `coverage_requests.total_billed_amount` captured at the moment `payment_extension_count` first becomes > 0 (already provided by `getRequestBillingState`). If unavailable, hide the "+₦X" tag instead of guessing.

6. **Tighten `PaymentSummaryOverlay`.**
   - Document and assert in the component that `total` MUST be a server-confirmed settled amount. Add a prop `source: 'server'` (typed literal) so every call site is forced to acknowledge it. Verify the two existing call sites already pass server-derived values; no display change expected.

7. **Verification (must all pass before declaring done).**
   - Reproduce test cases 1 (3d×10h, 20s/day) and 2 (4d×10h busy, 20s/day): sheet opens, briefly shows "Calculating final amount…", then ₦6,000 / ₦10,000. Never displays ₦42,000 / ₦77,500 or any other intermediate number.
   - Refresh mid-settlement on each: identical behaviour, never a stale flash.
   - Single-day standard, Straight 24h, Straight 48h: same — no client number ever rendered on Settlement / Overtime / Awaiting / Reopened.
   - Grep the repo to confirm `computeWorkedPricing` is no longer imported by any file under `src/features/request/ShiftSettlement.tsx`'s payment panes; the only allowed callers are the request-builder (`RequesterHome` pre-create preview) and the `ActivePane` running-shift ticker.
   - Manually disable network / throttle to 3G and confirm the Pay button stays disabled and the loading copy is visible the entire time the server amount is in flight.

### Outcome

After this change there is no code path in the payment lifecycle that can render a client-priced number. Every naira the requester sees from End Shift through Confirmed comes from the server ledger. The ₦42,000 / ₦77,500 flash is structurally impossible — not hidden behind a faster poll, but removed at the source.
