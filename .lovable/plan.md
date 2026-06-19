## FlashLocum Multi-Day Pricing & Flow Audit (read-only) — Revised

Audit only. No code or schema changes proposed in this plan.

### Scope reviewed
- Latest `start_shift` / `pause_shift` / `resume_shift` / `end_shift` migrations
- `public.compute_quote`, `_price_standard_day`, `_tier_for_per_day_hours`
- `public.shift_segments` schema (live)
- `src/lib/pricing.ts`, `src/features/app/CoverageScreen.tsx`, `src/features/request/ShiftSettlement.tsx`, `src/lib/shift.functions.ts`

---

### A. What is already correct vs spec

| Spec rule | Status |
|---|---|
| Start Shift → Active, shared server timer | ✅ |
| Doctor sees only Call in Active; Requester sees Call + Pause + End | ✅ |
| Pause hidden on final day | ✅ (`day_index >= days` gate + server check) |
| Pause does not trigger Monnify / payment | ✅ |
| Resume opens new segment | ✅ |
| End-Shift only on final day or early termination | ✅ |
| Per-day tier selection from booked-per-day hours | ✅ in `compute_quote` (preview only) |
| First-hour + 15-min block + 15-min grace (per-day primitive) | ✅ in `_price_standard_day` |
| Night/day split per day | ✅ |
| 24h / 48h Straight windows | ✅ |

---

### B. Defects vs spec (ordered by severity)

#### 🔴 CRITICAL D1 — Hourly rate is NOT locked at booking
**(New, per latest spec.)** Spec: "One booking → one locked rate". Today nothing in `coverage_requests` stores the chosen tier / rate at booking time. `end_shift` re-derives `tier` from `booked_per_day_hr` (line 348) and re-reads `rate_day` / `rate_night` from `pricing_rates` of the **currently active** `pricing_version`. Effects:
- If admin publishes a new pricing version mid-shift, the bill changes retroactively.
- If a future change ever feeds tier derivation from *actuals* (e.g. truncated final day), the rate flips between days.
- No defensible audit trail of "what rate was the customer quoted".

Fix shape (later): persist `locked_pricing_version_id`, `locked_tier`, `locked_rate_day`, `locked_rate_night`, `locked_busy_mult` on `coverage_requests` at booking, and have `end_shift` read only from those fields.

#### 🔴 CRITICAL D2 — Per-day actual durations are NOT used; days are reconstructed from a single aggregate
`end_shift` (mig `20260619140652`, lines 282–294, 353–380) sums all segments into one `sum_worked_min`, then assigns each prior day `min(remaining, booked_per_day + tolerance_min)` and dumps the rest on the final day. The clarified test case fails:

> Booking Mon–Wed 9am–4pm, locked ₦2,000/hr. Actuals 3h / 5h / 4h12m → spec ₦6,000 + ₦10,000 + ₦8,500 = **₦24,500**.
> Current: total = 12h12m = 732m, booked/day = 420m, tol = 15m. Day 1 takes 435m, Day 2 takes 297m, Day 3 takes 0m → wrong tiers, wrong amounts, last day always wrong.

#### 🔴 CRITICAL D3 — Pause does not freeze that day's bill
Spec §5 / new "always do this" rule: "Compute each day separately … Sum final result only at End Shift." `pause_shift` (mig `20260618144925`) only sets `ended_at` and bumps `day_index`. `shift_segments.billed_minutes` / `billed_amount` stay NULL. No per-day ledger exists, so End-Shift has nothing to sum.

#### 🔴 CRITICAL D4 — Grace + 15-min rounding are applied to the wrong unit
Spec: grace + rounding are **per day**. Because D2 collapses to one aggregate, both rules currently fire against a cascade-allocated bucket, not against the day's actual minutes. Day 3 of the clarified case must round 4h12m → 4h15m (₦8,500); current logic cannot produce this because Day 3 never sees 4h12m.

#### 🟠 HIGH D5 — Day boundary is only created by Pause; a missed Pause merges days
`shift_segments` has no `day_index` column. If the requester forgets to Pause, the single segment spans multiple calendar days and End-Shift cannot split it. Spec §1 ("collection of independent daily sessions") is unenforceable. Need either auto-pause at booked daily end_time or in-flight segment splitting at the daily boundary.

#### 🟠 HIGH D6 — `pause_shift` blindly increments `day_index`
`pause_shift` line 29: `new_day_index := COALESCE(r.day_index, 1) + 1`. Two pauses on the same calendar day overshoot `day_index`, which can (a) hide Pause on a non-final day, or (b) let End-Shift settle a booking that still has remaining days. Should derive `day_index` from booked schedule + calendar date, not by naive increment.

#### 🟠 HIGH D7 — `compute_quote` preview and `end_shift` settlement diverge
`compute_quote` (line 204) does `per_day_amount × total_days` against booked-per-day. `end_shift` does aggregate-cascade. Any non-trivial multi-day scenario produces a different number on Settlement than on Preview. `src/lib/pricing.ts` mirrors `compute_quote`, so the client estimate is also wrong relative to what the server eventually charges.

#### 🟡 MEDIUM D8 — Home Care multi-day uses a single aggregate
Lines 333–342: Home Care over multiple days bills the sum of booked vs sum of worked with **one** 30-min grace and **one** rounding block. Per the locked-rate spec, each day must bill independently against the locked Home rate, with 30-min grace and 60-min block per day.

#### 🟡 MEDIUM D9 — `compute_quote` Standard branch assumes every day identical
Acceptable for a preview but the Settlement UI does not communicate "preview = booked × N at locked rate; actual bill = sum of per-day actuals." Risk of requester surprise.

#### 🟡 MEDIUM D10 — `days_breakdown.worked_min` is a derived bucket, not the real per-day worked minutes
Because of D2's cascade, the breakdown returned to the client lies about what happened each day. Spec §11 requires showing actual worked duration per day.

#### 🟢 LOW D11 — Per-segment ledger columns exist but are only written for the last segment
`shift_segments.billed_minutes` / `billed_amount` are wiped on all rows (lines 285–287) and only stamped on the final segment (lines 383–386). Makes per-day audit / dispute impossible even if the calculator were correct.

#### 🟢 LOW D12 — No early-termination handling on Day k
End-Shift on Day 2 of a 3-day booking still loops `1..r.days = 3`. Day 3 gets a 0/negative cascade entry. Loop bound should be the actual number of started days.

#### 🟢 LOW D13 — Doctor / requester cannot see "today's frozen bill" after Pause
Once D3 is fixed and per-day bills are persisted at Pause, `get_request_billing_state` should expose them in `paused` state so both parties see "Day 1 = ₦6,000" before Day 2 begins.

---

### C. Audit test cases (executed against current `end_shift`)

| # | Booking | Actuals | Spec expects | Current result | Pass |
|---|---|---|---|---|---|
| 1 | Fri–Sun 8h/day Standard (₦2k/hr locked) | 45m / 8h14m / 8h43m | ₦2,000 + ₦16,000 + ₦17,500 = **₦35,500** | Aggregate cascade → wrong per-day allocation | ❌ |
| 2 | Mon–Wed **9am–4pm** Standard, locked ₦2,000/hr | **3h / 5h / 4h12m** | **₦6,000 + ₦10,000 + ₦8,500 = ₦24,500** *(per latest spec)* | Day1=435m, Day2=297m, Day3=0m → wrong | ❌ |
| 3 | Mon–Tue 6h/day Standard | 6h / 6h12m | grace per day → ₦15k + ₦15k = ₦30,000 | Cascade dumps 12m on Day 2 → wrong | ❌ |
| 4 | Single-day 8h Standard | 8h14m | ₦16,000 (grace) | ✅ | ✅ |
| 5 | 24h Straight, 23h actual | window logic | ✅ | ✅ |
| 6 | 24h Straight, 26h actual | flat + 1 extra hr | ✅ | ✅ |
| 7 | 48h Straight, 53h actual | flat + 5 extra hr | ✅ | ✅ |
| 8 | Home 3-day 3h/day | 3h / 3h31m / 3h | Day1 ₦36k + Day2 ₦48k (1 min over grace → 4h block) + Day3 ₦36k = **₦120,000** | Aggregated grace swallows overrun → ₦108,000 | ❌ |
| 9 | Multi-day example = ₦49,500 | per spec | depends on per-day breakdown | unreachable without per-day persistence | ❌ |
| 10 | Early End-Shift on Day 2 of 3 | bill only days worked | loops 3 days, day 3 = 0 entry | ❌ |
| 11 | Double-pause on same calendar day | `day_index` stays on same day | `day_index += 1` each pause | ❌ |
| 12 | Pricing v3 published mid-shift (locked-rate test) | bill at original rate | bill recalculated at new rate | ❌ |

---

### D. Summary

| Severity | Count |
|---|---|
| Critical | 4 (D1, D2, D3, D4) |
| High     | 3 (D5, D6, D7) |
| Medium   | 3 (D8, D9, D10) |
| Low      | 3 (D11, D12, D13) |
| **Total**| **13** |

**Overall compliance score: ~40%**
- UI lifecycle (button gating, pause-not-paying, role visibility): ~90% compliant.
- Per-day billing + locked-rate guarantee: ~20% compliant. Single-day Standard, Home, and Straight cases pass; multi-day Standard and multi-day Home are structurally wrong, and no booking currently locks its rate.

**Estimated effort to full compliance: ~2 days** (one focused work block per track):
1. Schema additions on `coverage_requests` — `locked_pricing_version_id`, `locked_tier`, `locked_rate_day`, `locked_rate_night`, `locked_busy_mult`, `locked_home_rate`; populate at booking.
2. Schema additions on `shift_segments` — `day_index`, `is_final_day`, plus actually-use `billed_minutes` / `billed_amount`.
3. Rewrite `pause_shift` to compute & persist that day's bill (Standard / Home primitives) using **locked** rate.
4. Rewrite `resume_shift` to advance `day_index` only when the new segment crosses the booked daily boundary; add server guard against same-day double-advance.
5. Rewrite `end_shift` to (a) close the open segment, (b) compute the current day's bill against the **locked** rate, (c) **sum** all persisted per-day bills + the freshly computed last day, (d) honor `day_index` for early termination, (e) keep Straight aggregate as a single product.
6. Rewrite `compute_quote` to "sum of per-day estimates against booked schedule at locked rate" and mirror in `src/lib/pricing.ts`.
7. Add daily-boundary safety: either auto-pause at booked daily end_time or split segments crossing the boundary.
8. Surface per-day breakdown in `get_request_billing_state` so Settlement / Pause UI can show frozen daily bills.
9. Regression harness: lock-in the 12 cases above + the 14 existing v2 cases.

No fixes implemented in this audit. Awaiting approval to proceed to a remediation plan.