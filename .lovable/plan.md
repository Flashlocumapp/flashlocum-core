
# FlashLocum — Native-Feel Audit

Scope: read-only audit of `_app` shell, Home/Coverage/Account/Earnings tabs, image surfaces, map persistence, list rerenders, and realtime UX. No code in this turn.

---

## A. Current Behaviour Map (what happens today)

- **Shell (`src/routes/_app.tsx`)**: Two stacked absolute layers. The **Home** layer (`HomeRouter` → `RequesterHome` / `CoverHome`) is mounted once and toggled via `display:none`. The **non-home** layer is a single `<Outlet />` that re-mounts whenever `pathname` changes.
- **Tabs**: Only `/home` is persistent. `/coverage`, `/account`, `/earnings`, `/help`, `/support` fully unmount/remount on every visit.
- **Map**: Lives inside `RequesterHome`/`CoverHome` under the persistent Home layer, so the Google Map instance, markers, and `watchPosition` survive tab switches. Good baseline — but only for Home.
- **Data**: Almost no TanStack Query usage in feature screens (`rg` finds only `useQueryClient` in `AccountScreen`). Lists and details are fetched via custom hooks/Supabase calls that re-run on mount. There is no shared cache, no `staleTime`, no background revalidation pattern across tabs.
- **Images**: `<img>` tags with `loading="eager"` on selfies in `RequesterHome`, `CoverageScreen`, `HistoryDetailSheet`, `AccountScreen`. URLs come from a signed-URL cache (added earlier), but the surrounding components remount on tab switch, so the browser must re-decode each time; some signed URLs are regenerated and break the HTTP cache key.
- **Realtime**: Invalidation broadcasts trigger refetches that swap whole lists; on Coverage screen list items can briefly disappear and reappear during reorder/status change.
- **Transitions**: `AnimatePresence` is only on the bottom tab bar (immersive toggle). Route changes have no enter/exit animation; they cut hard between mounted trees.

---

## B. Native-Feel Gaps

1. **Non-home tabs fully remount.** Coverage, Account, Earnings each rebuild their tree, re-run queries, re-decode images, lose scroll, lose expanded-card state, lose filter state on every visit.
2. **No URL state for filters/sorts.** Returning to a tab cannot restore filter state because it lives in `useState`.
3. **No shared query cache.** Each mount fetches from scratch instead of showing cached data + revalidating in background.
4. **Signed-URL churn.** Selfie URLs are regenerated frequently enough that the browser image cache misses, producing visible fade-in.
5. **List rerenders on every realtime event.** Whole-list re-renders cause layout jumps when one row's status changes.
6. **No skeleton-vs-cache discipline.** Skeletons show even when prior data exists locally.
7. **No route transitions.** Tab swaps cut hard; combined with remount this reads as "page reload".
8. **Heavy components not memoized.** Map marker layers, list rows, and avatars re-render on parent state changes.

---

## C. Performance Risks

- Coverage list (`CoverageScreen.tsx`, >1200 LoC): one component owns header, filters, list, detail sheet, settlement — any state change re-renders all of it.
- `RequesterHome.tsx` (>1600 LoC): same monolith risk; safe today only because it never unmounts.
- Realtime invalidation handlers refetch entire collections instead of patching the changed row.
- `touchLastSeen` heartbeat is fine (singleton), but `visibilitychange` also triggers some screens' own refresh paths — compounding work on tab refocus.

---

## D. Screen Persistence Audit

| Tab | Mounted once | Scroll kept | Filters kept | Data cached | Verdict |
|---|---|---|---|---|---|
| Home | Yes | Yes | n/a | Yes (in-component) | Native-feel OK |
| Coverage | No | No | No | No | Remounts every visit |
| History (sub-view in Coverage) | No | No | No | No | Remounts |
| Account | No | No | n/a | No | Remounts |
| Earnings | No | No | No | No | Remounts |
| Admin/* | No | No | No | No | Remounts (lower priority) |

---

## E. Image & Map Audit

- **Map**: Already persistent on Home. No work needed there. Verify markers are diffed (add/remove/update) rather than cleared+rebuilt on every realtime tick.
- **Profile/selfie images**: Re-decoded because parent screens remount and because signed-URL TTL refresh swaps the `src`. Need stable URLs per session + memoized `<img>` wrappers.
- **Hospital/avatar lists**: No explicit lazy/eager strategy other than `loading="eager"` on big selfies; small list avatars should be `loading="lazy"` + fixed dimensions to avoid layout shift.
- **Icons/logos**: Bundled SVGs — fine.

---

## F. Correct Behaviour Definition

- Returning to any tab shows the **previous screen instantly**: same scroll, same filters, same expanded rows, same images already decoded. Any new data arrives via silent background refresh.
- Loading skeletons appear only on **first ever fetch in the session**. After that, stale data is shown immediately and replaced in place.
- Realtime updates patch the affected row only; the row animates (fade/scale) without list reflow.
- Tab transitions: crossfade or none — never white flash.
- Map: never re-initialises after first paint of the session.
- Signed image URLs: stable for the session; cache hits on revisit.

---

## G. Implementation Plan (phased, no code)

### Phase 1 — Persistent tab shell (biggest single win)
- Convert `_app.tsx` to a **multi-layer persistent shell**: keep one always-mounted layer per primary tab (Home, Coverage, Account, Earnings). Active tab is `display:block`; others `display:none`.
- Each layer renders its own subtree mounted on first visit and kept alive thereafter. Admin and secondary routes (help, support) keep the current Outlet/remount model.
- Wire `BottomTabs` to switch the visible layer; preserve route URL for deep-linking, but the layer mount lifecycle is driven by "has this tab ever been visited" rather than `pathname`.
- Acceptance: leave Coverage scrolled mid-list, switch to Account and back — same scroll, no skeleton, no image flicker.

### Phase 2 — Shared cache + background revalidation
- Adopt TanStack Query (already in the stack) as the default read path for Coverage list, History, Account profile, Earnings summary.
- `staleTime` ≥ 30s, `gcTime` ≥ 30m, `placeholderData: keepPreviousData`. Initial mount uses cached data; revalidation happens silently.
- Remove ad-hoc `useEffect+fetch` patterns in the four feature screens.

### Phase 3 — URL-backed filter/sort state
- Move Coverage/History filter, search, and tab state into `validateSearch` so returning to the tab restores them naturally and deep links work.

### Phase 4 — Realtime: patch, don't refetch
- Replace "invalidate → refetch list" with row-level updates: realtime payload updates the single row in the Query cache via `setQueryData`. Reorders animate via `framer-motion` `layout`.
- Keep the existing watchdog as a periodic safety reconcile, but make it diff-and-patch, not full replace.

### Phase 5 — Image stability
- Make the signed-URL cache return a **session-stable URL** per object (cache key = storage path, TTL ≥ session); never swap the `src` mid-session unless the underlying file changed.
- Wrap selfies/avatars in a memoised `<StableImage>` that fixes width/height, preloads once, and uses `decoding="async"` + `fetchpriority="high"` only for above-the-fold.
- Add `loading="lazy"` and intrinsic dimensions on list avatars.

### Phase 6 — Transitions & micro-polish
- Crossfade (80–120ms) between persistent tab layers via `framer-motion` `AnimatePresence mode="popLayout"`.
- Memoise list rows (`React.memo` + stable keys). Split `CoverageScreen` and `RequesterHome` into header/list/detail subcomponents so state changes don't re-render siblings.
- Remove skeletons when cached data exists; show a subtle top-edge refresh bar instead.

### Phase 7 — Verification
- Manual: Playwright run capturing screenshots before/after tab switches; assert no layout shift, no image fade.
- Scorecard re-rated; target ≥ 9/10 in all categories.

---

## H. Native-Feel Scorecard (today)

| Area | Score | Reason |
|---|---|---|
| Navigation | 6 | Bottom tabs feel right, but content under them rebuilds |
| Screen Persistence | 3 | Only Home persists |
| Image Stability | 5 | Signed-URL cache exists but parents remount; visible fade |
| Map Stability | 9 | Home map fully persistent |
| Realtime Smoothness | 5 | Whole-list refetches cause flashes/reorder pops |
| Overall Native Feel | 5 | Strong shell foundation, weak per-tab persistence |

Target after Phases 1–6: 9/10 across the board.

---

## Risk Notes

- Phase 1 changes the shell's mount model — needs a careful pass on heartbeats, realtime subscriptions, and dispatch portals (already singleton-safe, but verify).
- Phase 2 introduces TanStack Query in screens that today own their fetch logic; rollout per-screen, not big-bang.
- Memory: keeping all primary tabs mounted increases RSS modestly (~10–20MB on mid-range Android). Acceptable for an Uber-class app.
