## Why the "loading flash" happens

Three independent causes, all visible as the ~1–2 s shimmer/empty state you described:

1. **Persistent tabs mount lazily.** `src/routes/_app.tsx` only mounts a tab layer the *first* time you visit it (`visitedRef.current.has(...)`). The first visit to Coverage, Earnings, or Account after a reload mounts that screen cold, runs its first realtime/profile subscription, and renders skeletons until the first snapshot arrives. After that the layer stays mounted and switching is instant — which matches "happens sometimes".

2. **Coverage's first-paint guard always shows a 220 ms skeleton when the in-memory store is empty.** `useFirstPaintSettled(items.length > 0)` in `src/features/app/CoverageScreen.tsx` flashes `ListSkeleton` until either rows arrive or 220 ms passes. Because `src/lib/network.ts` `load()` actively *clears* `localStorage` and starts with `requests: {}`, every cold start hits the 220 ms branch even when there is nothing to show.

3. **Doctor avatars re-sign on every cold start.** `src/lib/doctor-identity.ts` persists the name/MDCN/storage path but explicitly strips the signed URL before writing to `localStorage`. On reload it shows initials, calls `supabase.storage.createSignedUrl`, then swaps the photo in 300–1500 ms. `src/lib/selfie-url.ts` already persists the signed URL with its `exp` claim and does stale-while-revalidate — doctor-identity just isn't using it.

The Account tab avatar is already instant because it uses `useSelfieUrl`; the same fix needs to reach every coverage card, history sheet, detail sheet, and RequesterHome assigned-doctor card.

## Fix plan (presentation layer only — no business logic changes)

### 1. Eager-mount all persistent tab layers
`src/routes/_app.tsx`
- Replace the lazy `visitedRef` gate with eager mount of all four `PERSISTENT_TAB_PATHS` on first AppShell mount. Visibility still toggles via `display`, so the first tap on Coverage / Earnings / Account is instant — their realtime subscriptions and signed-URL warmups run in the background while Home is on screen.
- Keep `HomeRouter active={...}` and `EarningsScreen active={...}` so off-screen tabs can still pause expensive work (map ticks, etc.).

### 2. Persist + rehydrate the coverage requests snapshot
`src/lib/network.ts`
- Stop deleting the requests cache in `load()`. Persist `state.requests` to `localStorage` (debounced, capped at ~80 rows, schema-versioned, same pattern as `selfie-url.ts`).
- On `init()`, hydrate `state.requests` from `localStorage` BEFORE the realtime subscription connects, so the very first render of Coverage already has the user's last-seen rows.
- Realtime snapshots continue to overwrite per-row, so stale rows self-heal within the existing reconcile path.

`src/features/app/CoverageScreen.tsx`
- Drop the 220 ms shimmer in favor of: render rows immediately when the hydrated cache has any; otherwise render the empty state directly. The "first paint" timer becomes redundant once #2 lands and removes the cold-start window.

### 3. Make doctor avatars survive reload
`src/lib/doctor-identity.ts`
- Route selfie resolution through the existing `selfie-url.ts` cache (`signSelfie(path)` / its persisted entries) instead of a parallel `resolveSelfie` + bespoke persistence that throws away the signed URL.
- On `readIdentityCache()`, if `selfie-url.ts` has a still-valid signed URL for the persisted `selfiePath`, hydrate `selfieUrl` from it synchronously so the very first paint of every coverage card, detail sheet, and history row already shows the photo.
- Background re-sign only when the cached URL is missing or within the existing 5-min refresh window.

### 4. Smooth the leftover micro-flashes
- `src/features/app/CoverageScreen.tsx` `RequesterDetailSheet` / `RequestCard`: render the avatar `<span>` with the initials as the background label so the photo fades in over them (no empty grey box even on the rare uncached doctor).
- `src/features/request/RequesterHome.tsx` accepted-doctor card: same StableImage fade behavior.

## Out of scope (intentionally)
- No changes to billing, dispatch, RLS, or any server function.
- No changes to the realtime topology — only the local persistence layer in front of it.
- No new dependencies.

## Verification
- Hard refresh on `/coverage` with existing rows → list renders immediately, no skeleton, no empty-state flash.
- Hard refresh on `/home` then tap Coverage / Earnings / Account in sequence → each tab paints filled in under one frame.
- Reload while an accepted shift is showing → assigned doctor's photo is visible on first paint instead of initials → photo.
- Realtime row changes still reflect within their existing latency (sanity-check by toggling a request status from another tab).
