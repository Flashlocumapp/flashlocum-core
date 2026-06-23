# FlashLocum — Stability, Map Persistence, Payment Audit (revised after video review)

Both video recordings confirmed and re-checked:
- **Video 1** — the blink happens on `/coverage` (a list screen with no map at all). The whole subtree flashes to a lighter state and back. This proves the blink is a **global re-render cascade**, not anything map-specific.
- **Video 2** — on tab switch, the Google map tiles vanish entirely (gray surface only) and re-paint on return. This is a **hard unmount**, not just a visual reflow.

The fix below is scoped to what would actually eliminate both behaviours, with the exact files and lines.

---

## ISSUE 1 — Periodic global blink (every ~60s, on every screen)

### Root cause
Two independent code paths convert the once-per-minute `last_seen_at` heartbeat into a global React re-render:

1. **Self-echo through `profile-remote.ts`**
   `src/routes/_app.tsx:108` ticks `touchLastSeen()` every 60s. That writes `profiles.last_seen_at` for the current user. The per-user subscription in `src/lib/profile-remote.ts:333-344` listens for `event: "*"` on `profiles` filtered to `id=eq.${userId}`. The echo fires, `rememberProfile(next)` + `notifyProfile()` run unconditionally, and every `useMyProfile()` consumer setState's with a brand-new object identity. AppShell-mounted consumers (e.g. `ActionRequiredCard`, profile-driven UI) re-render their subtree.

2. **Self-echo through `verification.ts`** ← the missing piece
   `src/lib/verification.ts:32-49` opens a **second** subscription on `profiles` (`event: "UPDATE"`, same `id=eq.${userId}`). On every `last_seen_at` write the callback at line 41-45 reads `payload.new.verification_status` (which is unchanged) and calls `setCached(next)` if it has any value. That notifies every `useVerificationStatus()` listener. `useVerificationStatus` is consumed by `CoverHome` and by the `RestrictionBanner` mounted in `AppShell` (`src/routes/_app.tsx:RestrictionBanner`), so the cascade reaches **every** tab — Home, Coverage, Earnings, Account. This is why the blink shows on Coverage where there is no map.

3. **Reconcile-timer secondary noise** (smaller contributor)
   `src/lib/coverage-remote.ts:345-355` and `src/lib/presence-remote.ts:196-206` both fire on a 60s cadence and broadcast snapshot arrays with new identities even when contents are unchanged, adding extra render thrash for consumers of `useNetwork()`.

### Why the blink looks like a "refresh"
Animated surfaces (`<AnimatePresence>` in `_app.tsx` around the BottomTabs, motion components inside list rows) re-trigger entry transitions or briefly drop opacity when their React parents re-render with new object identities. That micro-transition is the visible flash.

### Correct fix (eliminates both observed and confirmed)
- **`src/lib/profile-remote.ts:333-344`** — in the `ensureProfileChannel` handler, compute the changed-keys set between `payload.old` and `payload.new`; if it is a subset of `{ last_seen_at }`, return without calling `rememberProfile`/`notifyProfile`. Then in `rememberProfile`, only call `notifyProfile()` when a meaningful field actually changed (shallow-diff against the prior cached row).
- **`src/lib/verification.ts:32-49`** — same self-echo filter. Additionally, only call `setCached(next)` when `next !== cached`. This single change is what stops the cascade from reaching `/coverage`.
- **`src/lib/coverage-remote.ts:345-355` and `src/lib/presence-remote.ts:196-206`** — before the listener fanout, hash the snapshot (`id + updated_at` join) and bail if equal to the last fanout's hash.

Verification protocol after the fix:
- Sit on `/coverage` for 3+ minutes with React Profiler recording. Expect 0 commits at the 60s mark (today: 1 commit per minute).
- Sit on `/home`. Same expectation. The map must not flash, the rating pill must not re-mount.

---

## ISSUE 2 — Map fully unmounts on tab switch (confirmed by video)

### Root cause
The Google map is a child of `HomeRouter`, which is the component for the file route `src/routes/_app.home.tsx`. AppShell renders `<Outlet />` (`src/routes/_app.tsx:163-167`). TanStack Router unmounts the matched component when the route changes. So leaving `/home` for `/coverage` destroys:
- The `<div>` that hosts the map
- The `google.maps.Map` instance in `mapRef.current`
- Every marker in `markerObjs` and `selfMarker`
- `mapReady`, `userCenter`, all hook state

On return, `GoogleMapBackground`'s init effect (`src/components/GoogleMapBackground.tsx:237-266`) re-runs from scratch. `loadMapsApi()` is cached so the SDK doesn't re-download, but `new g.maps.Map(...)` allocates a brand-new instance and every dependent effect re-fires. The grey frame in video 2 is the moment between the new map being constructed and the tiles painting.

The `active` prop wired through `HomeRouter` → `GoogleMapBackground` was clearly intended to support keep-alive, but it can never work as long as the route owns the lifecycle.

### Correct fix
Promote `HomeRouter` to a **persistent layer mounted once inside `AppShell`**, alongside (and behind) `<Outlet />`:

- **`src/routes/_app.tsx`** — derive `isHome = useRouterState({ select: s => s.location.pathname === '/home' })`. Render `<div style={{ display: isHome ? 'block' : 'none' }}><HomeRouter active={isHome} /></div>` as a sibling of `<Outlet />`, positioned in the same absolute layer it sits in today. Z-index it so Outlet content for other routes covers it when `isHome === false`.
- **`src/routes/_app.home.tsx`** — change the component to `() => null`. The route still exists for navigation / URL matching; the visible UI is provided by the persistent layer.
- Confirm `GoogleMapBackground`'s effects already gate work on `active` (pan effect at lines 281-286 already does). No other change required — `watchPosition` should keep running while hidden so the user-location dot is already accurate on return.

This guarantees a single, lifelong `google.maps.Map` instance per session. Tab switching becomes a CSS toggle, identical to native screen stack behaviour.

Verification protocol after the fix:
- In DevTools, take a JS heap snapshot, find the `Map` instance, then switch to /coverage and back. The same instance ID must survive.
- Visually: grey-frame moment in the video must be gone.

---

## ISSUE 3 — Payment countdown

### Audit result (no behaviour change required, one display polish)
The countdown is already backend-authoritative:
- `payment_due_at` is set server-side in `end_shift` (`supabase/migrations/20260623033342_*.sql:357`).
- `ShiftSettlement` reads it via `getRequestBillingState` (`src/lib/shift.functions.ts:183-210`), which also returns `server_now`. Reload/tab switch/offline simply re-anchor against the persisted server timestamp.
- Surcharge is applied by the server cron `drain_surcharge_due` (`src/routes/api/public/hooks/surcharge-drain.ts`), independent of any client.

Display is computed against `simNow()` (`src/lib/clock.ts`), so on a device with a skewed wall clock, the visible number can disagree with the server's truth until the next poll.

### Correct fix
In `ShiftSettlement`, store `serverSkew = serverNow - Date.now()` from the first and every subsequent `getRequestBillingState` response in a ref. Compute the visible `remaining` as `paymentDueAt - (Date.now() + serverSkew)`. Cap `getRequestBillingState` polling to ≤30s while the sheet is visible so skew stays current. Enforcement is unchanged — purely a display fix to make device-clock skew invisible.

---

## ISSUE 4 — Monnify payment warning copy

### What actually changes on `extend_payment_window`
Verified from `supabase/migrations/20260623033342_*.sql:420…` and the existing Monnify flow:
- **Amount** ✓ increases by one `_surcharge_block_amount` per call.
- **`payment_reference`** ✓ is cleared on every lock (`end_shift` line 360) and re-minted on the next Monnify init (the unique index `uniq_coverage_payment_reference` forces a new reference because the amount changed).
- **`account_number`** ✓ Monnify's virtual-account cache (`20260617132009_*.sql:5`) is keyed to `payment_reference`; clearing the reference invalidates the cache and the next `initTransaction` returns a fresh `accountNumber`, `bankName`, `expiresOn`.

All three change. The current copy at `src/features/request/ShiftSettlement.tsx:1663-1664` only mentions the amount, which is misleading — the more confusing failure mode is paying to a stale account number.

### Correct fix
Replace both expired and pre-expiry strings with one rule taught upfront:

> "Amount and payment details may change if payment is not completed in time. Always use the latest account number and payment reference displayed on this page."

Pure presentation change.

---

## Implementation order (after approval)

1. **Issue 4** — single string change.
2. **Issue 1** — self-echo filter in `profile-remote.ts` + `verification.ts`, plus shallow-diff guards and snapshot-hash guards in `coverage-remote.ts` / `presence-remote.ts`. ~50 LOC across four files. Verifiable with React Profiler on `/coverage`.
3. **Issue 2** — persistent `HomeRouter` layer in `_app.tsx`; `_app.home.tsx` → `() => null`. ~25 LOC. Verifiable with the heap-snapshot test above.
4. **Issue 3** — server-skew ref in `ShiftSettlement`. ~15 LOC.

All four independent; deployable in one turn.