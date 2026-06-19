
# FlashLocum — Implementation Plan (Audit Approved + Additional Requirements)

Acknowledged. I've completed the deeper investigation you asked for on ratings and the payment-summary data source, and re-scoped the multi-day work to the "freeze each day" model (not just a timer reset). Below is the implementation plan that will run on approval.

---

## ISSUE 1 — Monnify amount mismatch (approved)

### What I'll change
1. **Migration — invalidate cached payment account on any billing recalculation.**
   - `end_shift`: set `payment_account = NULL` (in addition to clearing `payment_reference` / `payment_url`).
   - `extend_payment_window` and `drain_surcharge_due`: same — whenever `total_billed_amount` is mutated, `payment_account = NULL`.
2. **`src/lib/settlement.functions.ts` — `beginSettlementCheckout`.**
   - Tighten the RESUME-IF-PENDING branch: only return the cached `payment_account` when **`acc.amount === serverAmount`** AND `payment_reference` is present AND not expired. Any mismatch → mint a fresh Monnify reference + virtual account against `serverAmount`.

### Single source of truth
After this change, every payment path resolves from one value:

```
coverage_requests.total_billed_amount (server) 
        │
        ▼
beginSettlementCheckout → initiateSplitTransaction(amount = serverAmount)
        │
        ▼
payment_account (cached only when amount matches serverAmount)
        │
        ▼
UI displays account.amount === serverAmount (always)
```

---

## ISSUE 2 — Per-day billing freeze + zero-reset timer

### Reframed to match your business rule

Pause Shift is the boundary where a day's billing is **frozen**. The plan now reflects that — the timer reset is a consequence, not the goal.

### Current behaviour (verified)
- `pause_shift` already closes the open segment AND writes `billed_minutes` + `billed_amount` to that segment row via `_price_segment_locked`. ✅
- `shift_segments` rows persist with `day_index`, `started_at`, `ended_at`, `billed_minutes`, `billed_amount`. I confirmed this on row `605f3ac8…` — 3 segments, one per day, each with billable=60 min and amount=2000. ✅
- `pause_shift` advances `day_index` and `resume_shift` opens a new segment under the new `day_index`. ✅
- **Gap A:** `pause_shift` adds to `accumulated_ms` cumulatively and `resume_shift` does not zero it → the LiveTimer reads `(now − startedAt) + accumulatedMs` and continues from yesterday's total. ❌
- **Gap B:** Each segment stores `billed_minutes` and `billed_amount`, but **does not store the actual worked minutes separately** (it can be derived from `ended_at − started_at`, but is not persisted as a column). Acceptable as derived value; will surface it in the UI.

### Changes
1. **Migration — `pause_shift` and `resume_shift`:**
   - After closing the segment + writing the day's billed values, **set `accumulated_ms = 0`** on `coverage_requests`. The segment row remains the permanent, audit-grade record of that day's bill. The row-level counter is reset so each new day starts at 0:00:00 on the wall timer.
   - No change to `day_index` advancement, no change to `_price_segment_locked`, no change to segment writes — those already match the requirement.
2. **Migration — extend `get_request_billing_state` segment payload** to include `actual_minutes` (computed from `ended_at − started_at`) so the client doesn't need to re-derive it.
3. **No client change needed for the timer.** The existing `LiveTimer` formula will produce a zero-based per-day timer once the DB counter is reset on pause/resume.

### Guarantees this delivers
- A day's bill is computed and stored at the instant Pause is pressed.
- Resume opens a brand-new segment under the next `day_index` with its own `started_at`. Past days are not re-priced.
- End Shift sums the per-day segment totals it has already stored (it does not recompute past days from scratch).

---

## ISSUE 3 — Pause button on final day (approved)

### Root cause (confirmed)
`src/features/app/CoverageScreen.tsx` has two render paths. The detail sheet (line 685) correctly guards `item.dayIndex < item.days`. The **list-card view (line 862)** is missing that guard:

```tsx
{isActive && item.days > 1 && (
  <button …>Pause Shift</button>
)}
```

### Change
Add `&& item.dayIndex < item.days` to the list-card condition. Server already rejects on final day; this aligns UI with the rule. (Doctor side has no Pause button — already compliant.)

---

## ISSUE 4 — Ratings: completed end-to-end audit

You're right to push back; I went deeper. Here is the full chain with evidence at every step.

### Evidence collected from the live DB

| Step | Status | Evidence |
|---|---|---|
| `public.ratings` schema | ✅ exists | 7 columns, FK to `coverage_requests(id)` via `shift_id`. |
| RLS policies | ✅ correct | `INSERT: rater_user_id = auth.uid()`, `SELECT: participants or admin`. |
| Table grants | ⚠️ irrelevant | No explicit `GRANT` to `authenticated`, but `submit_shift_rating` is `SECURITY DEFINER` — runs as `postgres` and bypasses both table grants and RLS for the insert itself. |
| `submit_shift_rating` RPC | ✅ exists, `SECURITY DEFINER`, `EXECUTE` granted to `authenticated` (`pg_proc.proacl` confirms). |
| `_ratings_after_insert` trigger | ✅ active, calls `recompute_trust(ratee)` and mirrors flags to `coverage_requests.{doctor,requester}_rating_submitted`. |
| `recompute_trust` | ✅ exists, writes `profiles.trust_snapshot` (admin dashboard's source). |
| Admin reads | ✅ correct: `admin_list_trust` reads `profiles.trust_snapshot`. Empty snapshot ⇒ no rating ever inserted, not an admin-display bug. |
| **`ratings` table rows** | ❌ **0 rows**, while two recent requests are `completed` + `paid` with `doctor_rating_submitted=false, requester_rating_submitted=false`. |

### Conclusion of evidence
Every component from the RPC down to the admin view is correct. The RPC has not been executed even once. The failure is **above** the RPC — at the call site, the overlay, or in the supabase-js argument shape. I'm not assuming user behaviour; I'm narrowing the suspect surface.

### Probable cause candidates (will be verified before/after fix with browser console + network capture)

1. **`_feedback ?? undefined`** in `src/lib/trust.ts:188`. `supabase-js` v2 serializes `undefined` as the literal string `"undefined"` for some RPC code paths, which then fails inside the RPC's `NULLIF(_feedback,'')` only if the parser keeps the literal. Low probability but a real shape bug — pass `null` explicitly.
2. **`tx?.id` null in `ShiftSettlement.tsx:1283`.** The overlay opens with `useState(true)` at line 1161 — it can render before `tx` has been loaded from the DB realtime fetch. If the user submits a star while `tx` is still null, the call is silently dropped (`if (rating > 0 && shiftId)` short-circuits with no toast).
3. **Status not yet terminal at submission moment.** The RPC requires `status IN ('completed','cancelled','no_show')`. Status flips to `completed` only when the Monnify webhook lands (or `verifySettlementPayment` polls). If the requester rates before that flip, the RPC throws `Shift not yet terminal` — currently surfaced as a toast in code, but the toast host may not be mounted in this overlay context. Will instrument.
4. **Doctor side: `pendingRating` may be cleared by `setRatingDismissed` before submit fires** in `CoverDispatchPortal.tsx:88` (race between dismiss-on-tap-outside and the submit handler).

### Plan to fix and verify

A. **Instrumentation (one-shot, removed after verification):**
   - Add `console.info`/`console.error` at four checkpoints in `submitShiftRating` and both call sites:
     1. submit event fired with `{rating, shiftId, hasFeedback}`
     2. RPC about to call
     3. RPC response (`data`/`error`)
     4. cache updated

B. **Code fixes (regardless of which candidate above is the trigger):**
   - `src/lib/trust.ts`: pass `_feedback: feedback ?? null` (not `undefined`); `console.error` on `error`; return `error.code` and `error.details` in the result message.
   - `src/features/request/ShiftSettlement.tsx`: keep overlay closed (`useState(false)`) until `tx?.id && tx.payment_status === 'paid'`, then open. On submit: if `shiftId` is missing, push an explicit error toast.
   - `src/features/cover/CoverDispatchPortal.tsx`: snapshot `pendingRating` into a local before dismiss is fired; submit uses the local.
   - `recordRating` (`src/lib/ratings.ts`): forward errors to a toast hook so the CoverageScreen rating path also surfaces failures.

C. **Verification gate:** after the fix is deployed, I will:
   - Trigger a rating from both sides on the two existing `completed+paid` rows.
   - Re-query `public.ratings`, `public.coverage_requests.doctor_rating_submitted`, `public.profiles.trust_snapshot`, and `admin_list_trust` to prove the row appears at every layer.

If the rows still don't appear after B, the instrumentation in A will pinpoint the exact failing checkpoint and I'll fix only that.

---

## ADDITIONAL — Multi-day Payment Summary from stored daily records

### Current state (verified)
- `get_request_billing_state` returns `segments[]` from `shift_segments` (the persisted records). ✅
- `ShiftSettlement.tsx:1230` renders that array as "Session breakdown" with `Day X · Session Y`. ❌ Not grouped per day; shows per-segment rows; missing actual duration label.
- The summary already pulls from stored records (not from `rate_snapshot.days_breakdown`). ✅
- Each segment has `billed_minutes`, `billed_amount`, `day_index`, `started_at`, `ended_at` — sufficient to render the exact format you specified.

### Changes
1. **`get_request_billing_state` (migration):** add `actual_minutes` to each segment row.
2. **`ShiftSettlement.tsx` Session breakdown:** replace per-segment list with a per-day group:

```
Day 1
  Actual Duration:    45m
  Billable Duration:  1h
  Amount:             ₦2,000
Day 2
  Actual Duration:    8h 14m
  Billable Duration:  8h
  Amount:             ₦16,000
...
Total: ₦35,500
```

Aggregation rule: group segments by `day_index`, sum `actual_minutes`, sum `billed_minutes`, sum `billed_amount`. Total = sum of per-day amounts = `total_billed_amount` (assertion check). If a day has multiple segments (pause/resume within the same day before the day was rolled), the per-day totals stay correct.

### Same payload feeds Monnify
The payment summary, the Monnify amount, and the webhook validation all read `total_billed_amount`. There is no second pricing engine; the per-day breakdown is presentational.

---

## Execution order (one batch on approval)

1. **Migration** (single file) — `end_shift` / `pause_shift` / `resume_shift` / `extend_payment_window` / `drain_surcharge_due` / `get_request_billing_state` adjustments described above.
2. **`src/lib/settlement.functions.ts`** — strict cache-match in RESUME-IF-PENDING.
3. **`src/features/app/CoverageScreen.tsx`** — final-day Pause guard on list card.
4. **`src/lib/trust.ts` + `src/lib/ratings.ts`** — `null` feedback, error logging, surfaced errors.
5. **`src/features/request/ShiftSettlement.tsx`** — gated overlay open, per-day grouped summary.
6. **`src/features/cover/CoverDispatchPortal.tsx`** — snapshot `pendingRating` before dismiss.
7. **Verification** — DB re-queries on ratings/segments/trust_snapshot + visual check of the per-day summary; remove instrumentation if it fired and identified the cause, or leave a small structured log if useful for future support.

No rollback is required for any of the above. All changes are additive or targeted.
