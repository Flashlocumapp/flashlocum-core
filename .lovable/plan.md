# Audit Findings & Remediation Plan (revised)

## Issue 1 — Incoming coverage card not showing on the doctor side (ROOT CAUSE FOUND)

**This matches the prior incident pattern exactly: a schema change without an RPC update.**

### Evidence from the live query path

Queried the production DB directly:

1. `public.coverage_requests` currently has **58 columns** (verified via `information_schema.columns`). The last three columns were added by migration `20260624090708_7f896327...sql` (the post-acceptance cancellation reason work):
   - `cancellation_reason_code` (ord. 56)
   - `cancellation_reason_text` (ord. 57)
   - `cancelled_at` (ord. 58)

2. `public.list_open_coverage_requests()` is declared `RETURNS SETOF coverage_requests` and its `SELECT` projects **55 columns**, ending at `surcharge_capped_at` (ord. 55). The function body has not been regenerated since the cancellation columns were added.

```text
table coverage_requests  : 58 columns
list_open_coverage_requests SELECT list : 55 columns   ← missing the last 3
RETURNS SETOF coverage_requests          ← row-type validated at runtime
```

3. PostgreSQL validates the composite row shape against `SETOF coverage_requests` **on first row return**, not at `CREATE FUNCTION` time. That is why the migration succeeded silently. The function also has three guard clauses that `RETURN;` empty (not approved doctor / not online / restricted), so when a doctor is gated off the function returns 0 rows and never trips the validator. The first time the function actually tries to return a real `searching` row to an eligible doctor, PostgREST gets:

```
ERROR: 42804  structure of query does not match function result type
DETAIL: Number of returned columns (55) does not match expected column count (58)
```

…which the client surfaces as the `[coverage-remote] pool fetch error` warning, then falls back to `lastPoolRows` (empty on a fresh load) → the Incoming card never appears.

4. No other DB function returns `SETOF coverage_requests` (`pg_proc` confirmed), so this is the only stale projection.

### Why prior diagnoses missed it

The realtime / presence work is correct in isolation: the `coverage_invalidations` broadcast fires on INSERT, the doctor receives it, and `coverage-remote` calls `list_open_coverage_requests()`. The RPC itself is what's broken — every eligibility check passes, the SELECT runs, and Postgres rejects the result shape on the way out. Nothing in the realtime path is at fault for #1.

### Fix

Migration that recreates `public.list_open_coverage_requests()` with the three trailing columns appended in declared order:

```sql
CREATE OR REPLACE FUNCTION public.list_open_coverage_requests()
RETURNS SETOF public.coverage_requests
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.current_user_is_approved_doctor() THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.doctor_presence dp
                 WHERE dp.user_id = auth.uid() AND dp.online = true) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p
             WHERE p.id = auth.uid() AND p.account_restricted_at IS NOT NULL) THEN RETURN; END IF;

  RETURN QUERY
    SELECT
      cr.id, cr.requester_id, cr.hospital, cr.area, cr.coverage_type, cr.day,
      cr.start_time, cr.end_time, cr.start_ts, cr.end_ts, cr.duration_hrs,
      cr.amount, cr.fee_pct,
      ''::text AS phone, NULL::text AS note, NULL::text AS accommodation,
      cr.status, cr.accepted_by, cr.started_at, cr.accumulated_ms,
      NULL::integer AS settled_amount, cr.days, cr.day_index, cr.cancelled_by,
      cr.created_at, cr.updated_at,
      NULL::text AS payment_provider, NULL::text AS payment_reference,
      NULL::text AS payment_status, NULL::text AS payment_url,
      NULL::timestamptz AS paid_at, NULL::timestamptz AS remitted_at,
      cr.environment, NULL::timestamptz AS payment_due_at,
      cr.payment_extension_count, NULL::timestamptz AS last_extended_at,
      NULL::numeric AS total_billed_amount, NULL::timestamptz AS billing_locked_at,
      cr.rev, cr.broadcast_started_at, cr.expired_at,
      NULL::uuid AS pricing_version_id, NULL::jsonb AS rate_snapshot,
      false AS requester_rating_submitted, NULL::smallint AS requester_rating_score,
      NULL::timestamptz AS requester_rating_at,
      false AS doctor_rating_submitted, NULL::smallint AS doctor_rating_score,
      NULL::timestamptz AS doctor_rating_at,
      NULL::jsonb AS payment_account, cr.first_started_at,
      NULL::timestamptz AS reminder_sent_at,
      NULL::numeric AS base_amount, NULL::numeric AS surcharge_amount,
      NULL::timestamptz AS surcharge_capped_at,
      NULL::text AS cancellation_reason_code,       -- NEW
      NULL::text AS cancellation_reason_text,       -- NEW
      NULL::timestamptz AS cancelled_at             -- NEW
    FROM public.coverage_requests cr
    WHERE cr.status = 'searching'::coverage_request_status
      AND cr.accepted_by IS NULL
      AND cr.broadcast_started_at > now() - interval '180 seconds'
    ORDER BY cr.broadcast_started_at DESC
    LIMIT 500;
END
$$;

REVOKE ALL ON FUNCTION public.list_open_coverage_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_open_coverage_requests() TO authenticated, service_role;
```

The three new columns are projected as `NULL` because doctor clients never need a requester's cancellation reason for a row they haven't even claimed; this preserves the PII-stripping intent of the original RPC.

### Other filters audited (no issues found)

- **Status enum**: `coverage_request_status` still contains `'searching'`; INSERTs from the requester set it to `'searching'` (verified in `coverage-remote.ts` create path).
- **broadcast_started_at**: trigger `coverage_requests_emit_invalidate` and the requester create path both set this; 180s TTL is intentional.
- **accepted_by IS NULL**: correct for the open pool.
- **Approval / restriction / presence guards** (`current_user_is_approved_doctor`, `account_restricted_at`, `doctor_presence.online`): unchanged since 20260619; not the regression.
- **RLS**: doctors are intentionally blocked from a direct `SELECT` on `searching` rows; access is through the SECURITY DEFINER RPC above. Once the RPC returns data, the rest of the client path works.
- **Realtime publication**: `coverage_requests` is NOT in `supabase_realtime` (by design); discovery is via the `coverage_invalidations` broadcast, whose policy was restored by migration `20260624071434`.

### Long-term hardening (added to plan)

A `SETOF <table>` function is a hidden coupling: any future `ALTER TABLE ... ADD COLUMN` silently breaks it. Two options to pick from after this fix lands:

1. **Switch the return type to an explicit composite type** (`RETURNS TABLE(...)`) so future column additions don't affect the contract. Lowest risk going forward.
2. **Add a CI/test step** that calls every `SETOF <table>` function in a smoke test post-migration, so a column-count drift fails the migration deploy, not production.

Both are non-blocking; I'd recommend Option 1 in a follow-up PR.

---

## Issue 2 — Doctor online/offline icon takes ~1 min on requester side (unchanged)

Root cause: `doctor_presence` SELECT policy from `20260621032917` restricts requesters to presence rows for already-assigned doctors, so realtime `postgres_changes` is filtered out and only the 60s `list_online_approved_doctors` RPC reconcile updates the dot.

Fix: migration adding an `OR (online = true AND doctor is approved cover)` clause to the SELECT policy. Same scope as the existing SECURITY DEFINER RPC already returns to every authenticated client — no new PII surface, just realtime parity.

(SQL in the original plan body; carried over unchanged.)

---

## Issue 3 — Clean-clone build failure (unchanged)

Top-level `import { createHmac, timingSafeEqual } from "crypto"` in `src/routes/api/public/monnify-webhook.ts` and `src/routes/api/public/monnify-disbursement-webhook.ts` leaks into the client bundle (route files cannot use the `.server.ts` suffix). `src/lib/push.server.ts` is correctly named and unaffected.

Fix: create `src/routes/api/public/_monnify-signature.server.ts` with the `verifyMonnifySignature(signature, rawBody)` helper, drop the top-level `crypto` import from both webhook route files, and `await import("./_monnify-signature.server")` inside the POST handler. Webhook semantics, signature scheme, idempotency, and notification side-effects unchanged.

Full grep of `src/` confirms no other top-level Node-only imports in client-reachable files.

---

## Files touched

- **New migration**: `supabase/migrations/<ts>_fix_list_open_coverage_requests_row_shape.sql` — recreate the RPC with the 3 missing columns (Issue 1).
- **New migration**: `supabase/migrations/<ts>_restore_presence_live_visibility.sql` — relax `doctor_presence` SELECT policy (Issue 2).
- **New**: `src/routes/api/public/_monnify-signature.server.ts` (Issue 3).
- **Edit**: `src/routes/api/public/monnify-webhook.ts` — dynamic import the helper (Issue 3).
- **Edit**: `src/routes/api/public/monnify-disbursement-webhook.ts` — same (Issue 3).
- **No change**: `src/lib/push.server.ts`, `src/lib/coverage-remote.ts`, `src/features/cover/dispatch.ts`.

## Verification

1. `bun install && bun run build` succeeds on a clean clone.
2. After Issue 1 migration: from an approved + online + non-restricted doctor session, `select * from list_open_coverage_requests()` returns the live `searching` rows (currently 0; create one to verify end-to-end).
3. Requester creates a request → doctor sees the Incoming card within ~1s (broadcast invalidation + working RPC).
4. Doctor toggles Online → requester sees the dot within ~1s (presence policy fix).
5. Monnify test webhook with valid signature → 200; tampered → 401; disbursement webhook still marks settlement remitted and pushes the doctor.
