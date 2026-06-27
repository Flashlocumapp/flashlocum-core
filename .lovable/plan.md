## Request acceptance stuck on requester “Searching” — investigation findings

The attached video and the captured network traffic show the real failure:

- The doctor **does successfully accept** the request.
- Supabase confirms the row is already server-side accepted:
  - `id = e1651cda-f211-4679-85af-bf3c812e0513`
  - `status = accepted`
  - `accepted_by = 19ab6402-3042-4e2c-b945-bebcd0b04fbc`
  - `requester_id = 391c0ef6-da8e-4da2-beaa-e1820c9a9efa`
- The requester UI remains on the “Searching / Connecting to available doctors nearby” overlay even though the backend truth is accepted.

So this is **not** a claim RPC problem and not a doctor accept-button problem. The acceptance state exists in the database; the requester overlay is failing to consume that accepted row reliably.

## Root causes found

### 1. The requester overlay depends on `useNetwork()` state only

`DispatchOverlay` currently advances from `dispatch` to `accepted` only when this condition sees the accepted row inside `net.requests[requestId]`:

```ts
const r = net.requests[requestId];
if (stage === "dispatch" && !!r.acceptedBy && ...) {
  setStage("accepted");
}
```

The watchdog `useLifecycleReconcile(requestId)` is mounted, but it only calls `reconcileRequest(id)` for its side effect. If React state fan-out is missed, stale, blocked by an equal snapshot hash, or the overlay ownership ref no longer matches, the hook has no direct way to force the overlay stage forward.

This matches the video: repeated network reads are returning `accepted`, yet the overlay stays in the searching render branch.

### 2. `fetchAndIngestRow()` throws away the direct row result

`coverage-remote.ts` can fetch the exact accepted row by id, but `reconcileRequest(id)` currently returns `Promise<void>`. That means a lifecycle screen cannot make a local UI decision from the authoritative row it just fetched.

For this bug, that is the missing safety net: the requester overlay needs to say, “I just read my row and it has `accepted_by`; move to accepted now,” even if the broader network subscription path failed to repaint.

### 3. The acceptance transition is still over-gated

The current overlay transition excludes some status combinations and requires `requestId === ownedIdRef.current`. That is sensible for avoiding stale requests, but in the failure class shown in the video it can also keep a valid accepted row from advancing. The permanent fix should key primarily on server truth for the active request id: **if the current request has `accepted_by`, searching must end**.

## Exact remediation plan

### A. Make single-row reconcile return authoritative data

Edit `src/lib/coverage-remote.ts`:

1. Change `fetchAndIngestRow(id)` from `Promise<void>` to `Promise<NetRequest | null>`.
2. When the row is found and ingested, return the mapped `NetRequest`.
3. When the row is absent or removed, return `null`.
4. Change `reconcileRequest(id)` to return `Promise<NetRequest | null>`.
5. Expand `hashCoverageSnapshot()` to include `acceptedBy`, so any accepted-by handoff triggers subscriber fan-out even if a future trigger regression leaves `updated_at` unchanged.

### B. Let lifecycle screens react directly to the authoritative row

Edit `src/lib/use-lifecycle-reconcile.ts`:

1. Add an optional `onRow(row: NetRequest | null)` callback.
2. Invoke it after every `reconcileRequest(id)` result.
3. Keep the current immediate run, interval run, visibility/focus/online runs, and all existing callers working without changes.

### C. Fix requester overlay once and for all

Edit `src/features/request/RequesterHome.tsx`:

1. In `DispatchOverlay`, add a local `advanceFromRow(row)` helper.
2. If `row.id === requestId` and `row.acceptedBy` exists and row is not cancelled/expired, immediately call `setStage("accepted")`.
3. Use that helper from:
   - the existing `useNetwork()`-based effect, and
   - the new `useLifecycleReconcile(..., { onRow })` callback.
4. Remove the status exclusions that block acceptance when `acceptedBy` exists. Server `accepted_by` is the canonical signal that searching is over.
5. Keep cancellation/expiry collapse behavior so cancelled/expired rows do not show as accepted.

### D. Verification

After implementation, verify:

1. Requester creates request → doctor accepts → requester overlay moves from Searching to Doctor accepted without refresh.
2. If realtime misses the event, the single-row watchdog read advances the requester within its 4s cadence.
3. Accepted rows still show the accepted doctor card using the same `net.requests[requestId]` data once network state catches up.
4. Cancelled/expired requests still collapse and do not show the accepted card.

## Files to edit

- `src/lib/coverage-remote.ts`
- `src/lib/use-lifecycle-reconcile.ts`
- `src/features/request/RequesterHome.tsx`