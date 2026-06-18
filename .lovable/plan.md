## Audit findings

I traced every rating from overlay → client adapter → RPC → table → trigger → admin view. Three real defects, all data-visible.

### 1. Doctor → Requester comments are silently dropped (data-loss bug)

`RatingOverlay.onSubmit` is typed `(rating, feedback) => void` and the requester side passes both. The **cover (doctor) side** doesn't:

```tsx
// src/features/cover/CoverDispatchPortal.tsx:87
onSubmit={(rating) => {                               // ← feedback arg omitted
  if (rating > 0 && pendingRating) {
    void recordRating(pendingRating.hospitalId, rating, pendingRating.requestId);
    // feedback never reaches recordRating, so submit_shift_rating(_feedback => undefined)
  }
}}
```

`recordRating` forwards `feedback ?? null`, and `submit_shift_rating` inserts `NULLIF(_feedback,'')` into `ratings.feedback`. End result: every comment a doctor types is discarded before it leaves the browser. Database confirms — of 3 ratings in `public.ratings`, **0** are `ratee_entity_id LIKE 'req:%'` and only 1 of the 3 doctor-side rows has feedback. The doctor side has never written a comment.

### 2. `recordRating` adapter swallows errors

The requester path uses `submitShiftRating` directly and toasts non-`already_rated` failures. The cover path uses the legacy `recordRating` wrapper, which returns `SubmitResult | null` but is fired with `void` — any `not_terminal` / `unknown` / network error is silently lost. No console log, no toast, no retry.

### 3. Admin Shift Monitoring does not show per-shift ratings or comments

`/_admin/admin/shifts` renders columns: Status, Hospital, Schedule, Requester, Doctor, Amount, Payment, Updated. There is **no** rating column, no comment cell, no detail drawer. `admin_list_shifts` (`src/lib/admin.functions.ts`) doesn't even select the existing `requester_rating_score / requester_rating_at / doctor_rating_score / doctor_rating_at` columns that the `_ratings_after_insert` trigger already maintains on `coverage_requests`, and it never joins `ratings.feedback`. The standalone `/_admin/admin/ratings` page lists ratings flat, not per-shift, so an admin opening a specific shift cannot see either side's rating or comment.

### Things that ARE correct (no changes needed)

- `ratings` schema: `shift_id`, `rater_user_id`, `ratee_entity_id`, `score` are all `NOT NULL`; `feedback` is nullable text. A unique index prevents double-rating.
- `submit_shift_rating` (SECURITY DEFINER) derives `ratee_entity_id` from the shift row + caller — clients **cannot** spoof the ratee. Authorization is enforced (caller must be `requester_id` or `accepted_by`).
- `_ratings_after_insert` trigger updates `coverage_requests.{doctor,requester}_rating_*` and calls `recompute_trust(ratee)`. Trust snapshot pipeline works.
- DB integrity: `count(*) FILTER (WHERE shift_id IS NULL) = 0` — no orphan ratings.
- RLS: previous migration scoped `ratings` SELECT to participants + admins (`has_role(admin)`), so the admin view can read every row via the admin client.

## Plan

### Step 1 — Persist the doctor's comment (fix the data-loss bug)

`src/features/cover/CoverDispatchPortal.tsx`

- Change `onSubmit={(rating) => ...}` to `onSubmit={(rating, feedback) => ...}`.
- Replace the `recordRating(...)` call with a direct `submitShiftRating(requestId, rating, feedback || null)` (mirror the requester side), and surface non-`already_rated` errors via `pushToast({ tone: "warn", title: res.message })`. Keep the local `recordHistoryRating` mirror.
- Remove the now-unused `recordRating` import from this file.

No DB change is needed — `submit_shift_rating` already accepts `_feedback`.

### Step 2 — Extend `admin_list_shifts` payload with rating data

`src/lib/admin.functions.ts` (`adminListShifts`):

- Add to the `.select(...)` on `coverage_requests`: `requester_rating_submitted, requester_rating_score, requester_rating_at, doctor_rating_submitted, doctor_rating_score, doctor_rating_at`.
- After fetching shifts, fire one extra `supabaseAdmin.from("ratings").select("shift_id, ratee_entity_id, score, feedback, created_at").in("shift_id", shiftIds)` query, then attach to each row:
  - `requester_to_doctor: { score, feedback, created_at } | null` (the row where `ratee_entity_id LIKE 'doc:%'`)
  - `doctor_to_requester: { score, feedback, created_at } | null` (the row where `ratee_entity_id LIKE 'req:%'`)
- Update the exported `AdminShiftRow` type accordingly.

### Step 3 — Render ratings in Admin Shift Monitoring

`src/routes/_admin.admin.shifts.tsx`:

- Add a **Ratings** column to the table. Each cell shows two compact lines:
  - `R→D: ★4 "comment…"` (requester rated the doctor)
  - `D→R: ★5 "comment…"` (doctor rated the requester)
  - Missing side renders as a muted "—".
- Clicking the row opens a lightweight `<RatingDetail>` drawer (reuses existing `Chip` styling) showing each side's full feedback text, score, timestamp, and rater name. No new route — drawer state lives in the page component.

### Step 4 — Drop the dead `recordRating` adapter

`src/lib/ratings.ts`:

- After Step 1, no caller passes a real feedback through `recordRating`. Mark it `@deprecated` in JSDoc and forward to `submitShiftRating` (already does). No behavior change, but documents the path so the next maintainer doesn't reintroduce the lossy callsite.

### Step 5 — Verification

After Step 1, do a complete shift, doctor rates with a comment, requester rates with a comment. Verify in DB:

```sql
SELECT ratee_entity_id, score, feedback, shift_id
FROM public.ratings
WHERE shift_id = '<test-shift>'
ORDER BY created_at;
```

Two rows must appear, both with `feedback` non-null, `shift_id` set, `rater_user_id` matching the respective caller. Then open `/_admin/admin/shifts`, find the shift, confirm the Ratings column shows both sides and the drawer shows both comments.

### Out of scope

- The "account details not loading" Monnify spinner from the previous turn — separate issue.
- Reliability score formula (`reliability` in trust snapshot) — already computed server-side correctly; this audit only addresses ratings + comments + admin visibility.
- Migrating legacy `hosp:<slug>` ratings — none exist (`count = 0`).
- Reworking the standalone `/_admin/admin/ratings` page — it already shows rater/ratee/shift; the deficit was per-shift visibility, fixed by Step 3.

### Files to change

- `src/features/cover/CoverDispatchPortal.tsx` — pass feedback, use `submitShiftRating`, toast errors.
- `src/lib/admin.functions.ts` — extend `adminListShifts` select + join ratings.
- `src/routes/_admin.admin.shifts.tsx` — Ratings column + detail drawer.
- `src/lib/ratings.ts` — JSDoc deprecation note on `recordRating`.

No database migration. No new dependencies.
