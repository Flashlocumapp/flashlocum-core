# Root Cause: New Coverage Requests Not Reaching Doctors

## TL;DR
The recent settlement fix migration (`20260617132009_..._add_payment_account.sql`) added a new column `payment_account jsonb` to `coverage_requests`, but did **not** update the `list_open_coverage_requests` RPC that doctors rely on to see the open pool. The RPC is declared `RETURNS SETOF coverage_requests`, so Postgres now rejects every call with:

```
structure of query does not match function result type
```

This error is visible in the live console logs **right now**:
```
[coverage-remote] pool fetch error: structure of query does not match function result type
   at fetchAll (src/lib/coverage-remote.ts:203)
```

Result: every doctor's "Incoming Coverage" pool fetch fails silently. First, second, third — any new request — none of them appear. Yes, this was caused by the recent payment changes.

## Evidence

1. `coverage_requests` now has **50 columns** (the last being `payment_account`).
2. `pg_get_functiondef('list_open_coverage_requests')` shows its `RETURN QUERY SELECT` projects only **49 columns** (ends at `doctor_rating_at`). No `payment_account` column.
3. Because the function signature is `RETURNS SETOF coverage_requests` (the table's rowtype), Postgres validates column count + types at execution time and aborts with the exact error seen in the console.
4. Server-side this surfaces as a PostgREST RPC error; client-side it is swallowed by the non-fatal branch in `fetchAll` and the previous `lastPoolRows` (empty after a hard refresh) is reused.

## Flow Trace — where it breaks

1. Requester creates request → `RequesterHome.publish()` → `network.publishRequest()` → INSERT into `coverage_requests` ✅ (verified: rows are inserted; `status='searching'`, `broadcast_started_at=now()`).
2. `notifyCoverageChanged(id)` → `emitInvalidate` broadcasts on the `coverage_invalidations` channel ✅.
3. Each doctor's `coverage-remote.ts` invalidation listener fires → `scheduleRefresh()` → `refreshSnapshot()` → `fetchAll(userId)` ✅ runs.
4. **`fetchAll` (src/lib/coverage-remote.ts:317-366)** issues two queries in parallel:
   - `supabase.from('coverage_requests').select('*').or('requester_id.eq.<uid>,accepted_by.eq.<uid>')` — succeeds, but for a doctor it returns only rows they own/accepted; the open pool is **not** here by design (RLS hides it).
   - `supabase.rpc('list_open_coverage_requests')` — **fails** with the schema mismatch above. The code takes the non-fatal branch at line 343, logs the warning, and falls back to `lastPoolRows` (which is `[]` for a freshly loaded doctor session and never repopulates).
5. Merge step (`merged` map) therefore contains only the doctor's own rows. New `searching` rows from any requester are dropped.
6. `snapshotListeners` fire with a pool-less snapshot → `dispatch.ts` derives `incoming = []` → Doctor Incoming Coverage stays empty.

## Files & functions involved

- **`supabase` RPC `public.list_open_coverage_requests`** — broken; missing `payment_account` projection. Declared `RETURNS SETOF coverage_requests`, so any new column on the table breaks it until the function body is updated.
- **`src/lib/coverage-remote.ts`**
  - `fetchAll()` lines 317-366 — calls the failing RPC; non-fatal fallback hides the failure.
  - `lastPoolRows` line 315 — stays `[]` on a fresh session, so the fallback yields no incoming rows.
  - `refreshSnapshot()` / `scheduleRefresh()` lines 375-412 — keep running fine; they just keep producing empty pools.
  - Realtime + invalidation channels (lines 290-300, 424-442) — working; not the cause.
- **`src/features/cover/dispatch.ts`** — `useDispatch` derives `incoming` from the snapshot; nothing wrong here, it just receives an empty pool.
- **Recent migration `supabase/migrations/20260617132009_..._add_payment_account.sql`** — added `payment_account jsonb` to the table without updating the RPC; this is the proximate cause.

## Why earlier requests "sometimes" showed up
- A doctor who already had a populated `lastPoolRows` before the migration ran would temporarily keep showing those rows from cache (until process restart).
- A doctor who owns or accepted a row still sees it (own-row path doesn't touch the RPC).
- Anyone newly loading the app after the migration sees `incoming = []` for every requester.

## Settlement/payment side effects confirmed
Yes — the payment fixes directly caused this regression. The `ShiftSettlement` decoupling and `payment_reference` resumption work is unaffected; the damage is purely the schema/RPC drift introduced by the `payment_account` column migration.

## Suggested fix (not applied)
Re-issue `CREATE OR REPLACE FUNCTION public.list_open_coverage_requests()` with the projection extended to include `NULL::jsonb AS payment_account` (the open pool should never expose virtual-account details), keeping `RETURNS SETOF coverage_requests`. Optionally switch the signature to an explicit `RETURNS TABLE(...)` of just the safe columns to prevent this class of regression every time a column is added.

No code changes have been made — read-only audit as requested.
