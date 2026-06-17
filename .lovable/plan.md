## Goal
Close two gaps found in the audit:
1. Doctor-side rating comments are collected in the UI but dropped before reaching the database.
2. Rating comments are never shown anywhere in the Admin Dashboard.

## Scope
Frontend + one admin server function. No DB schema change needed — `public.ratings.feedback text` already exists and the `submit_shift_rating(_request_id,_score,_feedback)` RPC already writes it.

---

## Part A — Persist doctor comments

**File: `src/lib/ratings.ts`**
- Extend `recordRating(entityId, value, shiftId, feedback?)` with an optional `feedback: string | null` param and forward it: `submitShiftRating(shiftId, value, feedback)`.

**File: `src/features/app/CoverageScreen.tsx`** (line ~1390)
- The component already has a `feedback` state (line 1282) bound to the textarea. Pass it into the call:
  `void recordRating(hospitalEntityId(item.hospital), rating, item.id, feedback)`.

**File: `src/features/cover/CoverDispatchPortal.tsx`** (line ~89)
- Pass `pendingRating.feedback ?? null` (add a `feedback` field to the `pendingRating` state shape if the overlay collects one; otherwise pass `null` so the signature stays consistent). Confirm the overlay used here exposes feedback — if not, leave `null` and only the CoverageScreen path persists comments. (No new overlay UI in this plan.)

Requester path (`ShiftSettlement.tsx`) already passes feedback — no change.

## Part B — Surface comments in Admin Dashboard

**Backend: `src/lib/admin.functions.ts`**
- Add `adminListRatings` server fn (`requireSupabaseAuth` + admin role check, matching the existing admin fn pattern in that file). Returns most-recent ratings with: `id, score, feedback, created_at, shift_id, rater_user_id, ratee_entity_id`, plus joined display names for rater and ratee (look up via `profiles` for `doc:`/`req:` prefixed ratee ids).
- Filters: `ratee_entity_id?`, `min_score?`, `only_with_feedback?: boolean`, pagination (`limit`, `cursor`).

**Frontend: new `src/features/admin/RatingsFeed.tsx`**
- Table/list of ratings showing stars, comment (when present), reviewer → reviewee, shift id (link to existing admin shift drawer), timestamp.
- Toggle "Only with comments".
- Wire into the existing Admin Dashboard navigation alongside Trust Snapshots (add a tab/link — follow the existing admin shell pattern).

**Per-user drawer enrichment (Trust Snapshots)**
- In the existing user drawer on the Trust Snapshots page, add a "Recent comments" section that calls `adminListRatings({ ratee_entity_id, only_with_feedback: true, limit: 20 })`.

## Verification
1. Submit a doctor rating with a comment from CoverageScreen → confirm row in `public.ratings` with non-null `feedback`.
2. Submit a requester rating with a comment from ShiftSettlement → same confirmation.
3. Open Admin → Ratings feed → comment is visible with stars and names.
4. Open Trust Snapshots drawer for that user → "Recent comments" lists the new entry.
5. Build clean; no regressions in existing rating submission path (already-rated path still silent).

## Out of scope
- Editing/deleting ratings from admin.
- Moderating or flagging comments.
- Any schema change to `ratings` (column already exists).
- Adding a feedback textarea to `CoverDispatchPortal` if its current overlay doesn't have one (separate UX decision).
