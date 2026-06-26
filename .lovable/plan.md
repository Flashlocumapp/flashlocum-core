## Root cause

The server scoring (`recompute_trust`) and its triggers already work correctly — every rating insert and every terminal coverage status change recomputes and writes `profiles.trust_snapshot`. The bug is on the read side.

1. **Hospital pills never resolve to a user.** On requester-side cards, ratings/reliability are rendered with `hospitalEntityId(item.hospital)` → `"hosp:<slug>"`. `userIdFromEntity()` requires a UUID suffix and rejects this, so `useTrust(null)` short-circuits to the hard-coded `DEFAULT_SNAPSHOT` (5.0★ / 100%). Result: every doctor and every requester *looks* like a fresh-baseline user, regardless of real performance. Affected surfaces:
   - `CoverHome.tsx` (next coverage / incoming card)
   - `CoverDispatchPortal.tsx` (incoming + queued cards)
   - `CoverageScreen.tsx` upcoming + history hospital pills
   - any place a doctor sees a requester's score.
2. **`get_trust` cross-user gate is too narrow.** It only allows the viewer when a `coverage_requests` row already links the two parties. So even if we passed the correct UUID, a doctor seeing a brand-new incoming request — or a requester seeing an online doctor on the map — would get "Not authorized" and silently fall back to the baseline.
3. **No realtime push for trust changes.** `trust.ts` only invalidates its cache on local dispatch actions (`accept`/`complete`/`cancel`). When the *other* party submits a rating, or a different shift terminates, an open client never refetches; combined with the 30s client TTL and the 5-minute server staleness window, scores look stuck at 5.0/100% long after they should have moved.
4. **Self-pills also drift to the baseline if the snapshot RPC ever 401s during early render**, because nothing re-fetches afterwards.

There is exactly one source of truth (`profiles.trust_snapshot`); the UI just isn't reading it.

## Fix

### Backend (one migration)

- Add `public.get_trust_summary(_user_id uuid) → jsonb` (SECURITY DEFINER, `STABLE`, `search_path=public`). Returns only the safe summary needed by pills:
  ```json
  { "user_id", "role", "rating": { "score", "sample_size", "block_index" },
    "reliability": { "score", "sample_size", "block_index" } }
  ```
  Reads `profiles.trust_snapshot` directly (always fresh — triggers maintain it); falls back to `recompute_trust` when null. Excludes restriction reasons / eligibility / PII so it is safe to grant to every signed-in user. `GRANT EXECUTE ... TO authenticated`. The existing privileged `get_trust` is unchanged (self / admin / related-party detail view).
- Drop the server-side 5-minute staleness branch in `get_trust` so it always reads the live `trust_snapshot`; triggers keep it current, and we want zero lag for the rare full-detail read too.
- Confirm `public.profiles` is already in the `supabase_realtime` publication with `REPLICA IDENTITY FULL` (set by the recent admin-sync migration); no-op otherwise.

### Client — baseline must remain 5.0★ / 100%, never a dash

The product rule is explicit: every doctor and every requester starts with a real, displayable baseline of **5.0★ and 100% reliability**, and that baseline updates the instant the first real rating / shift outcome lands. The user should never see an empty state, a dash, "—", a spinner, or "no rating yet" anywhere a pill renders. The fixes preserve this:

1. **Plumb the real user UUID through coverage payloads.** `Coverage`, `HistoryItem`, and the incoming/queued dispatch shapes get a `requesterUserId: string | null` field (and `doctorUserId` where applicable), hydrated from `coverage_requests.requester_id` / `accepted_by` in `coverage-remote.ts` and `dispatch.ts`.
2. **New helper `userEntityId(userId) → "u:<uuid>"`** added to `trust.ts`, and `userIdFromEntity` updated to accept `doc:`, `req:`, and `u:` prefixes. Every hospital pill switches to `userEntityId(item.requesterUserId)`.
3. **Update every call site** in `CoverHome.tsx`, `CoverDispatchPortal.tsx`, `CoverageScreen.tsx`, `RequesterHome.tsx` to pass the user UUID — never the hospital slug — for both `RatingPill` and `ReliabilityPill`. Self pills in `CoverHome.tsx` use `userEntityId(currentUserId)` from auth, not `getSessionId()`.
4. **Switch the pill reads to `get_trust_summary`** so any signed-in viewer can read any user's pill values across the broadcast/dispatch surfaces. Keep `get_trust` (full snapshot) for the user's own profile, admin, and trust detail overlays.
5. **Keep `DEFAULT_SNAPSHOT` as the rendered baseline.** `RatingPill` / `ReliabilityPill` continue to render the default 5.0★ / 100% immediately and synchronously — both (a) for the first ~100ms while the SWR cache resolves, and (b) for any user whose `sample_size` is 0 (no real ratings / no terminal shifts yet). The pills never render a dash, "—", "N/A", a skeleton, or a hidden state. Once `recompute_trust` returns a non-default value (rolling-20 with at least one real datapoint), the pill swaps to that value on the same render.
   - Edge case: if a fetch genuinely fails (network/RLS error), still show 5.0★ / 100% rather than an error state — failing closed to the baseline matches the product rule and is indistinguishable from a brand-new user.
6. **Realtime fan-in.** Add one shared `profiles` `postgres_changes` subscription in `trust.ts`. On every UPDATE whose `new.id` is in the active cache, drop the cache entry and call `loadTrust(id)`. Tear down with the last listener. The instant any rating insert or shift-terminal trigger fires server-side, every open pill for that user updates without a refresh.
7. **Drop the 30s client TTL** in favour of "load once + invalidate on realtime / explicit dispatch event". The cache becomes an idempotent read-through, not a staleness window.

### Verification

- DB: insert a rating against a real shift; `profiles.trust_snapshot.rating.score` shifts from 5.0 toward `(5*19 + new)/20`; `get_trust_summary` returns the new value.
- UI baseline: a fresh test account renders 5.0★ / 100% on every surface, with no dash and no flicker.
- UI live update: with two browser windows (doctor + requester), submit a rating from one — the pill in the other window updates without any refresh. Cancel an accepted shift; reliability drops by `100/20 = 5pp` instantly on both sides.
- Code scan: zero remaining `hospitalEntityId(...)` references inside `<RatingPill>` / `<ReliabilityPill>` props; zero "—" / "N/A" / skeleton fallbacks inside the pill components.

## Out of scope

- The scoring formula itself — already matches the spec (rolling-20, 20-slot synthetic baseline, completed vs cancelled-after-acceptance attribution, requester-only cancellations attributed to requester).
- Admin trust dashboard — already reads the full snapshot and is unaffected.
- Help-centre copy — already up to date.
