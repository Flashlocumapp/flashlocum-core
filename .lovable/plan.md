# Multi-Day Workflow — Implementation Plan

Builds directly on the audit. Reuses `day_index`, no schema additions.

## Semantics (locked)

- `day_index` = the scheduled day currently in progress or just paused. Starts at `1`.
- On a successful **Pause** of Day N: increment `day_index` from N to N+1 atomically with closing the segment. The pause itself marks Day N complete.
- On **Resume** from `paused`: no `day_index` change — Resume just opens the next segment for the already-advanced day.
- "Completed days" displayed in the UI = `day_index - 1` while `active`, `day_index - 1` while `paused` (because Pause already advanced it).
- Timers stay **cumulative** across all days (`accumulated_ms` keeps growing; `shift_segments` keeps appending). End Shift billing untouched.
- **Final-day rule**: Pause is forbidden when `day_index >= days`. Enforced both in the DB and in the UI.

## 1. Database — `pause_shift` RPC

Edit `public.pause_shift(_request_id uuid)`:

1. After `IF r.status <> 'active'` check, add:
   ```sql
   IF COALESCE(r.day_index, 1) >= COALESCE(r.days, 1) THEN
     RAISE EXCEPTION 'Final day — use End Shift to complete this booking';
   END IF;
   ```
2. In the final `UPDATE coverage_requests` set:
   ```sql
   day_index = COALESCE(day_index, 1) + 1
   ```
   alongside the existing `status`, `started_at`, `accumulated_ms` assignments.
3. Return the new `day_index` in the JSON result for client confirmation.

`resume_shift`, `start_shift`, `end_shift` are NOT modified. `end_shift` already settles from `shift_segments` regardless of `day_index`, so early termination (Example 3) continues to work.

A grant refresh is not needed (function signature unchanged).

## 2. Client — error handling for the new guard

`src/lib/shift.functions.ts` `pauseShift`: extend the swallowed-error regex to also treat the new final-day exception as a benign no-op, surfacing a toast instead of a hard error:

```ts
if (/final day/i.test(error.message)) {
  return { ok: false, finalDay: true } as any;
}
```

`src/lib/network.ts` `pauseShift(id)`: when the server returns `finalDay`, skip the local state mutation and push a warn toast: "This is the final scheduled day — use End Shift to complete."

## 3. Client — UI guards & labels

`src/features/app/CoverageScreen.tsx`:

- The existing Pause guard (`item.status === "active" && item.days > 1 && item.dayIndex < item.days`) already does the right thing once `day_index` advances — no change needed.
- Add a small "Day X of Y" pill on both active and upcoming multi-day cards:
  - On active: `Day ${item.dayIndex} of ${item.days}`
  - On paused/upcoming after Day N pause: `Day ${item.dayIndex} of ${item.days}` (because Pause already advanced the counter, this naturally reads "Day 2 of 3" once Day 1 is complete).
- Render only when `item.days > 1`.

Doctor side — `src/features/cover/CoverDispatchPortal.tsx` (and any incoming/active card it renders): show the same `Day X of Y` pill on accepted/active/paused coverage when `days > 1`. The `dayIndex` field already flows through `coverage-remote.ts` → `network.ts` `NetRequest` → dispatch store, so it's just a render addition.

## 4. Network event handling

`src/features/cover/dispatch.ts` already handles `pause` and `resume` actions for toasts. Update the pause toast copy for multi-day shifts to read:

> "Day {prevDayIndex} of {days} complete — shift moved to Upcoming."

(`prevDayIndex = newDayIndex - 1`.) Single-day shifts keep the existing copy.

## 5. Non-changes (explicit)

- No new columns. No migration beyond editing the `pause_shift` function.
- `end_shift` settlement, Monnify payment flow, ratings flow: untouched.
- `first_started_at` and the Start-vs-Resume label: untouched.
- `accumulated_ms`: stays cumulative; per-day timer reset is **not** introduced.

## 6. Verification steps after implementation

1. 3-day booking: Start → Pause (expect `day_index=2`, status `paused`, Pause button hidden on the resumed Day 2? No — Day 2 < 3 so Pause still shown). Resume → Pause (expect `day_index=3`). Resume → Pause should now be rejected by DB and the button hidden; only End Shift available.
2. 1-day booking: Pause must remain hidden throughout (existing `days > 1` guard).
3. Early termination: Start Day 1 → Pause → Resume Day 2 → End Shift mid-Day-2 settles normally; `total_billed_amount` reflects only worked segments.
4. Doctor app shows "Day 2 of 3" after first pause.

## Order of operations

1. Migration: edit `pause_shift` RPC.
2. After migration approval and types regen: update `shift.functions.ts`, `network.ts`, `CoverageScreen.tsx`, `CoverDispatchPortal.tsx`, `dispatch.ts`.
3. Smoke-test via Playwright against the running preview.