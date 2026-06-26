## Findings

- Requester Home already passes online doctor markers into `GoogleMapBackground`.
- The database currently has online, approved doctors with valid GPS coordinates, so the data exists.
- Root cause: `list_online_approved_doctors()` exists, but its execute permission is missing; the requester-side initial presence fetch fails with `permission denied for function list_online_approved_doctors`.
- Secondary issue: realtime can recover some updates, but if the initial RPC fails, requesters may see no icons until a later presence update arrives.

## Fix plan

1. **Database permission fix**
   - Add a migration that grants execution of `public.list_online_approved_doctors()` to authenticated users only.
   - Keep anonymous users blocked.
   - Preserve the function’s current filtering: online + approved + unrestricted doctors only.

2. **Client resilience**
   - Update `src/lib/presence-remote.ts` so if the initial presence RPC fails, it schedules a short retry instead of waiting up to the 60-second watchdog.
   - Keep realtime as the primary instant-update path.

3. **Validation**
   - Verify `list_online_approved_doctors()` returns the current online approved doctor rows.
   - Confirm Requester Home marker input is populated and map markers render from those rows.

## Expected result

Requesters immediately see visible doctor icons for online, approved, unrestricted doctors with GPS coordinates, without changing broadcast eligibility or exposing profile details.