# Server-Authoritative Feed (no optimistic accept/decline/assignment)

## Goal
Doctor feed (Incoming / Upcoming / Active) and the per-request acceptance state must reflect only what the server reports. The client never writes `status='accepted'`, `acceptedBy`, or "this row is gone" locally before the server confirms.

## What changes

### 1. `acceptRequest` — server-roundtrip first, no local write
File: `src/lib/network.ts` (`acceptRequest`, ~lines 781–819).

- Make it `async` and remove the optimistic `save({...status:'accepted', acceptedBy:sid})` block and the rollback block underneath it.
- New flow:
  1. Run local pre-checks (`broadcasting`, `acceptedBy==null`, max-shifts, conflict) — these read state, never mutate it.
  2. `await remoteClaimRequest(id, sid)`.
  3. On `won=true`: do **not** patch local state — `emitInvalidate(id)` already runs inside `remoteClaimRequest`; the realtime subscription + `refreshState` cycle is the only path that flips the row to `accepted`.
  4. On `won=false`: return `{ ok:false, reason:'claimed' }`. Do not touch local state.
- Add a transient per-request "claim in-flight" set kept only in this module (Map of id → timestamp) so the same doctor can't double-tap the same card. This is UX guard, not state — it never enters `state.requests`.

### 2. `acceptIncoming` — drive UX off the awaited result
File: `src/features/cover/dispatch.ts` (`acceptIncoming`, ~lines 403–443).

- `await acceptRequest(idToAccept)`.
- On `ok:false` with `reason==='claimed'` or `unavailable'`:
  - Show toast `"This request is no longer available"`.
  - Call `markDeclined(id, rev)` so the card is suppressed locally for the current `rev` (decline is a per-session preference, not feed state — see §4).
  - Do **not** set `acceptedSheet`.
- On `ok:true`: do **not** set `acceptedSheet` here. Instead, the existing `subscribeNetwork` watcher in `ensureDoctorSession` already reacts to the server-confirmed row landing in state and is the single place that opens the Accepted sheet. Add the missing branch: when an event with `action==='accept'` arrives for a row where `acceptedBy === sid`, set `acceptedSheet = toCoverage(r)` and `bump()`.
- Remove the post-`acceptRequest` block that reads `currentRequest(idToAccept)` synchronously and opens the sheet — it depends on optimistic state.

### 3. `useDispatch` derivations — already server-derived, verify
File: `src/features/cover/dispatch.ts:165–274`.

- `incoming`, `upcoming`, `accepted`, `history` are already derived from `useNetwork()` snapshots. No change needed beyond removing any code path that depends on the optimistic write being present before the server confirms.
- Confirm `accepted` (the AcceptedBody sheet) reads from `acceptedSheet` only after the server-confirmed event branch above sets it.

### 4. Clarify: `markDeclined` is per-session UX preference, not feed state
`markDeclined` writes to `state.doctors[sid].declined` (a personal mute list keyed by `${id}:${rev}`). It does not mutate the request row. This is explicitly allowed under the rule — it is the doctor's local "don't show me this offer again at this rev" filter, equivalent to a UI dismissal. We keep it.

(A future server-side decline table is out of scope for this change.)

### 5. `cancelRequest` — already server-authoritative; verify no optimistic patch
File: `src/lib/network.ts:821–828`.

- `cancelRequest` calls `applyPatch` which routes through `coverage-remote.ts:744` → `cancelAndNotifyFn`. Audit the local-mirror behaviour of `applyPatch`: if it writes `status='cancelled'` locally before the server reply, change it to skip the local write and rely on the realtime callback for the cancelled state. (Mirrors §1.)

### 6. Race-loss UI invariants
- The card must disappear from `incoming` derivation purely because: (a) server flipped `status` away from `searching`, or (b) `isDeclined(...)` returned true after the local toast handler called `markDeclined`. Both paths are idempotent and stable on refetch.
- No code path sets `requests[id].status = 'accepted'` from the client. Search-and-verify: `rg -n "status:\s*\"accepted\"|status=\s*'accepted'" src/` after the edit; only server-derived writes (the realtime/snapshot ingester in `coverage-remote.ts`) should appear.

### 7. Tests / verification
- Manual two-tab race: open feed in two doctor sessions, accept the same request — loser sees toast, card vanishes, never reappears on refetch.
- Slow-network accept: throttle to 3G, confirm no flash of "accepted" UI before the server confirms; instead the Incoming card stays until the server reply, then transitions cleanly.
- Cancel by requester while doctor has the Accepted sheet open: sheet closes only after server event (existing watcher branch covers this).

## Out of scope
- Persisting declines server-side.
- Removing `paused`/`expired` from the state model.
- The post-accept edit-lock trigger gap (separate ticket).
- Toast styling.

## Risk
- Network latency now visibly delays the Accepted sheet by one round-trip. Acceptable per the rule: no transient inconsistency is the goal.
- The "claim in-flight" guard must clear on both success and failure to avoid sticky-disabled buttons.
