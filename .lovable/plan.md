## Plan — Reuse the proven Cancel withdrawal/republication path for Edit Request

### Investigation finding

The working **Cancel Request** behavior and broken **Edit Request** behavior do not use the same control path.

- Cancel Request opens a modal while `DispatchOverlay` stays mounted.
- Inside `DispatchOverlay`, `paused = cancelOpen || editOpen` triggers the reliable pre-acceptance gate:
  - modal opens → `pauseRequest(requestId)` → server row becomes `paused` → doctors' `list_open_coverage_requests` no longer returns it.
  - modal closes / Wait for Doctor → `resumeRequest(requestId)` → server row becomes `searching` again → doctors see it again.
- The pre-acceptance **Edit Request** button currently does **not** open that modal/gate. It directly calls `setStage("configure")`, which unmounts `DispatchOverlay` and relies on a parent `stage === "configure"` effect to pause later.

That is the mismatch: Edit leaves the component that owns the proven Cancel pause/resume gate before the withdrawal is guaranteed.

### Root cause

Pre-acceptance Edit has a transition-order race:

1. User taps **Edit Request**.
2. UI immediately leaves `DispatchOverlay` (`setStage("configure")`).
3. The old broadcast card may remain visible to doctors until the parent effect runs and the server pause/invalidation/fetch cycle completes.
4. On later cycles, local status echoes can make the effect/race worse, so the doctor feed can keep showing the old card or receive confusing duplicate refreshes.

Cancel works because it pauses while staying inside `DispatchOverlay`; Edit should do the same pause **before** leaving `DispatchOverlay`.

### Additional finding from the parallel code audit

There is one more reliability gap outside the button click itself:

- `applyRemoteEvent` already handles `paused → broadcasting` when the realtime row event arrives.
- The snapshot fallback in `network.ts` does **not** synthesize a `paused → broadcasting` event if that realtime row event is missed/delayed.

That means Edit can pause correctly, then republish correctly on the server, but the doctor-side fallback path may fail to treat the republished request as a fresh offer. Cancel is more reliable because its terminal delete/cancel transitions are already handled in all paths.

### Exact remediation plan

Edit only these files:

- `src/features/request/RequesterHome.tsx`
- `src/lib/network.ts`

1. Add a parent handler `beginLiveRequestEdit()` in `HomeScreen`:
   - if `activeRequestId` exists, call `pauseRequest(activeRequestId)` synchronously;
   - remember that request id in `editingLiveRequestId`;
   - then call `setStage("configure")`.

2. Pass `beginLiveRequestEdit` into `DispatchOverlay` as `onEditRequest`.

3. Change the pre-acceptance **Edit Request** button from:
   - `onClick={() => setStage("configure")}`
   to:
   - `onClick={onEditRequest}`.

4. Keep the request withdrawn for the entire edit flow:
   - existing parent effect still calls `pauseRequest(activeRequestId)` while `stage === "configure" || stage === "match"`.

5. If the requester abandons editing by tapping outside/collapsing:
   - when `editingLiveRequestId` is set and `stage === "collapsed"`, call `resumeRequest(editingLiveRequestId)` and clear it.
   - This mirrors Cancel's “Wait for Doctor / outside tap restores the card” behavior.

6. If the requester saves the edit:
   - the existing configure → match → dispatch path updates the existing row and calls `resumeRequest`, republishing it as a fresh request.
   - Clear `editingLiveRequestId` once the stage returns to `dispatch` or `accepted`.

7. Add the missing snapshot fallback in `src/lib/network.ts`:
   - when `old.status === "paused" && r.status === "broadcasting"`, synthesize a doctor-visible re-publication event.
   - Use `action: "publish"` rather than only `"resume"` so the doctor feed treats the restored request like a fresh incoming offer, matching the expected user experience after saving an edit.

### Why this is the correct fix

It does not invent a new delivery model. It reuses the exact proven primitives Cancel already uses:

- withdrawal = `pauseRequest`
- doctor feed removal = `status != searching`
- restoration/republication = `resumeRequest`

The only change is moving Edit's first pause to the same moment Cancel already pauses: immediately on click, before any UI transition can unmount the dispatch overlay.

The snapshot fallback addition ensures the saved edit also reappears reliably even if the lower-level realtime row event is delayed or dropped.