## Root cause

The DB realtime UPDATE for "doctor went offline" **is** being delivered to requesters (the previous RLS fix unblocked it). The delay is now entirely client-side, in two layers that conspire to hide the offline transition for up to 2 minutes:

1. `src/lib/presence-remote.ts` → `buildSnapshot()` filters out any row where `online === false`. So when the realtime UPDATE arrives flipping a doctor to offline, the snapshot emitted to subscribers simply **omits** that doctor (instead of emitting them with `online:false`).

2. `src/lib/network.ts` → `mergePresenceRows()` sees the doctor missing from the incoming snapshot, then applies a `PRESENCE_PRESERVE_MS = 2 * 60 * 1000` fallback that **keeps the previous entry with `online:true`** as long as `lastSeen` is under 2 minutes old. The map's `onlineDoctors(net)` selector then keeps rendering that doctor as online.

Net effect: ONLINE→OFFLINE takes ~2 min to propagate visually (whichever expires first: server-side cron flipping `online=false`, or the 2-min client preserve window). OFFLINE→ONLINE looks instant because the row is now present with `online:true`, overwriting any stale entry immediately.

The preserve fallback's stated purpose (smoothing a flicker while a now-removed client-side approval check resolved) no longer applies — approval is filtered server-side in `list_online_approved_doctors` and RLS, and the local doctor's own toggle path already updates state synchronously.

## Fix (frontend only)

Two minimal edits, no schema or RLS changes:

1. **`src/lib/presence-remote.ts` — `buildSnapshot()`**
   - Remove the `if (!r.online) continue;` filter. Emit every row in `rawRows`, including those with `online:false`.
   - Update the comment block accordingly: presence-remote is now a pass-through cache; the *rendering* layer decides which doctors are visible.

2. **`src/lib/network.ts` — `mergePresenceRows()`**
   - Delete the `PRESENCE_PRESERVE_MS` constant and the trailing "preserve prev entry when missing" loop.
   - The merge becomes a straight projection of the incoming rows into `state.doctors`. A doctor flipped to `online:false` now arrives explicitly with that flag and the `onlineDoctors()` selector drops them on the next render.

No other call site needs to change:
- `onlineDoctors(net)` (line 1189) already filters by `d.online`.
- `GoogleMapBackground` only renders markers for the doctors handed in, so offline doctors disappear from the map immediately.
- The local doctor's own UI continues to write `upsertMyPresence` synchronously, so their own toggle is unaffected.

## Verification after build

- Doctor A toggles Offline → requester B sees the marker disappear within one realtime tick (sub-second on the same network), with no reload.
- Doctor A toggles Online → marker reappears immediately (unchanged from today).
- Doctor A signs out → `signOutAndClearPresence` writes `online:false` before tearing down the session; marker disappears immediately.
- No regression to the local doctor's own Online/Offline pill (driven by `useDispatch`, not the presence snapshot).
