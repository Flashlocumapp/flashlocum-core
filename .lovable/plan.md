## Issue 1 — Missing online doctors on Requester Home (root cause)

**Why it happens**
- The requester subscribes to `doctor_presence` via Realtime `postgres_changes`, which is RLS-filtered against each delivered row.
- The current SELECT policy on `doctor_presence` (`Presence readable by self admin assigned requester or online ap…`) only lets a requester see an online approved doctor's presence row **if that requester already has an active `coverage_requests` row** in `searching | accepted | active | paused | awaiting_payment`.
- Consequence: a requester sitting on Home with no active request receives **zero** presence updates. The initial SECURITY DEFINER RPC (`list_online_approved_doctors`) populates the map once, but every subsequent doctor toggling online, moving, or coming back online after a stale window is invisible to that requester — even though the doctor is fully eligible and receives broadcasts.
- The broadcast pathway is unaffected because `list_open_coverage_requests` runs SECURITY DEFINER and bypasses this RLS.

**Fix (single source of truth)**
1. Replace the gated SELECT policy with one that lets every authenticated user read presence rows for `online = true AND verification_status = 'approved' AND account_restricted_at IS NULL` doctors, plus the existing self / admin / assigned-requester clauses. This matches the constraint already in `mem://constraints/broadcast-delivery.md` (all online Lagos doctors are visible) and aligns presence visibility with broadcast eligibility.
2. Add `AND account_restricted_at IS NULL` to `list_online_approved_doctors` so the initial RPC and the realtime stream apply the exact same filter.
3. Keep all sensitive presence concerns intact: only `online`, `last_seen`, `top`, `left`, `lat`, `lng`, `user_id` are exposed (already the case); no PII columns exist on `doctor_presence`.
4. Update `mem://security-memory` to record that broadcast-aligned presence visibility is intentional, so the scanner does not re-flag this as `doctor_presence_online_broadcast_leak`.

## Issue 2 — Smaller doctor icons on Requester Home only

- Doctor markers are rendered by `GoogleMapBackground` from the `markers` prop. Both `RequesterHome` and `CoverHome` pass markers through the same component at the same size.
- Add a single optional prop `markerScale?: number` (default `1`) to `GoogleMapBackground` (and the underlying `MapBackground` if it also renders the same markers). Multiply the marker avatar size (and presence-dot size) by this scale.
- Set `markerScale={0.78}` only at the `RequesterHome` call site. Doctor Home is untouched.
- Spacing, halo, and shadow scale proportionally so layout stays clean.

## Issue 3 — Queue not advancing after a decline

**Why it happens**
After a doctor declines Request A while Request B is also broadcasting, `useDispatch` should immediately surface B because:
- `liveRequests` (from `broadcastingRequests(net)`) contains both A and B,
- `markDeclined(A)` excludes A via `isDeclined`,
- `Array.find(...)` returns B.

In practice the next request does not surface because of two concrete defects:

1. **`pendingIncomingId` uses DESC sort, `useDispatch` uses ASC.**
   - `dispatch.ts:608` sorts `broadcastingRequests` newest-first and picks `[0]`, while `useDispatch` (`dispatch.ts:244`) picks the oldest. After declining the visible card, the "what comes next" computation can disagree about which request is the head, and a stale declined entry under one ordering masks B under the other (especially when A and B arrive within the same realtime tick and one is keyed by `rev=1` vs the other by `rev=2`).
   - Fix: make `pendingIncomingId` use the same FIFO ASC order as `broadcastingRequests`/`useDispatch`. One ordering, everywhere.

2. **`declineIncoming` reconciles the open list but does not re-emit the network snapshot until the RPC round-trip completes.** During that ~150–800 ms window, `useDispatch` re-derives off the unchanged `net` state — `incoming` is recomputed (good) but only against the rows already present. If B's invalidate broadcast arrived **before** the doctor was on Home (channel reconnect race, app foregrounded between A and B), B is not yet in `cachedSnapshot`, and the in-flight `reconcileNow()` is the only thing that will add it. Until then, `incoming` is `null` and the sheet collapses — which the user perceives as "queue did not advance".
   - Fix: in `declineIncoming`, after `markDeclined(...)`, also call `bustOpenListCache()` and **await** `reconcileNow()` before clearing the incoming sheet. The current code fires-and-forgets, so the AnimatePresence exit animation runs first, then B arrives a moment later but the user has already seen empty state and reached for the cancel-rebroadcast workaround.
   - Additional safety: when `reconcileNow()` returns, if there is now another eligible broadcasting request, do not re-fire the offer.new toast (already deduped by `processedEvents`) — just let `useDispatch` render the next sheet.

3. **`declined` ledger is per-session and grows unbounded.** Not the immediate cause, but combined with #1 it creates an edge where a stale `id:rev` entry from a previous broadcast lingers, and the FIFO head ends up matching that stale key. Add a simple prune: drop declined entries whose request id is no longer in `state.requests`. Keeps the filter correct after reconcile.

**Net behaviour after the fix**
- Decline A → `markDeclined(A)` → `bustOpenListCache()` → `await reconcileNow()` → snapshot now contains A (still searching, ignored) and B → `useDispatch` derives `incoming = B` → DismissSheet swaps via the new `incoming.id` key.
- No requester ever needs to cancel and rebroadcast.

## Files touched

- `supabase/migrations/<new>.sql` — replace `doctor_presence` SELECT policy; tighten `list_online_approved_doctors`.
- `src/components/GoogleMapBackground.tsx` (and `MapBackground.tsx` if shared) — add `markerScale` prop.
- `src/features/request/RequesterHome.tsx` — pass `markerScale={0.78}`.
- `src/features/cover/dispatch.ts` — FIFO sort in `pendingIncomingId`; `declineIncoming` awaits `bustOpenListCache + reconcileNow`; prune stale `declined` entries on reconcile.
- `.lovable/memory/security-memory` — note presence visibility alignment.

## Out of scope

- Broadcast model (intentional, per memory).
- Payment, RLS on `coverage_requests`, Monnify flow.
- Doctor Home avatar sizing.

## Verification

- Two preview tabs (requester + doctor): toggling doctor online/offline updates the requester map within <1 s with no active request on the requester side.
- Two requesters create A then B within 2 s; doctor declines A → B's card appears immediately, no rebroadcast needed.
- Requester avatars on Home are visibly smaller than Doctor Home avatars; spacing remains clean.
- `tsgo` passes; Supabase linter shows no new findings.
