## Fix 1 — Settlement page scroll + Reference overflow

**File:** `src/features/request/ShiftSettlement.tsx` (Settlement confirmed pane, ~line 1239 and Row at ~1362)

- The outer `motion.section` is `relative flex h-full w-full flex-col` with no `overflow-y-auto`, so the Payment Summary (Day 1…Day N) card is mounted but unreachable on short viewports. Change wrapper to allow vertical scroll: add `overflow-y-auto` and make the inner `<div className="mx-auto …">` use `min-h-0` so the flex child scrolls instead of clipping.
- The `Reference` row uses the shared `Row` component, which is a single-line flex with no wrapping rules — `flsh_aafa50fc8a9a42f4_1781994320089_56e…` overflows the card. Replace that one row with a stacked layout (label on top, value below) using `break-all` so the full reference wraps inside the card. Other rows stay unchanged.

## Fix 2 — "Day X of N" badge on Active + Upcoming cards (multi-day only)

**File:** `src/features/app/CoverageScreen.tsx` (Card body, ~line 827-841)

- The badge is already rendered, but it lives inside a `truncate` div alongside the meta string (`Standard · Sun–Tue · 11:00 AM – 06:00 PM …`). On 390px-wide phones the meta consumes the full line and the badge gets clipped by `truncate`.
- Promote the `Day X of N` chip out of the truncated meta line into its own row directly above the meta (still gated by `!isHistory && item.days > 1`), so it always renders for multi-day Active and Upcoming cards and never for single-day shifts. Styling: same compact pill (`bg-secondary/70`, uppercase, 10.5px) but on its own line with `shrink-0`. Meta line keeps its `truncate` behaviour for the schedule string.
- No History changes (History already shows completion summary, not a day counter).

## Out of scope

No backend changes. No pricing changes. No changes to single-day cards.

## Expected result

- Settlement page scrolls to reveal Day 1…Day N; reference wraps inside the card and never bleeds out.
- Multi-day Active card under Dr. Victoria M. shows "Day 1 of 3" pill above the schedule line; same pill appears on multi-day Upcoming cards; single-day cards unchanged.
