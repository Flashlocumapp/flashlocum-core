## Root cause

The pre-acceptance "Edit Request" button is supposed to take the doctor's Incoming Coverage card **down** while the requester edits, and put it back **fresh** (new `rev` + reset 180s broadcast window) when the requester re-publishes. The intended mechanism is `status: searching → paused → searching`, driven by `pauseRequest()` / `resumeRequest()`.

The "Edit Request" button currently does only `setStage("configure")`. It does **not** open the `editOpen` bottom sheet or set `cancelOpen`. The pause/resume effect that watches those flags therefore never fires for this path:

```ts
// src/features/request/RequesterHome.tsx (≈1271–1283)
const paused = cancelOpen || editOpen;
useEffect(() => {
  if (!requestId) return;
  const cur = net.requests[requestId];
  if (!cur || cur.acceptedBy) return;
  if (paused) pauseRequest(requestId);
  else if (stage === "dispatch") resumeRequest(requestId);
}, [paused, requestId, stage, net]);
```

When stage goes `dispatch → configure` for "Edit Request":
- `paused` is still `false` (no sheet open).
- `stage !== "dispatch"`, so the `else if` does nothing.
- **The DB row stays `searching`.** No invalidate is emitted. The doctor's card stays on screen showing the OLD content.

When stage goes `configure → dispatch` (user taps "Find Doctor"), the publish effect's reuse branch runs:

```ts
// (≈1215–1234)
if (cur && canReuseRequest) {
  updateRequest(cur.id, { /* new fields */ });
  resumeRequest(cur.id);  // guard: status === "broadcasting" → return
  return;
}
```

`resumeRequest` short-circuits because `cur.status` is still `"broadcasting"` (it was never paused). The only thing that propagates to doctors is whatever `bump_request_rev_on_change` decides from the `updateRequest` patch:

```sql
material_changed :=
  NEW.hospital IS DISTINCT FROM OLD.hospital
  OR NEW.start_time IS DISTINCT FROM OLD.start_time
  ...
```

### Why it "works once" then stops

On the **first** Edit Request the patch usually carries a value that differs from the DB row (the row still holds the original create-time fields), so `material_changed = true`, the trigger bumps `rev` and `broadcast_started_at`, `coverage_requests_emit_invalidate` fires, doctors refresh, and the card content changes.

On the **second** Edit Request the requester's `updateRequest` patch is computed from the same `draft` / `coverage` / `days` / `location` state used last time. The publish effect re-sends the full block — `hospital`, `area`, `coverage`, `day`, `start`, `end`, `durationHrs`, `amount`, `note`, `startTs`, `endTs`, `days`, `environment`. After the first edit cycle, all of those fields in the DB already equal what the requester is about to send (the requester's only "real" change is something already reflected in `draft`, or a string-equal repeat). `material_changed` evaluates to `false`, so:

- `bump_request_rev_on_change` does NOT bump `rev` or `broadcast_started_at`.
- `coverage_requests_emit_invalidate.should_emit` evaluates to `false` (no status change, no `broadcast_started_at`/`rev` change, no `accepted_by` change).
- No realtime broadcast goes out.
- Doctors never refresh, and the card stays with the previous values — exactly what the user is reporting.

This is not a workaround we can paper over by always touching some field; the design depends on a deterministic pause → republish lifecycle.

## Real fix

Make "Edit Request" an explicit, idempotent pause/republish — exactly the contract `pauseRequest` / `resumeRequest` were written for — instead of leaving the broadcast running and hoping the trigger detects a diff.

### 1. `src/features/request/RequesterHome.tsx` — pause whenever the requester leaves dispatch to edit

Extend the pause condition to include "user has navigated away from dispatch with an active pre-acceptance request" (i.e. they are in the configure stage editing this request):

```ts
const editingFromDispatch =
  stage === "configure" && requestId != null && !net.requests[requestId]?.acceptedBy;
const pausedForBroadcast = paused || editingFromDispatch;

useEffect(() => {
  if (!requestId) return;
  const cur = net.requests[requestId];
  if (!cur || cur.acceptedBy) return;
  if (pausedForBroadcast) pauseRequest(requestId);
  else if (stage === "dispatch") resumeRequest(requestId);
}, [pausedForBroadcast, requestId, stage, net]);
```

Effect: tapping "Edit Request" immediately transitions the row to `paused` on the server, `coverage_requests_emit_invalidate` fires (status change), every doctor's `coverage_invalidations` channel triggers a refresh, and `list_open_coverage_requests` excludes paused rows — the card disappears within one realtime cycle. Idempotent on subsequent edits because `pauseRequest` early-returns when status is already `paused`.

### 2. `src/lib/network.ts` — make `resumeRequest` deterministic instead of "only if currently paused"

The current `resumeRequest` returns early when `status === "broadcasting"`, which is why a second Find-Doctor tap produces no rev bump if the pause never ran. With fix #1 the row will be `paused` before every resume, but we should also harden the function so a missed/echoed local state can't silently swallow the bump:

```ts
export function resumeRequest(id: string) {
  refreshState();
  const cur = state.requests[id];
  if (!cur) return;
  if (cur.acceptedBy) return;            // accepted shifts use resume_shift RPC
  if (cur.status !== "broadcasting" && cur.status !== "paused") return;
  // Always bump locally; the server trigger will re-bump on paused→searching.
  applyPatch(
    id,
    {
      status: "broadcasting",
      broadcastStartedAt: simNow(),
      rev: (cur.rev ?? 1) + 1,
    },
    { actor: "requester", actorId: getSessionId(), action: "resume" },
  );
}
```

Why this matters: even with #1 in place, the local store may briefly observe `status: "broadcasting"` between optimistic writes and realtime echoes. We never want a Find-Doctor tap to be a no-op when the requester is actively re-publishing.

### 3. Database — let `coverage_requests_emit_invalidate` fan out resume even if `rev` is bumped only client-side

`bump_request_rev_on_change` already bumps `rev` + `broadcast_started_at` on `paused → searching`, so this is now consistent for the Edit Request flow. No migration is needed for correctness with fix #1 + #2.

We are intentionally NOT proposing "always bump `rev` on every update" — that breaks the doctor's `(id, rev)` decline-key contract by making every keystroke look like a fresh offer.

## Verification after build

Manual, with two devices:

1. Requester creates a request → doctor sees the card.
2. Requester taps **Edit Request** → doctor's card disappears within ~1s (status paused, RPC excludes paused).
3. Requester edits → taps Find Doctor → doctor's card reappears with the updated fields, fresh 180s window, `rev` incremented.
4. Repeat steps 2–3 a second, third, fourth time. Each cycle the card disappears on Edit and reappears on Find Doctor with the new content — no manual refresh, no reload.
5. Edge case: Requester taps Edit Request, makes NO changes, taps Find Doctor → card still disappears and reappears (now correct, because pause/resume is now status-driven rather than diff-driven).

DB sanity checks (optional, via SQL): after each Edit Request, confirm `status = 'paused'`; after each Find Doctor, confirm `status = 'searching'` and that `rev` has incremented and `broadcast_started_at` is fresh.
