Findings from the live audit:

- The latest request exists and is still open: `coverage_requests.id = 367bdb11-ad52-4338-89f5-cf3b8ebdb060`, `status = searching`, `accepted_by = null`, and still inside the 180s broadcast window.
- The database trigger `coverage_requests_emit_invalidate` is installed and enabled.
- `coverage_requests` is in the realtime publication.
- The current preview session that called `list_open_coverage_requests` is authenticated as the requester user `ce06e7f8...`, not the approved doctor `d01894fb...`; that RPC correctly returned `[]` for the requester.
- The approved doctor `d01894fb...` is present, approved, and online in `doctor_presence`.

Plan:

1. Verify the doctor-side session path
   - Use the browser/network signal after switching to the doctor account or doctor browser context.
   - Confirm that `list_open_coverage_requests` is called with the approved doctor token and returns the open request.

2. If the doctor RPC returns the request but the card still does not render, fix only the client derivation gate
   - Keep accept/decline/assignment fully server-authoritative.
   - Do not add optimistic request removal or optimistic accept/decline state.
   - Inspect `src/features/cover/dispatch.ts` and `src/lib/network.ts` for a stale local online/session-id mismatch.
   - Patch the minimal state-listener/bump path so the incoming card derives from the server snapshot already held in `net.requests`.

3. If the doctor RPC returns `[]`, fix only the backend eligibility/RPC path
   - Keep `list_open_coverage_requests` as the single server source for the open pool.
   - Adjust the RPC or permission gate so approved online doctors receive open `searching` rows while requesters still receive none.
   - Do not expose sensitive requester fields; keep the existing stripped-column shape.

4. Validate
   - Create or use a live open request.
   - Confirm the doctor-side RPC returns the row.
   - Confirm the incoming card appears from server query/subscription results only.
   - Confirm no optimistic accept/decline/assignment state is introduced.