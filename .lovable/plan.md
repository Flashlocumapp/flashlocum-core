## Scope

Two narrow UI/data-wiring fixes. No schema changes, no backend logic changes.

---

### 1. Cover & Earn (doctor side) — exact times missing

**A. Doctor history detail sheet (`DoctorCoverageDetail` in `src/features/app/CoverageScreen.tsx`)**

Today this sheet shows Amount, Settlement, Completed, Rating only. It does NOT show start/end timestamps or hours worked/billed — that's the gap the user is reporting.

Fix: pull the live request row (`net.requests[item.id]`) inside `DoctorCoverage` / `DoctorCoverageDetail` and, when the item is a completed `HistoryItem`, render four extra rows in the existing detail card:

- **Started** — `firstStartedAt` formatted as "Wed, 18 Jun, 9:00 AM" (same `fmtMoment` helper used in `HistoryDetailSheet`).
- **Ended** — `paidAt`, falling back to `updatedAt` when `paidAt` is null.
- **Hours worked** — `accumulatedMs / 60000`, formatted with the existing `fmtHrMin` helper.
- **Hours billed** — same value (server billed = accumulated minutes today).

**B. Doctor "Payment received" overlay (`PaymentSummaryOverlay` via `CoverDispatchPortal.tsx`)**

The component already accepts and conditionally renders these rows, but the wiring in `CoverDispatchOverlays` produces nulls in two cases:
- `endedAtMs` falls back to `paymentDueAt - 15min` which is often null after completion.
- After `complete_request`, the request row's `startedAt` is cleared, so `firstStartedAt ?? startedAt` may still resolve to `firstStartedAt`, but if `firstStartedAt` is not present on the local row patch, the row is blank.

Fix in `CoverDispatchPortal.tsx`:
- `endedAtMs`: `reqRow?.paidAt ?? reqRow?.updatedAt ?? null`.
- `startedAtMs`: keep `firstStartedAt`, but if missing AND `accumulatedMs` and `endedAtMs` are both known, derive `endedAtMs - accumulatedMs` as a last-resort fallback so the row never hides for older rows that pre-date `first_started_at`.

No changes to `PaymentSummaryOverlay.tsx` itself.

---

### 2. Request Coverage — rating form keeps re-appearing in History

**Root cause:** the requester's history rating state lives in `useState<Record<string, number>>({})` local to `RequesterCoverage` (`CoverageScreen.tsx`, line 298). It is only seeded when the user submits a rating via the `HistoryDetailSheet`. When the requester rates via the post-End-Shift `RatingOverlay` in `ShiftSettlement.tsx` (or rated in a previous session), the local map is empty, so opening the history detail re-shows the form even though the rating exists in the `ratings` table.

**Fix:** introduce a tiny shared "rated shifts" store and seed it from the backend on mount.

1. Create `src/lib/rated-shifts.ts`:
   - In-memory `Set<string>` + pub/sub (`subscribe`, `markRated(shiftId)`, `isRated(shiftId)`, `useRatedShifts()`).
   - Persist to `sessionStorage` so a refresh in the same tab keeps the state until the backend hydration completes.

2. Hydrate from the backend once per session inside `useRatedShifts()` (or a one-shot effect in `RequesterCoverage`):
   ```
   supabase.from("ratings")
     .select("shift_id")
     .eq("rater_user_id", auth.user.id)
     .not("shift_id", "is", null)
   ```
   then call `markRated()` for each row. RLS already permits participants to read these rows.

3. Wire writers:
   - `ShiftSettlement.tsx` `RatingOverlay onSubmit` (line ~1452): after a successful `submitShiftRating`, call `markRated(shiftId)`.
   - `CoverageScreen.tsx` `HistoryDetailSheet onRate` (line ~718): after a successful `submitShiftRating`, call `markRated(id)` (in addition to the existing `setRatings`).
   - `CoverDispatchPortal.tsx` doctor-side `RatingOverlay onSubmit` (line ~111): same call after successful submit, so doctors who already rated also see the form collapse in their own history.

4. Wire reader in `CoverageScreen.tsx`:
   - In the `historyDetail` builder, treat `ratings[historyItem.id] ?? (isRated(historyItem.id) ? 0 : undefined)` as the effective rating signal. Pass an extra `alreadyRated: boolean` flag to `HistoryDetailSheet`.
   - In `HistoryDetailSheet.tsx`, change the `showRating` guard to also hide the form when `alreadyRated` is true (even when no numeric score is known locally — we don't need to know which star count was given, just that the user already rated).

This makes a rating submitted anywhere — End-Shift overlay, history sheet, previous session — collapse the form in the history detail on every device the user is signed into.

---

## Files touched

- `src/lib/rated-shifts.ts` (new — ~50 lines, pub/sub + sessionStorage + one-shot hydration helper)
- `src/features/app/CoverageScreen.tsx` (DoctorCoverageDetail rows; hydrate + read rated-shifts; HistoryDetailSheet prop wiring)
- `src/features/request/ShiftSettlement.tsx` (markRated after successful submit)
- `src/features/cover/CoverDispatchPortal.tsx` (endedAtMs/startedAtMs fallbacks; markRated after successful submit)
- `src/components/HistoryDetailSheet.tsx` (accept `alreadyRated` prop; extend `showRating` guard)

## Out of scope

- No DB migrations, no RLS changes, no edits to the rating RPC or trust pipeline.
- No changes to admin dashboard ratings view.
- No changes to `PaymentSummaryOverlay.tsx` markup.
