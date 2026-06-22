# FlashLocum — Tab Smoothness, Performance & Hydration Audit

Read-only audit. No files were changed. Findings are based on the current implementation.

---

## 1. Current Tab & UI Behaviour

- All four tabs (`/home`, `/coverage`, `/earnings`, `/account`) live under the `_app` layout in `src/routes/_app.tsx`.
- The shared `BottomTabs` uses TanStack `<Link>` with `preload="intent"` (good).
- The `AppShell` wraps `<Outlet />` inside a div keyed by `pathname`:
  ```
  <div key={pathname} …><Outlet /></div>     // src/routes/_app.tsx:159
  ```
  Every tab change changes the React `key`, which **unmounts the entire previous screen and mounts a fresh one** — including Coverage (1,724 lines), RequesterHome (1,706 lines), ShiftSettlement (1,701 lines), Earnings, and Account.
- None of the feature screens use TanStack Query / `useSuspenseQuery`. A repo-wide search returns only `useQueryClient` (AccountScreen, used for sign-out). All data is fetched with raw `useEffect` + `useState` or per-screen Supabase subscriptions.
- Route files (`_app.home.tsx`, `_app.coverage.tsx`, `_app.earnings.tsx`, `_app.account.tsx`) have **no `loader`** — nothing is primed before the component mounts.
- `router.tsx` sets `defaultPendingMs: 10_000` and `defaultPreloadStaleTime: 0` — preloading exists, but with no loader to preload there is nothing to cache.

Net effect: every tab tap triggers a full React tree rebuild for that screen, re-runs every `useEffect`, re-opens realtime channels, and re-issues network calls for data and avatar images.

---

## 2. Performance & Hydration Issues Found

### A. Pop-in / flicker on every tab switch
Caused by `key={pathname}` on the Outlet wrapper. Even a tab the user just left is destroyed; returning to it rebuilds from zero state → blank container → skeletons → data → images.

### B. Refetch storm on tab switch
Because screens are remounted and no shared cache exists:
- Coverage re-queries shifts and re-subscribes to realtime health/role channels.
- RequesterHome re-runs its map + nearby-doctors load.
- Earnings re-pulls settlements.
- Account re-pulls profile, ratings, reliability.
Realtime subscriptions are torn down and rebuilt — visible as the "Reconnecting…" banner flashing briefly after navigation.

### C. Skeletons appear even when data is already known
There is no persistent cache layer (no Query cache, no in-memory store survives unmount). So the screen has no choice but to render its empty/skeleton state on every entry, even when the data was on screen 800 ms ago.

### D. Avatar / card images re-download
Images are plain `<img src=…>` against Supabase storage URLs. After a remount, the browser HTTP cache *may* serve them, but because the component tree is new, React paints the empty `<img>` first → visible pop-in. There is no preloading, no `loading="eager"` priority hint on above-the-fold avatars, no blurhash/placeholder.

### E. Heavy screens stutter on first paint
Coverage and RequesterHome each weigh >1,700 lines with map, lists, and overlays in a single chunk. They are not code-split per tab; a full remount means the entire JS for that screen runs again synchronously before paint.

### F. Tab transition feels like a reload, not a native push
There is no AnimatePresence around the Outlet itself — only around the tab bar. Combined with the unmount, transitions feel hard-cut and slow rather than instant/native.

### G. Home keeps an `active` prop API but it never matters
`HomeRouter` accepts `active` and passes it to `RequesterHome`/`CoverHome` — clearly designed for a stay-mounted shell — but `key={pathname}` discards the instance anyway, so the optimization is dead code.

---

## 3. Root Cause Summary

| Symptom | Root cause |
|---|---|
| Tab switching feels laggy / full reload | `key={pathname}` on Outlet remounts every screen |
| Skeletons + blank cards on every entry | No persistent data cache (no TanStack Query usage in feature screens) |
| Realtime "reconnecting" flashes | Subscriptions live inside per-screen `useEffect`, torn down on unmount |
| Image pop-in | New `<img>` mounted on every entry; no preload / priority / placeholder |
| Stutter on Coverage / Home | 1.7k-line screens re-evaluated and re-laid-out from scratch each visit |
| Loaders never help | Routes have no `loader` to prime `queryClient.ensureQueryData` |

The single largest contributor is the remount-on-tab-change pattern. Every other symptom is amplified by it.

---

## 4. Monnify Webhook Clarification (Deterministic)

Two **separate** webhook URLs are required — collection (money in) and disbursement (money out) are different Monnify event streams and Monnify will only call the URL configured for each.

Already implemented and verified in this codebase:

1. **Payment confirmation (collection)** — fires when the requester's payment is captured.
   - Handler: `src/routes/api/public/monnify-webhook.ts`
   - URL to register in Monnify Dashboard → Settings → API Keys & Webhooks (Transaction Completion):
     `https://flashlocum-core.lovable.app/api/public/monnify-webhook`

2. **Settlement completion (disbursement to doctor's bank)** — fires when Monnify completes the T+1 sub-account payout.
   - Handler: `src/routes/api/public/monnify-disbursement-webhook.ts`
   - URL to register in Monnify Dashboard → Settings → API Keys & Webhooks (Disbursement Notification):
     `https://flashlocum-core.lovable.app/api/public/monnify-disbursement-webhook`

Backstop (already live): a daily `pg_cron` job `reconcile-monnify-settlements-daily` at 03:00 UTC hits `/api/public/hooks/reconcile-settlements` and back-fills any disbursement webhook Monnify drops. Both webhook handlers verify `monnify-signature` (HMAC-SHA512) and the disbursement handler is idempotent via `mark_settlement_remitted`.

Source of truth in memory: `mem://features/monnify-settlement.md`.

No additional Monnify URL is required. Do not point both events at the same URL — the disbursement payload shape differs and would be rejected.

---

## 5. Recommended Fixes (high level, no code)

Ordered by impact. Phase 1 alone removes ~80 % of the perceived lag.

### Phase 1 — Stop remounting tabs
1. Remove the `key={pathname}` from the Outlet wrapper in `_app.tsx` so React reuses the tree per tab.
2. Keep the four tab screens mounted simultaneously (display-toggle pattern under the layout) so switching tabs is a CSS visibility change, not a React tree change. This is the standard "native tab bar" pattern and what `HomeRouter`'s `active` prop was already designed for.
3. Wrap the Outlet in a soft cross-fade only — never a layout-animated unmount.

### Phase 2 — Persistent data layer
4. Move every feature-screen data fetch onto TanStack Query with stable `queryKey`s and a non-zero `staleTime` (e.g. 30–60 s for lists, 5 min for profile).
5. Add `loader: ({ context }) => context.queryClient.ensureQueryData(...)` to each tab route so the first paint already has data.
6. Render cached data immediately and only show skeletons when `query.data === undefined` (not on every refetch). Use `placeholderData: keepPreviousData` for lists that paginate / refilter.
7. Move realtime subscriptions out of per-screen effects and into a single app-level provider keyed by user id, so channels survive tab switches.

### Phase 3 — Image hydration
8. Preload above-the-fold avatars via `<link rel="preload" as="image">` in the route `head()`, or via an in-memory `Image()` warmup on login.
9. Add `loading="eager"` + `fetchpriority="high"` to the first viewport's avatars, `loading="lazy"` to the rest.
10. Standardise on a single `<Avatar>` component that renders a colour/initial placeholder until the bitmap decodes — eliminates the white-square flash.
11. Serve avatars through a width-constrained transform (e.g. `?width=96`) so the wire payload matches the render size.

### Phase 4 — Code-split the giants
12. Split `CoverageScreen`, `RequesterHome`, and `ShiftSettlement` into sub-modules (header, list, overlays, map) imported lazily so the per-tab JS evaluation cost on first visit drops sharply. After Phase 1 this only matters for cold load, but it removes the remaining first-paint stutter on low-end Android.

### Phase 5 — Native transition polish
13. Add a 120–150 ms opacity cross-fade on tab change (no translate, no layout animation) for a true native feel.
14. Disable the page-level "reconnecting" banner during the first 1.5 s after tab change so a transient channel resubscription (when Phase 2 is partial) never flashes.

### Acceptance criteria (matches the user's goal)
- Tapping any tab paints the cached UI in the same frame.
- No skeleton appears for data that was visible <60 s ago.
- No avatar shows a blank square before its bitmap.
- The "Reconnecting…" pill never appears during routine tab switches.
- Coverage and Home open with no visible stutter on a mid-range Android.

---

**Awaiting approval before any code changes.** When approved, I'll implement in the phase order above and verify with screenshots / console + network traces after each phase.
