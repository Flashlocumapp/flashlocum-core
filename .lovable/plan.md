## Confirmation

### 1. Daily reconciliation cron + Monnify dashboard wiring — NOT DONE

Current state in the repo:
- `src/routes/api/public/monnify-disbursement-webhook.ts` exists (the webhook handler is in place).
- `src/routes/api/public/hooks/` contains only `outbox-drain.ts`, `shift-reminders.ts`, `surcharge-drain.ts`. **No `reconcile-settlements.ts`.**
- No `cron.schedule(...)` entry exists for disbursement reconciliation.
- No memory file documents the Monnify dashboard webhook URL.

So if Monnify ever drops a `SUCCESSFUL_DISBURSEMENT` callback (network blip, signature mismatch, dashboard not yet wired), nothing back-fills `remitted_at` — settlements would stay "pending" forever. This is the exact gap the plan flagged and it is still open.

### 2. Are toasts global, single-instance, non-duplicating? — PARTIALLY

What is correct:
- `pushToast` is a module-level pub/sub in `src/lib/notifications.ts`. Anyone can fire it from anywhere.
- `ToastHost` renders only the **latest** toast (`useLatestToast`), so two rapid toasts replace each other in the same slot — no stacking.
- Contract-routed toasts go through `feedback.ts` `ingest()`, which has a 6-second per-event-key ledger that drops duplicates (e.g. the same `offer.accepted` arriving from realtime + local emit).

What is **not** correct:
- `ToastHost` is mounted **only inside `src/routes/_app.tsx`** (the doctor/requester shell). It is **not** in `__root.tsx`, `_admin.tsx`, `/role`, `/auth/$role`, `/onboarding/$role`, `/reset-password`, or the legal pages. Any `pushToast` fired on those screens is silently dropped — so toasts are **not truly global**.
- Raw `pushToast` calls (admin screens, RequesterHome validation, ShiftSettlement rating errors, admin.unauthorized) have **no dedup**. If the same path fires twice within a render cycle, the second one just replaces the first visually (so the user sees one toast) — but there is no key-based suppression like the contract events have. In practice this is fine because each call site is single-shot, but it is not a formal "no duplication" guarantee.
- The admin pages call `pushToast` but there is no `ToastHost` under `_admin.tsx`, so admin toasts currently don't render at all. This is a real bug.

## Proposed remediation

### A. Make toasts truly global
1. Move `<ToastHost />` mount from `src/routes/_app.tsx` up into `src/routes/__root.tsx` (render once at the root, after `<Outlet />`). Remove the duplicate from `_app.tsx` to keep a single instance.
2. Verify the `--tab-bar-h` CSS var falls back to `0px` on routes without bottom tabs, so the toast sits above the safe-area inset on `/role`, `/auth`, `/onboarding`, admin pages.

### B. Add formal global dedup
3. Extend `pushToast` with an optional `key?: string` and a 4-second ledger inside `notifications.ts` that drops repeats of the same key. Engine-emitted toasts already pass a stable `eventKey`; thread it through as `key` so the ledger covers both contract and raw call sites.

### C. Daily reconciliation cron
4. Create `src/routes/api/public/hooks/reconcile-settlements.ts`:
   - Auth via `apikey` header (Supabase anon key).
   - Query `coverage_requests` where `payment_status='paid' AND remitted_at IS NULL AND paid_at < now() - interval '36h'`.
   - For each row, call the existing Monnify disbursement-status API (`src/lib/monnify/client.server.ts`) per `payment_reference`.
   - On `SUCCESS`, call the `mark_settlement_remitted` RPC and broadcast `coverage_invalidations`, mirroring the webhook handler.
   - Return `{ checked, remitted }` JSON.
5. Schedule via `pg_cron` (SQL, not migration — it carries the anon key):

   ```sql
   select cron.schedule(
     'reconcile-monnify-settlements-daily',
     '0 3 * * *',  -- 03:00 UTC daily
     $$
     select net.http_post(
       url:='https://flashlocum-core.lovable.app/api/public/hooks/reconcile-settlements',
       headers:='{"Content-Type":"application/json","apikey":"<ANON_KEY>"}'::jsonb,
       body:='{}'::jsonb
     );
     $$
   );
   ```

### D. Monnify dashboard wiring (documentation only)
6. Write `mem://features/monnify-settlement.md` recording the two webhook URLs to register in the Monnify dashboard:
   - Collection: `https://flashlocum-core.lovable.app/api/public/monnify-webhook`
   - Disbursement: `https://flashlocum-core.lovable.app/api/public/monnify-disbursement-webhook`
   The dashboard registration itself is a manual step in the Monnify console — there is no API for it from our side.

## Execution order
1. B (dedup) — pure addition to `notifications.ts`, no risk.
2. A (move ToastHost to root) — one mount move, one removal.
3. C (reconcile route) — new file + SQL via Supabase SQL tool.
4. D (memory doc).

Approve and I will switch to build mode and ship in that order.
