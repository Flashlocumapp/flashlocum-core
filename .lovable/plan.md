## Scope

Four targeted fixes. UI/presentation + small data-plumbing only. No backend schema changes, no payment-architecture changes.

---

### 1. Countdown resets on page refresh

**Symptom:** the 15-minute settlement countdown jumps back to a fresh value after every refresh of the payment page.

**Root cause (in `src/features/request/ShiftSettlement.tsx`):**
- The reset effect (lines ~242-323) depends on `serverPaymentDueAt`. On a refresh, the row is fetched async — the sheet opens with `serverPaymentDueAt = null` first, then the value arrives and the effect re-runs. On the first pass, `phaseStartedAtRef` is anchored to `simNow()` (the fallback), so the countdown briefly resets.
- Additionally, the `intent` and `requestId` identity-only deps still cause the effect body to re-seed `phaseStartedAtRef` / `frozenAmountRef` even when the server deadline is already known and unchanged.

**Fix:**
- Gate the reset effect so that when `alreadyAwaitingPayment === true`, it WAITS for a valid `serverPaymentDueAt` before anchoring refs (skip the `simNow()` fallback entirely for restored sessions).
- Make refs idempotent: only write `phaseStartedAtRef` / `endedAtRef` / `frozenAmountRef` if they are currently null OR if the new anchored value differs by >1s. Prevents re-seeding on identical re-renders.
- Stop the `serverTotalBilledAmount` change from re-triggering full reset; split it into its own small effect that only updates `frozenAmountRef`.
- In `CoverageScreen.tsx` auto-restore: don't open `ShiftSettlement` until `net.requests[id].paymentDueAt` is present for an `awaiting_payment` row (one extra tick), so the sheet never mounts with `null` first.

---

### 2. Exact start / end / billed-hours on summary, confirmed, and history pages

Show, on a single read of `shift_segments` (already loaded on the confirmed pane):
- **Started at** — first segment's `started_at`
- **Ended at** — last closed segment's `ended_at`
- **Actual hours worked** — sum of `(ended_at - started_at)` across segments
- **Hours billed** — sum of `billed_minutes` across segments

**Files:**
- `src/features/request/ShiftSettlement.tsx → ConfirmedPane`: add a "Shift times" block above "Settled" with Started / Ended / Worked / Billed rows derived from existing `segments[]` (already in scope, see lines 1256-1273). No new fetch.
- `src/components/PaymentSummaryOverlay.tsx`: extend props with `startedAt`, `endedAt`, `actualMinutes`, `billedMinutes` and render the same four rows. Update the doctor caller (`CoverDispatchPortal`) to pass them from the existing segment data.
- `src/components/HistoryDetailSheet.tsx`: extend the `HistoryDetail` type with the same four fields; render the rows above the Settlement amount for both doctor and requester history.
- `src/lib/coverage-remote.ts`: when mapping a history row, derive the four values from `shift_segments` already returned (or add a lightweight `select` of `started_at, ended_at, billed_minutes` ordered by `segment_index`) and surface them on the `HistoryDetail` shape that `CoverageScreen.tsx` and the doctor `EarningsScreen.tsx` already consume.

Formatting: reuse `fmtSegTime` (already in `ShiftSettlement.tsx`) for timestamps; reuse `fmtHrMin` for durations.

---

### 3. Remove device-settings disclaimer in Account tab

`src/features/app/AccountScreen.tsx` line 320-322: delete the entire `<p>` block:

```text
Disabling push here mutes in-app alerts. To stop banners on your lock
screen, change notification permission in your device settings.
```

No replacement copy.

---

### 4. History-Coverage rating sheet does not close / persist after submit

**Symptom:** Rating + comment submit successfully (visible in admin), but `HistoryDetailSheet` keeps showing the rating form / does not visually acknowledge that the rating was saved.

**Root cause (in `src/features/app/CoverageScreen.tsx` lines 652-660):**
- `onRate` only writes to local `ratings` state and closes the sheet. It never calls `submitShiftRating`, so the server rating is set via a different path (settlement RatingOverlay). On re-open of the same history row, `item.rating` from the server snapshot may not be populated, so `showRating = !item.rating` stays true and the form re-appears.

**Fix:**
- In `HistoryDetailSheet.tsx`: after the user taps Submit, await the parent's `onRate` (make it async-aware) and locally flip an internal `submittedRating` state so the form immediately collapses to "You rated this coverage X / 5" — independent of server refresh latency.
- In `CoverageScreen.tsx` `onRate` handler: call `submitShiftRating(id, rating, feedback)` from `@/lib/trust`, then on success update local state AND close. On `already_rated` treat as success. On error, show the existing `pushToast` and keep the sheet open.
- Ensure `item.rating` is hydrated from the server: in `coverage-remote.ts` history mapper, populate `rating` from the existing `ratings` table read (or `get_shift_rating_state` if already cached) so subsequent opens skip the form entirely.

---

## Out of scope

- Monnify split-payment / Reserved Account architecture (unchanged).
- Server schema (no migrations).
- Any change to live `endShift` RPC behavior.

## Verification

- Refresh the payment page mid-countdown three times in a row: timer continues from server `payment_due_at`, never jumps back to 15:00.
- Open Settlement Confirmed and Payment Summary after a multi-segment shift: Started / Ended / Worked / Billed match the values in admin → Shifts.
- Account tab: disclaimer paragraph is gone.
- Rate a completed shift from History (both doctor and requester): form collapses immediately, sheet closes, re-opening the row shows "You rated this coverage X / 5".
