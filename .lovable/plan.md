
Implementing the 6 approved items. The freeze-enforcement migration has already been applied (start_shift / resume_shift / claim_coverage_request / insert trigger now block on `trust_frozen_at`, while active shifts continue normally). Remaining code changes below.

## 1. Persistent signed-URL cache — `src/lib/selfie-url.ts`

Rewrite the in-memory cache to persist to `localStorage` and use the URL's actual `exp` claim:
- Hydrate from `localStorage` on module load so `getSelfieUrl(path)` returns synchronously on cold start.
- Parse `exp` from the signed-URL token; stale-while-revalidate when within 5 min of expiry.
- Drop expired entries; debounced 250 ms writeback.

Net effect: requester and doctor profile photos appear instantly on refresh / tab restore / native resume — no more loading flash.

## 2. Stable image rendering — `src/components/StableImage.tsx`

Add optional `stableKey` prop. When absent, derive key by stripping the query string from `src` so signed-URL token refreshes within the same logical asset don't tear down the `<img>` node and re-decode the JPEG.

## 3. Freeze / Unfreeze (server-side, DONE via migration)

Already applied:
- `_cr_enforce_account_restriction` trigger now also rejects INSERT (requester frozen) and accept-update (doctor frozen) with `Account frozen: ...`.
- `claim_coverage_request` raises `Account frozen`.
- `start_shift` and `resume_shift` raise `Account frozen`.
- `end_shift`, `pause_shift`, `cancel_shift`, Monnify webhook untouched → active shifts run to completion and settle normally.

Client surface (small):
- Extend `ProfileRow` in `src/lib/profile-remote.ts` with `trust_frozen_at` / `trust_frozen_reason`, add them to `MEANINGFUL_PROFILE_KEYS` so the existing realtime `profiles` channel fans the change out to every consumer immediately — no logout, no restart. The existing toast/error path in dispatch + RequesterHome will surface the RPC's "Account frozen" message verbatim.

## 4. Awaiting Payment filter — `src/routes/_admin.admin.shifts.tsx` + `src/lib/admin.functions.ts`

- Extend `AdminShiftRow` with `ended_at`, `payment_reference`, and `current_payable_amount` (base + outstanding surcharge from `payment_surcharge_log`).
- Update `adminListShifts` to project those columns and (for the awaiting-payment slice) aggregate `payment_surcharge_log` per shift.
- Add `awaiting_payment` to the `Status` union and as a filter chip; count rows where `status='awaiting_payment'` OR (`status='completed'` AND `paid_at IS NULL` AND `total_billed_amount > 0`).
- When that filter is active, the existing table shows: Shift ID (short), Requester, Doctor, End Shift timestamp, Base amount, Current payable, Payment status, Monnify reference. Other filters render unchanged.

## 5. Environment badge on "Next coverage" — `src/features/cover/CoverHome.tsx`

Add `<EnvironmentBadge environment={coverage.environment ?? "normal"} size="sm" />` to the right-hand pill cluster in both the `Next coverage` and `Active coverage` branches (already on the `Coverage` type → no data plumbing).

## 6. One upload retry — `src/lib/doctor-uploads.ts`

Wrap the storage upload in a single retry with a 1.5 s backoff so a transient mobile-network blip doesn't force the user to reshoot the selfie / re-pick the file.

## Deferred (Capacitor phase, not now)

- `@capacitor/camera`, `@capacitor/filesystem`
- iOS `Info.plist` (`NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`)
- Android `AndroidManifest.xml` (`CAMERA`, `READ_MEDIA_IMAGES`)

## Files touched

- `supabase/migrations/...` (already applied)
- `src/lib/selfie-url.ts` — persistent SWR cache
- `src/components/StableImage.tsx` — query-stripped key
- `src/lib/doctor-uploads.ts` — single retry
- `src/lib/profile-remote.ts` — propagate `trust_frozen_at`
- `src/lib/admin.functions.ts` — extra columns + surcharge aggregate
- `src/routes/_admin.admin.shifts.tsx` — Awaiting Payment filter + columns
- `src/features/cover/CoverHome.tsx` — EnvironmentBadge in coverage card
