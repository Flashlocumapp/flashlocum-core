## Root cause

`list_open_coverage_requests()` returns `SETOF coverage_requests`. The 2026‑06‑18 multi‑day migration added `coverage_requests.first_started_at` but did not update this RPC, so the function's 50‑column SELECT no longer matches the table's 51‑column rowtype. Every call now errors out. That RPC is the doctors' only window into the open `searching` pool (RLS hides it from direct selects and from `postgres_changes`), so Incoming Coverage stays empty for every online doctor even though the invalidate broadcast and 15 s poll both fire correctly.

## Fix

Single migration: `CREATE OR REPLACE FUNCTION public.list_open_coverage_requests()` with the existing body plus `cr.first_started_at` appended to the SELECT list (last column, matching the table's column order). Re-`GRANT EXECUTE ... TO authenticated`. No client changes — the existing RPC consumer already maps whatever rows come back.

## Verification

1. `select * from public.list_open_coverage_requests() limit 1;` as an approved, online doctor returns rows instead of a structure-mismatch error.
2. Requester creates a new shift; an online doctor sees it in Incoming Coverage within the invalidate broadcast (≤1 s) and at worst within the 15 s poll.
3. Console no longer logs `[coverage-remote] pool fetch error`.
4. Pause/resume/end multi-day flows still behave as fixed in the prior round (unaffected by this change).