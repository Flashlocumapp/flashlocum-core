## Realtime Visibility Fix — `coverage_requests` Publication Repair

### Root cause (recap)
The v3 pricing migration added columns (`rate_snapshot`, `pricing_version_id`, etc.) to `public.coverage_requests`, but the `supabase_realtime` publication was created with an explicit column allow-list that does not include them. Postgres now rejects every write with:

> cannot update table "coverage_requests" — Column list used by the publication does not cover the replica identity.

Result: INSERTs from "Find Cover" and all state-transition UPDATEs fail at the DB layer, so the doctor-side realtime broadcast never fires. This is a backend/replication issue, not a frontend or RLS bug.

### Fix scope
One migration, no rollback, no app code changes.

1. **Drop the column allow-list** on `coverage_requests` in `supabase_realtime`:
   - `ALTER PUBLICATION supabase_realtime DROP TABLE public.coverage_requests;`
   - `ALTER PUBLICATION supabase_realtime ADD TABLE public.coverage_requests;` (no column list → publishes all columns, future-proof against new columns).
2. **Normalize replica identity** so realtime payloads carry full row data:
   - `ALTER TABLE public.coverage_requests REPLICA IDENTITY FULL;`
3. **Sanity-sweep sibling tables** touched by v3 (`shift_segments`, `pricing_versions`) — re-add to publication without column lists and set `REPLICA IDENTITY FULL` only if they are currently in the publication with a stale list. Skip otherwise.
4. **Unblock the queue**: run `SELECT public.expire_stale_searching_requests();` once after the migration so any stuck "searching" rows that failed to update during the outage get reconciled.

### Verification
- `supabase--read_query` against `pg_publication_tables` to confirm no `attnames` filter remains on `coverage_requests`.
- Read recent Postgres logs to confirm the "Column list" error has stopped.
- Manual end-to-end check via Playwright: create a request as a requester, confirm the row lands and an online doctor's dashboard receives the invalidation broadcast within seconds.

### Acceptance
- New `coverage_requests` INSERT succeeds.
- `pause_shift` / `resume_shift` / `end_shift` UPDATEs succeed.
- Online doctors see new incoming request cards without refresh.
- No new "Column list used by the publication…" errors in logs.

### Out of scope
- No changes to frontend subscription code (already correct).
- No changes to RLS, pricing logic, or v3 schema.
- No changes to doctor presence system.
