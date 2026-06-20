## Summary

Three issues, two root causes. Both root causes come from the previous "always bump rev on resume" fix combined with effects that subscribe to the entire `net` object.

## Issue 1 & 2 — same root cause

**Symptoms**
- On the requester's broadcasting card, **Edit Request** and **Cancel Request** taps feel dead.
- On the doctor side, dismissing the **New request** card removes it for a beat, then it pops back almost instantly.

**Root cause: an infinite rev-bump feedback loop**

Two changes in the previous turn now interact destructively:

1. `resumeRequest()` in `src/lib/network.ts` was made unconditional:
   ```ts
   applyPatch(id, {
     status: "broadcasting",
     broadcastStartedAt: simNow(),
     rev: (cur.rev ?? 1) + 1,         // bumps EVERY call
   }, { actor: "requester", action: "resume" });
   ```
2. `DispatchOverlay` already has an effect that calls it on every `net` change:
   ```ts
   useEffect(() => {
     if (!requestId) return;
     const cur = net.requests[requestId];
     if (!cur || cur.acceptedBy) return;
     if (paused) pauseRequest(requestId);
     else if (stage === "dispatch") resumeRequest(requestId);   // <-- here
   }, [paused, requestId, stage, net]);                          // <-- net dep
   ```

While the requester is in `dispatch`, every network tick (presence heartbeat from any doctor, any realtime echo, the doctor's own state update) makes `net` a new object. The effect fires, calls `resumeRequest`, which bumps `rev` and `broadcast_started_at` and writes to the DB. That write echoes back through realtime → `net` changes again → effect fires again → another bump. The loop runs as fast as the round-trip allows.

Downstream effects of the loop:

- **Doctor side**: `markDeclined` keys are `${id}:${rev}`. Every bump invalidates the existing decline key. The dismissed card immediately reappears on the next ingest because `isDeclined(me, x.id, x.rev)` returns false for the new rev.
- **Requester side**: the broadcasting card re-renders constantly and the publish/sync effect at lines 1206–1269 also runs against a moving `cur`. `Edit Request` / `Cancel Request` taps do fire `setStage("configure")` / `setCancelOpen(true)`, but the broadcasting effect immediately resyncs and the loop's optimistic rev/broadcast bumps reset the local mirror before the next render commits, so the UI looks unresponsive.

**Fix (real, not a workaround)**

1. `src/lib/network.ts` — `resumeRequest`: only act when there is actually something to resume. Bump `rev` and `broadcast_started_at` ONLY on the `paused → broadcasting` transition. The "always bump" version was introduced to defeat the trigger's diff check, but the correct contract is paused→broadcasting; the server trigger `bump_request_rev_on_change` already bumps reliably on that status flip. The "second Edit Request stopped working" bug it tried to address is fixed by #2 below — the publish effect already calls `pauseRequest` before `resumeRequest`, so by the time resume runs locally the row is paused.

   ```ts
   export function resumeRequest(id: string) {
     refreshState();
     const cur = state.requests[id];
     if (!cur || cur.acceptedBy) return;
     if (cur.status !== "paused") return;            // <-- key change
     applyPatch(id, {
       status: "broadcasting",
       broadcastStartedAt: simNow(),
       rev: (cur.rev ?? 1) + 1,
     }, { actor: "requester", actorId: getSessionId(), action: "resume" });
   }
   ```

2. `src/features/request/RequesterHome.tsx` — `DispatchOverlay` pause/resume effect: stop depending on the whole `net` object. Read the current request once per dependency change and only re-run when the fields that matter actually change (`status`, `acceptedBy`). This kills the feedback loop at its source even if a future contributor re-introduces an unconditional bump.

   ```ts
   const cur = requestId ? net.requests[requestId] : undefined;
   const curStatus = cur?.status;
   const curAcceptedBy = cur?.acceptedBy;
   useEffect(() => {
     if (!requestId || !curStatus || curAcceptedBy) return;
     if (paused) {
       if (curStatus === "broadcasting") pauseRequest(requestId);
     } else if (stage === "dispatch") {
       if (curStatus === "paused") resumeRequest(requestId);
     }
   }, [paused, requestId, stage, curStatus, curAcceptedBy]);
   ```

   Also harden the publish/sync effect at line 1206: when reusing a paused request after Edit, call `pauseRequest` first if the local mirror still reads `broadcasting` (cheap and idempotent), then `updateRequest`, then `resumeRequest`. This guarantees a deterministic `searching → paused → searching` cycle on every "Find Doctor" tap and re-arms the server trigger even when the patched fields equal the DB row, which was the original "edit-twice" failure mode.

3. The Edit-Request lifecycle effect in `HomeScreen` (lines 225–230) already handles the `dispatch → configure` pause. Leave it as is.

**Verification**
- Submit a request → second device (doctor) sees the card.
- Doctor dismisses → card stays gone.
- Requester taps Edit Request → doctor's card disappears immediately; requester edits and re-publishes → doctor sees the updated card with a fresh 180s window. Repeat 3× — every cycle behaves identically.
- Requester taps Cancel Request → CancelFlow opens on the first tap and the card actually disappears after confirming.
- Network panel: while broadcasting and idle (no edits), there are NO writes to `coverage_requests` from the requester — only doctor presence heartbeats.

## Issue 3 — requester does not see every online doctor

**Root cause**

`presence-remote.ts` calls the SECURITY DEFINER RPC `list_online_approved_doctors` for the initial snapshot:

```sql
WHERE dp.online = true
  AND p.verification_status = 'approved'
  AND dp.last_seen > now() - interval '90 seconds'
```

The 90-second freshness filter is the bug. Server truth for "is this doctor online" is the boolean `dp.online`, owned by the `expire_stale_doctor_presence` pg_cron job (per the comment in `presence-remote.ts`). When the cron flips a stale doctor to `online=false`, the change propagates through realtime and the client drops them — that is the correct, single authority for going dark.

Layering a client-fetch freshness gate on top means: any doctor whose `online=true` row has `last_seen` older than 90s (background tab with throttled `setInterval`, slow phone, momentary network hiccup) is hidden from the requester's initial snapshot, even though the server still considers them online and the cron has not flipped them off. Realtime then only delivers them when they next heartbeat — for a backgrounded tab that may never happen during the requester's session.

**Fix (real, not a workaround)**

`supabase/migrations/<new>.sql` — redefine `list_online_approved_doctors` to trust the server-owned `online` flag:

```sql
CREATE OR REPLACE FUNCTION public.list_online_approved_doctors()
RETURNS TABLE(user_id uuid, online boolean, last_seen timestamptz,
              top double precision, "left" double precision,
              lat double precision, lng double precision)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT dp.user_id, dp.online, dp.last_seen, dp.top, dp."left", dp.lat, dp.lng
    FROM public.doctor_presence dp
    JOIN public.profiles p ON p.id = dp.user_id
   WHERE dp.online = true
     AND p.verification_status = 'approved';
$$;
```

No client-side change is required: the snapshot is already a pass-through projection, the SELECT RLS policy already allows requesters to read every approved doctor's row, and offline transitions still propagate instantly through realtime UPDATEs (the `expire_stale_doctor_presence` cron is the sole arbiter of "this doctor went dark").

**Note on map markers (unchanged, by design)**

`GoogleMapBackground` only renders a marker when the doctor has a GPS fix (`lat`/`lng` present) and is inside Lagos. Doctors who declined location permission won't have a pin even though they're counted as online — that is intentional and matches what is rendered everywhere else in the app. If the user wants those doctors to also appear, that is a separate, additive change and should be confirmed explicitly before adding fallback positioning.

## Files touched

- `src/lib/network.ts` — gate `resumeRequest` to the `paused → broadcasting` transition.
- `src/features/request/RequesterHome.tsx` — narrow the `DispatchOverlay` pause/resume effect's dependencies; ensure publish/sync calls `pauseRequest` before `resumeRequest` on Edit-Request reuse.
- `supabase/migrations/<timestamp>_presence_drop_freshness_gate.sql` — drop the 90s `last_seen` filter from `list_online_approved_doctors`.
