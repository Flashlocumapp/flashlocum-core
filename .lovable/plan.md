# Native-Feel Polish — Approved Items

Frontend/presentation only. No DB, RLS, or server-function changes.

## 1. Pull-to-refresh (non-required)

New `src/components/PullToRefresh.tsx`:
- Pointer-event based (no library), engages only when host's `scrollTop === 0`.
- Threshold ~64px; translateY content with rubber-band; spring back via shared token.
- On release past threshold: light haptic, call `onRefresh()`, show a small spinner pill for max 1.2s or until promise resolves (whichever is later).
- Honors `prefers-reduced-motion` (no translate, just spinner).

Wire into:
- `HomeRouter` (requester + cover home lists, NOT the map gesture area)
- `CoverageScreen` (history + active lists)
- `EarningsScreen`

**Guarantee:** realtime + cache continue to deliver updates automatically. PTR triggers an extra explicit re-fetch but is never the only path to fresh data — every screen keeps its existing subscriptions untouched.

## 2. Shared motion tokens

New `src/lib/motion.ts`:
```ts
export const springSnappy = { type: "spring", stiffness: 380, damping: 32 };
export const springSoft   = { type: "spring", stiffness: 240, damping: 28 };
export const fadeFast     = { duration: 0.16, ease: [0.22, 0.61, 0.36, 1] };
export const sheetEnter   = { type: "spring", stiffness: 320, damping: 34 };
export const REDUCED      = { duration: 0 };
export function springFor(reduced: boolean, preset = springSnappy) { ... }
```

Migrate inline `transition={{...}}` props in: `_app.tsx` tab dock, `BottomSheet`, `RatingOverlay`, `HistoryDetailSheet`, `PaymentSummaryOverlay`, `EditShiftSheet`, `CancelFlow`, requester/cover list `motion.li`. No visual regression — just consolidation.

## 3. Tab bar polish (`BottomTabs.tsx`)

- Replace the per-tab static underline with a single `motion.span layoutId="tab-indicator"` so the indicator slides between active tabs (`AnimatePresence` not needed; layout animation handles it).
- Cross-fade icon stroke weight by rendering both weights stacked with opacity transition (instead of binary `strokeWidth` swap).
- Fire light "selection" haptic on tab press (export `emitHaptic` from `feedback.ts`).
- Keep `preload="intent"` and current scale/opacity press states.

## 4. Scroll containment

Add `overscrollBehavior: "contain"` to:
- The outer fixed shell in `_app.tsx`
- Each `PersistentLayer` scroll container
- The non-persistent `<Outlet />` wrapper
- `BottomSheet` inner scroll region

Prevents iOS PWA rubber-band leaking past sheets/lists into the shell.

## 5. Safe-area pass

- `PaymentSummaryOverlay`: add `paddingBottom: max(env(safe-area-inset-bottom), 16px)` to content container.
- `RatingOverlay`: same.
- `BottomSheet`: confirm and standardize.
- `RestrictionBanner`: already uses `safe-area-inset-top`; verify after item 7 refactor.

## 6. First-paint flash on Coverage

In `CoverageScreen.tsx`: if first realtime/cache snapshot hasn't arrived yet (`status === "loading"` and no cached rows), render a 2-row `Skeleton` placeholder matching card geometry instead of empty space. Replace with real rows once snapshot lands (single re-render — no flicker thanks to matched height).

## 7. RestrictionBanner re-render isolation

`RestrictionBanner.tsx` is fine in isolation (own 60s poll), but it's mounted in `_app.tsx` which re-renders on `pathname`. Fix:
- Wrap `RestrictionBanner` in `React.memo` (no props).
- Move `useServerFn(getMyPaymentRestriction)` result through a ref to avoid the function-identity dependency triggering effect re-runs.
- Memoize the rendered banner body with `useMemo` keyed on the relevant restriction fields so a no-op poll doesn't re-render the DOM subtree.

No subscription changes; purely local memoization.

## Verification

- Typecheck after each item.
- Manual: tab between Home ↔ Coverage ↔ Earnings ↔ Account — indicator slides, no flicker, scroll positions persist.
- Pull down on Home list → spinner shows → releases with spring → list refreshes.
- Open and dismiss each sheet — consistent spring, bottom padding clears home indicator.
- Throw a fake restriction state in dev → banner appears once, doesn't re-render on tab switches.

## Out of scope (deferred)

- Broader haptic coverage on every CTA (only tab-press tick added here).
- Input affordances pass (enterKeyHint / inputMode).
- Reduced-motion audit across all `motion.*` sites.
- Native push / service worker wiring.
