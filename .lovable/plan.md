## Goal
When an admin restricts a doctor, remove them from the online pool **immediately** instead of waiting up to ~2 minutes for their heartbeat to go stale. Also tighten the staleness window so unrestricted-but-disconnected doctors fade faster.

## Current behavior
- `doctor_presence.online` is never flipped when a restriction is applied.
- The browser heartbeats every 25s; after Priority 2, heartbeats from a restricted doctor are rejected by RLS, so `last_seen` freezes.
- Map (`presence-remote.ts`) and admin dashboard (`admin.functions.ts`) both treat a presence row as "online" only if `last_seen` is within **120s**.
- Net effect: a restricted doctor lingers in the pool up to ~2 min.

## Changes

### 1. Migration — force offline on restriction
Add a trigger on `public.profiles` that fires `AFTER UPDATE OF account_restricted_at`. When the column transitions from `NULL` to a non-null value, run:

```sql
UPDATE public.doctor_presence
   SET online = false,
       last_seen = now() - interval '10 minutes'
 WHERE user_id = NEW.id;
```

Pushing `last_seen` into the past guarantees every freshness check (current and tightened) treats the row as offline, regardless of `online` flag drift. The existing `doctor_presence_changes` realtime channel propagates the UPDATE to all connected clients within ~1s.

No new GRANTs needed — function is `SECURITY DEFINER` owned by postgres, and `doctor_presence` already has the right grants.

### 2. Tighten freshness window
Change `STALE_MS` in `src/lib/presence-remote.ts` from `2 * 60 * 1000` to `60 * 1000` (60s). With a 25s heartbeat, a healthy doctor still has 2 heartbeats of slack; a disconnected one drops out at ~60s instead of ~120s.

Mirror the same threshold in `src/lib/admin.functions.ts` (line 597: `120_000` → `60_000`) so the admin dashboard "online now" badge matches the map.

### 3. No client code beyond the threshold change
Realtime UPDATE from the trigger already triggers a re-render through the existing `doctor_presence_changes` subscription. No new client wiring required.

## Verification
1. As admin, restrict a doctor who is currently online. Within ~1s, their marker disappears from the live map and their badge flips to "offline" on the admin dashboard.
2. Unrestrict, then have the doctor toggle Go Online (already blocked while restricted; succeeds after unrestrict). Confirm they reappear on the map within one heartbeat (~25s).
3. With an unrestricted doctor, kill the tab. Confirm they fade out of the pool at ~60s (not 120s).
4. Confirm End Shift / payment / rating remain functional on any active shift (no change to those paths).

## Out of scope
- Notifying the restricted doctor's device in real time ("you have been restricted") — separate work.
- Cancelling any in-flight shifts the restricted doctor is currently working — Priority 2 already decided in-flight shifts close cleanly.