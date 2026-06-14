# Environment + Multi-Day Payment Flow Overhaul

## 1. Environment Selector UI (RequesterHome booking sheet)

- Remove the "Busy multiplies pricing × 1.25" hint inline.
- Keep the two-pill **Normal / Busy** toggle, no pricing copy.
- Move the whole Environment block to sit **above** the "Note (optional)" field.
- Add helper text directly under the toggle:
  - **Normal** — Standard working conditions
  - **Busy** — High workload environment
- Backend already persists `environment` on `coverage_requests` — no schema change.

## 2. Environment Visibility (doctor side)

Surface a small `Normal` / `Busy` chip wherever a doctor sees a shift, using a shared `<EnvironmentBadge environment={...} />` component (neutral for normal, warning tone for busy, no pricing text):

- **New Request** card — `CoverDispatchPortal` incoming dispatch card.
- **Upcoming Coverage / Active Shifts** — `CoverHome` accepted-shift cards.
- **History** — `HistoryDetailSheet` row + detail.
- **Earnings** — `EarningsScreen` per-shift rows.

Coverage payload already carries `environment` end-to-end via `coverage-remote.ts`; just render it.

## 3. Pause / End Confirmation + Payment-Gated Flow

### Pause Shift (multi-day intent)

1. Requester taps **Pause Shift** → modal:
   > "Pausing this shift means you are closing today's work and proceeding to payment for the completed shift. You can resume the shift anytime under Upcoming Coverage."
   - Buttons: **Cancel** / **Pause & Pay**.
2. On confirm → call `pause_shift` RPC (already bills the open segment + sets `payment_due_at`) → immediately open the existing Monnify checkout sheet for that segment amount.
3. UI stays on the settlement screen until the **Monnify webhook** marks the segment paid (existing `mark_settlement_paid` already stamps `shift_segments.settled_at`).
4. Polling (`getRequestBillingState`) detects `segments[last].settled_at IS NOT NULL` and `payment_status='paid'`:
   - Show "Paid — shift moved to Upcoming Coverage" toast.
   - Route requester back to home; the request now appears in Upcoming because `status='paused'` and the latest segment is settled (clears the "blocked from resume" state).
5. Doctor side: same shift surfaces under Upcoming again with the same `environment` badge. Resume creates a fresh segment with its own start time (already handled by `resume_shift`).

### End Shift (final settlement)

1. **End Shift** → modal:
   > "Ending this shift means you are closing the entire assignment and proceeding to final payment for completed work."
   - Buttons: **Cancel** / **End & Pay**.
2. On confirm → `end_shift` RPC → open Monnify checkout for the final outstanding amount.
3. Shift only renders as **Completed / Closed** once the webhook flips `payment_status='paid'`. Until then the settlement screen shows "Awaiting payment confirmation" with the existing 15-min window + auto-extension already wired.

### Backend truth rule

- No frontend code flips `status` to `accepted` (upcoming) or `completed` (closed-final) on its own. The DB RPCs + Monnify webhook remain the single source of truth.
- `pause_shift` already sets `status='paused'` and creates `payment_due_at`; that's the "awaiting payment" state for a paused day. The UI now treats "paused + latest segment unsettled" as **pending payment**, and "paused + latest segment settled" as **upcoming / resumable**.
- `end_shift` already sets `status='completed'` + `billing_locked_at`; the UI now treats `completed && payment_status!='paid'` as **awaiting final payment** (not yet shown as closed in history).

No DB migration needed — all required fields (`environment`, `payment_status`, `shift_segments.settled_at`, `billing_locked_at`, `payment_due_at`) already exist.

## Files to touch

- `src/features/request/RequesterHome.tsx` — reorder Environment block, drop multiplier copy, add helper text.
- `src/features/request/ShiftSettlement.tsx` — confirmation modals for Pause/End, gate state transitions on `segments[last].settled_at` / `payment_status`.
- `src/components/EnvironmentBadge.tsx` *(new)* — shared chip.
- `src/features/cover/CoverDispatchPortal.tsx`, `src/features/cover/CoverHome.tsx`, `src/components/HistoryDetailSheet.tsx`, `src/features/app/EarningsScreen.tsx` — render badge.
- (No backend / migration changes.)

## Out of scope

- Changing pricing logic or the 1.25× multiplier itself (still applied server-side, just hidden in UI).
- Restructuring how Monnify checkout is initiated (reuse the current sheet).
