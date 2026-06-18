## Audit Report — `paused` Status Handling

### Summary

`pause_shift` RPC sets `coverage_requests.status='paused'` and closes the open `shift_segments` row (preserving accumulated time). No billing/settlement/Monnify/rating side effects. The bug is purely in the UI/dispatch layers: several filters omit `paused`, so the shift vanishes for both requester and doctor.

### All status-handling sites reviewed

| File | Lines | Handles `paused`? | Action |
|---|---|---|---|
| `src/lib/coverage-remote.ts` | 153–173 | ✅ Maps DB↔net both directions | none |
| `src/features/app/CoverageScreen.tsx` (`toRequestItem`) | 100–108 | ❌ Falls through to `"completed"` | **fix: map → `"upcoming"`** |
| `src/features/app/CoverageScreen.tsx` (Requester items filter) | 187–195 | ❌ Excluded from whitelist | **fix: add `"paused"`** |
| `src/features/cover/dispatch.ts` (`active` flag) | 81 | Correctly false for paused | none |
| `src/features/cover/dispatch.ts` (doctor upcoming) | 188 | ❌ Excluded | **fix: add `"paused"`** |
| `src/features/cover/dispatch.ts` (currentRequest selector) | 318 | ❌ Excluded | **fix: add `"paused"`** |
| `src/features/cover/dispatch.ts` (resume-target selector) | 421 | ❌ Excluded | **fix: add `"paused"`** |
| `src/features/cover/CoverHome.tsx` | — | No status filters (consumes `useDispatch().upcoming`) — fixed transitively | none |
| `src/features/app/EarningsScreen.tsx` | 113 | Filters by `outcome === "completed"` only — paused untouched | none |
| `src/features/request/RequesterHome.tsx` | 1203, 1277 | Refers to *pre-acceptance broadcast* pause (different lifecycle phase — before `acceptedBy` is set). A shift-level `paused` always has `acceptedBy` so dispatch stage won't reuse it. | none |
| `src/routes/_admin.admin.shifts.tsx` | 27, 38, 132 | ✅ First-class `paused` tab | none |
| `src/features/cover/dispatch.ts` event handler `pause` | 363–367 | Toast only — no state filter | none |

### Fix Plan (presentation layer only)

**1. `src/features/app/CoverageScreen.tsx`**
- `toRequestItem` (lines 101–108): add `r.status === "paused" → "upcoming"` mapping ahead of the `else "completed"` fallback.
- `RequesterCoverage` items filter (lines 187–195): add `r.status === "paused"` to the whitelist.

**2. `src/features/cover/dispatch.ts`**
- Line 188 (doctor's upcoming list): add `"paused"` to the whitelist so the doctor still sees and can resume the paused shift.
- Line 318 (currentRequest dedup selector): add `"paused"`.
- Line 421 (resume-target lookup): add `"paused"`.
- Line 81 (`active` flag): **leave unchanged** — paused must not render with the live timer.

No changes to:
- `pause_shift` / `resume_shift` RPCs
- `coverage-remote.ts` (mapping already correct)
- Settlement, Monnify, ratings, billing, email, notifications

### Verification Report (to produce after build)

For each scenario, capture: DB row state, items list on requester, items list on doctor.

- **Scenario 1 — Pause:** Start a multi-day shift → Pause.
  - Expect DB: `status='paused'`, latest `shift_segments.ended_at` set, no `paid_at`, no new `ratings`, no new `email_send_log`.
  - Expect UI: shift appears in **Upcoming** tab for both requester and doctor; timer stopped; "accumulated time" badge visible.
- **Scenario 2 — Resume:** Click Resume.
  - Expect DB: `status='active'`, new open segment.
  - Expect UI: shift in **Active** tab on both sides, timer continues from accumulated total.
- **Scenario 3 — Pause/Resume ×3:** Shift stays visible the whole time; segment count grows; zero settlement/rating/Monnify side effects.
- **Scenario 4 — End:** Settlement flow opens, Monnify checkout fires, shift stays Active until webhook marks paid, then moves to History. (Unaffected by this change.)

Verification will query `coverage_requests`, `shift_segments`, `ratings`, `payment_underpayments`, `email_send_log` directly and inspect the rendered CoverageScreen and CoverHome states.

### Out of scope

Monnify webhook reconciliation (separate prior thread).
