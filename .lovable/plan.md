## Findings
- A new live request exists in the backend and is still `searching` inside the 180-second broadcast window.
- The approved doctor is online in backend presence.
- The doctor card is currently gated by a separate local `online` value (`net.doctors[sid]`) and a live snapshot flag. If local presence/auth/session hydration lags or mismatches, the server-returned open request can be hidden even though the backend says the doctor is eligible.
- The open request feed itself is already server-authoritative through `list_open_coverage_requests`; the risky part is the extra local visibility gate.

## Plan
1. Keep accept/decline/assignment state strictly server-derived.
   - Do not add optimistic accept/decline/assignment rendering.
   - Keep the incoming card source as `list_open_coverage_requests` snapshot rows only.

2. Patch the doctor incoming-card derivation.
   - Treat `hasLiveSnapshot()` + server-returned broadcasting rows as the authority for whether an incoming request exists.
   - Remove the local `online` dependency from hiding the incoming card after the server has already returned eligible open requests for the doctor.
   - Keep capacity and per-doctor declined-revision checks.

3. Make the subscription refresh path robust.
   - Ensure the invalidation broadcast always triggers a server refresh and component rerender.
   - Avoid relying on direct open-pool realtime row delivery, since those rows are intentionally fetched through the safe RPC.

4. Add lightweight diagnostics only if needed.
   - Add temporary, non-sensitive console warnings only around snapshot/eligibility failures if the issue remains after the patch.

5. Validate.
   - Confirm a current `searching` request appears in the doctor-side snapshot.
   - Confirm the card renders from the server snapshot.
   - Confirm accept still waits for server confirmation before showing the accepted state.