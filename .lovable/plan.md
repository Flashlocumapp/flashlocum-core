## Audit summary

**Backend (verified):** `pause_shift` and `resume_shift` do not touch any billing/payment fields (`total_billed_amount`, `settled_amount`, `payment_status`, `paid_at`, `billing_locked_at`). Segments are never deleted on pause; `end_shift` sums minutes across all segments (`sum_worked + seg_worked`), so the timer is continuous and billing happens exactly once. State machine is correct.

**Defect:** UI-only. In `src/features/app/CoverageScreen.tsx`, an active multi-day card renders Pause + End in the primary action row (lines 844–869) AND a second "End Shift" in the secondary row (lines 898–903) when `isActive && days > 1 && dayIndex < days`.

## Fix
In `src/features/app/CoverageScreen.tsx`, change the secondary action block's condition from
```tsx
((isActive && item.days > 1 && item.dayIndex < item.days) ||
 (isUpcoming && (item.accumulatedMs > 0 || item.dayIndex > 1)))
```
to
```tsx
(isUpcoming && (item.accumulatedMs > 0 || item.dayIndex > 1))
```

Result on active multi-day cards: **1 Pause Shift + 1 End Shift** in the primary row, no duplicate. Upcoming-continuation cards still expose a secondary "End Shift" so the requester can end the whole assignment without first resuming.

## Verification (after edit)
1. Active multi-day card in preview → exactly one Pause and one End button.
2. Paused (upcoming) card → "Resume Shift" up top + secondary "End Shift" below.
3. Query `coverage_requests` before/after Pause: billing fields unchanged, `status='paused'`, latest `shift_segments` row has `ended_at` set.
4. Query after Resume: new `shift_segments` row with incremented `segment_index`, `ended_at IS NULL`, billing fields still untouched, `status='active'`.
5. After End: `status='awaiting_payment'`, `total_billed_amount` populated, summed minutes across all segments equal the total worked time.

## Out of scope
Backend changes, single-day card layout, payment webhook flow.