## Finding

`confirm.wav` plays for the requester **only on the native (Capacitor) shell**, not in the web browser.

### Why

`src/lib/feedback.ts` → `plan()` correctly routes `offer.accepted` to `sound: "confirm"` for both audiences (doctor and requester). The sound plays whenever `ingest({ kind: "offer.accepted", … })` is called.

Today `offer.accepted` is ingested from only two places:

1. `src/features/cover/dispatch.ts` — the **doctor** who tapped Accept (local source).
2. `src/lib/push-registration.ts` — foreground OneSignal push routed through `fromPush()`. This fires for the requester **only inside the Capacitor native shell** (the file early-returns when `Capacitor.isNativePlatform()` is false).

No realtime adapter on the requester side converts the `coverage_requests` row update (where `accepted_by` flips from `null` to a UUID) into an `ingest({ kind: "offer.accepted", source: "realtime", audience: "requester" })` call. So in the browser, the "Doctor Accepted" card appears (driven by row state in `network.ts` / `RequesterHome.tsx`) but no confirm tone plays.

## Fix

Add a single realtime adapter on the requester side that emits `offer.accepted` the moment the owned request transitions to `accepted_by != null`. The engine's G2 tiebreak and 6 s G4 dedup window will collapse it with the native push echo so users never hear it twice.

### Implementation steps

1. **`src/lib/network.ts`** — in the existing requester-side row ingester (where realtime updates and snapshot reconciles land), detect the transition `prev.acceptedBy == null && next.acceptedBy != null` for rows where the current user is the requester. On that edge call:

   ```ts
   ingest(fromRealtime({
     kind: "offer.accepted",
     entityId: next.id,
     audience: "requester",
     updatedAt: next.updatedAtMs,   // row updated_at → epoch ms (version)
     ctx: { doctorName, hospitalName: next.hospital ?? undefined },
   }));
   ```

   - `doctorName` is best-effort: read from any joined profile already cached for `next.acceptedBy`; if absent, omit (the plan() falls back to "the doctor", but the engine still plays `confirm.wav` regardless).
   - The hash already includes `acceptedBy` (per `coverage-remote.ts` line 346), so listeners fan out on this edge — we just add the canonical emit alongside.

2. **No change** to `src/lib/feedback.ts`, `src/lib/sound.ts`, `src/lib/push-registration.ts`, or `confirm.wav`. The playback layer already does the right thing once the event is ingested.

3. **No change** to the doctor side. Doctor still gets `confirm.wav` from the local `dispatch.ts` emit, deduped against the foreground push echo on native shells.

### Verification

- Web browser: place a request as requester, accept as doctor in a second tab → "Doctor Accepted" card appears AND `confirm.wav` plays once on the requester tab.
- Native shell (later): same flow → confirm tone still plays exactly once because the 6 s G4 window collapses the realtime emit and the foreground push.
- Multi-tab: BroadcastChannel mirrors the decision so a second open requester tab stays silent.
