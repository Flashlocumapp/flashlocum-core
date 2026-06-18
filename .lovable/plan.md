# Multi-day pause: persistent ledger + deterministic buttons

## Database migration

1. Add column `coverage_requests.first_started_at timestamptz` (nullable). Set once by `start_shift`, never cleared.
2. Rewrite `pause_shift` RPC:
   - Lock row + open segment.
   - `UPDATE shift_segments SET ended_at = now()` on the open segment.
   - `delta = now() - seg.started_at` (ms).
   - `UPDATE coverage_requests SET status='paused', started_at = NULL, accumulated_ms = accumulated_ms + delta` (under `app.lifecycle_bypass`).
3. Rewrite `resume_shift` RPC:
   - Insert next `shift_segments` row with `started_at = now()`.
   - `UPDATE coverage_requests SET status='active', started_at = now(), payment_due_at = NULL` (under bypass). `accumulated_ms` untouched.
4. Update `start_shift` RPC:
   - Same behaviour as today + `first_started_at = COALESCE(first_started_at, now())`.
   - Also write `accumulated_ms = 0` and `started_at = now()` on the first activation.
5. Update `end_shift` RPC:
   - If row is `active`, fold the final open segment into `accumulated_ms` (same delta formula) before computing the bill, then `started_at = NULL`.
   - Continue to settle from `shift_segments` for billing; `accumulated_ms` and the segment sum now agree.
6. Backfill `first_started_at` for existing rows where status ∈ (active, paused, awaiting_payment, completed) using `MIN(shift_segments.started_at)` (fallback `started_at`, fallback `updated_at`).

## Client mapping

`src/lib/coverage-remote.ts`
- Add `first_started_at: string | null` to `Row`.
- `rowToNet`: set `everStarted: !!r.first_started_at`.

`src/lib/network.ts`
- Add `everStarted?: boolean` to `NetRequest`.
- Remove the local accumulator fold in `pauseShift` — trust the snapshot. Keep the optimistic `status: 'paused'` patch but drop the manual `accumulatedMs` math.
- In `startRequest` success patch, set `everStarted: true` so the UI flips before the snapshot lands.
- Add an out-of-order guard in `applyRemoteEvent` and per-row in `onSnapshot`: ignore `ev.row` whose `updatedAt < existing.updatedAt` (or whose `rev < existing.rev`). Replace the wholesale `state.requests` replacement in `onSnapshot` with a per-row merge under the same guard.

## UI

`src/features/app/CoverageScreen.tsx`
- Extend `RequestItem` / `CoverItem` with `everStarted: boolean`.
- `toRequestItem` and the doctor-side mapper pass `everStarted: !!r.everStarted` through.
- Requester upcoming card (line 674): label = `item.everStarted ? "Resume Shift" : "Start Shift"`.
- Requester End Shift block (line 688): visible when `status === "active" || (status === "upcoming" && item.everStarted)`.
- Requester Edit / Cancel block (line 701): visible only when `status === "upcoming" && !item.everStarted`.
- Doctor card (line 844): same `everStarted` swap; gate End Shift on Upcoming the same way.

## Verification

1. Start → Pause: card moves to Upcoming with **Resume / End / Call**. Timer pill shows accumulated minutes. DB row: `accumulated_ms > 0`, `started_at = NULL`, `status = 'paused'`, `first_started_at` set.
2. Resume: status `active`, new segment row inserted, `started_at = now()`, `accumulated_ms` unchanged, timer continues from accumulated baseline.
3. Multiple pause/resume cycles: `accumulated_ms` grows monotonically; buttons stay **Resume / End / Call** on every pause; **Start Shift** never reappears.
4. Pause → End Shift: settlement runs once, billed total equals sum of segments (and equals `accumulated_ms` post-fold).
5. Doctor view mirrors requester within one snapshot cycle on each pause/resume; doctor timer stops on pause (status flips to upcoming).
6. Cold reload mid-pause (clear localStorage): correct buttons render from server snapshot alone.
7. Out-of-order replay: late `active` payload arriving after `pause` is ignored; UI stays paused.
