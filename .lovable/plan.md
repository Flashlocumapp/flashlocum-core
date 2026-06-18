# 14-Day Booking Limit — Audit Report

## Findings: every location that enforces or mentions the 7-day cap

### 1. Database (Supabase)
Result: **no DB enforcement of a 7-day booking maximum.**

Checked:
- `coverage_requests` CHECK constraints → only `environment_check` exists; nothing on `days`.
- All `public` functions whose source contains `7` — none gate booking duration on 7.
- `validate_shift_schedule(_start, _end)` → only enforces "end > start" and 30-min lead time. No max-duration check.
- `compute_quote(...)` → no day cap; prices any duration.
- `end_shift`, `pause_shift`, `start_shift`, `resume_shift`, `bump_request_rev_on_change` → use `r.days` as data (loop/total), never compare to 7.
- Triggers: none reference 7.

Unrelated `7` hits (analytics windows, not booking limit — leave alone):
- `supabase/migrations/20260604082111_…sql:60` and `20260617000353_…sql:218` — `interval '7 days'` for `active_week` profile counter.

### 2. Request Creation UI
- **`src/features/request/RequesterHome.tsx:833–841`** `dateBounds()` returns `min = today`, `max = today + 6` (the 7-day window). Used at lines 858, 876–877 as `min/max` on the start-date input and as a clamp in the `useEffect` at 860–867.
- **`src/features/request/RequesterHome.tsx:859`** comment: `// Clamp start date into the 7-day operational window if it drifts.`
- **`src/features/request/RequesterHome.tsx:992–999`** date input cap toast: `"Coverage requests are limited to 7 days maximum."`
- **`src/features/request/RequesterHome.tsx:1061–1078`** `DaysStepper` — Stepper `min={1}, max={7}` plus cap toast `"Coverage requests are limited to 7 days maximum."`
- **`src/features/request/RequesterHome.tsx:258`** coverage switch clamp: `setDays((d) => (d < 1 || d > 7 ? 1 : d))`.

No calendar component (`react-day-picker`) is used in the request flow — it's a native `<input type="date">`.

### 3. Multi-day workflow
- No `day_index <= 7` checks. `dayLabel`, `durationHrsOf`, `shiftWindow`, `computePricing` in `RequesterHome.tsx` (171–206) and `EarningsScreen/CoverageScreen` use `days` as a numeric multiplier with no upper bound.
- `end_shift` server function loops through all `shift_segments` for a request regardless of count.
- Pause/Resume/Final-day detection (`shift.functions.ts`) is segment-based; no 7 assumption.

### 4. Pricing system
- `compute_quote` SQL and `src/lib/pricing.ts` are per-period. Multi-day totals are computed client-side as `perDay × days` (e.g. `RequesterHome.tsx:1389`, `CoverageScreen.tsx:372`). No 7-day ceiling.

### 5. Doctor-side experience
- `src/features/cover/CoverDispatchPortal.tsx`, `CoverHome.tsx`, `CoverageScreen.tsx` — no 7-day text or logic. They render `days` directly from `coverage_requests.days`.

### 6. Requester-side experience
- Covered under §2. The only requester-facing 7-day strings are the two toasts at `RequesterHome.tsx:996` and `:1073`.

### 7. Admin dashboard
- **`src/routes/_admin.admin.risk.tsx:50`** — filter option `<option value={7}>Last 7 days</option>`. This is an analytics time-range, **not** the booking limit. Leave alone.
- **`src/lib/admin.functions.ts:767`** — `if (mins > 0 && mins < 7 * 24 * 60)` caps the time-to-fill sample at 7 days. Analytics sanity guard, **not** a booking-limit rule. Should be widened to 14 days to keep matching the new max (recommended, low risk).
- No admin table/report enforces a 7-day max on the booking itself.

### 8. Help center & documentation
- **`src/routes/_app.help.tsx:80`** — `<li>Multi-day (up to 7 days)</li>`
- **`src/routes/_app.help.tsx:271`** — `<li>Multi-day (up to 7 days)</li>`
- **`src/routes/_app.help.tsx:410`** — `<p>One assignment can last multiple days (max 7 days). …</p>`

### Unrelated 7s (do NOT change)
- `src/features/app/EarningsScreen.tsx:86` — "this week" range, last 7 days.
- `src/components/ui/sidebar.tsx:22` — sidebar cookie max-age (7 days).
- Various SVG path coords containing `7`.

---

## Implementation Plan: raise the cap from 7 → 14 days

Scope is small — there is no DB constraint to migrate. All changes are frontend.

### Step 1 — Single source of truth
In `src/features/request/RequesterHome.tsx`, introduce a module-level constant:

```ts
const MAX_BOOKING_DAYS = 14;
```

Use it everywhere instead of literal `7` / `6`.

### Step 2 — `dateBounds()` (lines 833–841)
Change `max.setDate(max.getDate() + 6)` → `max.setDate(max.getDate() + (MAX_BOOKING_DAYS - 1))`. Update the comment on line 859 to say "14-day operational window".

### Step 3 — `DaysStepper` (lines 1061–1078)
- `max={MAX_BOOKING_DAYS}`
- Toast title → `"Coverage requests are limited to 14 days maximum."`

### Step 4 — Date input cap toast (lines 992–999)
Update the toast string to `"Coverage requests are limited to 14 days maximum."`

### Step 5 — Days clamp on coverage switch (line 258)
`setDays((d) => (d < 1 || d > MAX_BOOKING_DAYS ? 1 : d))`.

### Step 6 — Help center copy (`src/routes/_app.help.tsx`)
Lines 80, 271, 410 — replace "7 days" with "14 days".

### Step 7 — Admin analytics time-to-fill guard (optional, recommended)
`src/lib/admin.functions.ts:767` — change `7 * 24 * 60` → `14 * 24 * 60` so genuinely long fills aren't filtered out of admin metrics.

### Step 8 — Verification (no DB migration needed)
- Confirm `validate_shift_schedule`, `compute_quote`, `end_shift` already accept arbitrary `days` (they do — verified above).
- Manual QA: create a 14-day standard and 14-day home-care request; verify pricing, dispatch, pause/resume across day boundaries, end-shift settlement.

### Out of scope (explicitly leave unchanged)
- All `interval '7 days'` analytics windows in DB and UI (`active_week`, "Last 7 days" filter, earnings "this week").
- Sidebar cookie max-age.
- Any database CHECK constraint or trigger (none exist for this rule).
