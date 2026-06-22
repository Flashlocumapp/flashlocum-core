---
name: Monnify settlement webhooks
description: Webhook URLs to register in the Monnify dashboard and the cron backstop that reconciles missed disbursements
type: feature
---

## Webhook URLs (register in Monnify Dashboard → Settings → API Keys & Webhooks)

- **Collection (payment received)**:
  `https://flashlocum-core.lovable.app/api/public/monnify-webhook`
- **Disbursement (funds remitted to doctor's bank)**:
  `https://flashlocum-core.lovable.app/api/public/monnify-disbursement-webhook`

Both verify the `monnify-signature` header (HMAC-SHA512 over the raw body
using `MONNIFY_SECRET_KEY`). The disbursement handler is idempotent — it
calls `mark_settlement_remitted(_payment_reference, _amount)` and short-
circuits if the row is already remitted.

## Reconciliation cron (backstop)

If Monnify drops a SUCCESSFUL_DISBURSEMENT callback, a pg_cron job named
`reconcile-monnify-settlements-daily` runs every day at 03:00 UTC and
calls `POST /api/public/hooks/reconcile-settlements`. The route:

1. Selects `coverage_requests` where `payment_status='paid'`,
   `remitted_at IS NULL`, and `paid_at < now() - interval '36h'`.
2. Asks Monnify `/api/v2/disbursements/single/summary?reference=…` per row.
3. On SUCCESS, calls `mark_settlement_remitted`, broadcasts
   `coverage_invalidations`, and sends the doctor a remittance push.

Auth is via the `apikey` header (Supabase publishable/anon key).

To re-schedule or change the time, update the row in `cron.job` via SQL —
do NOT add this as a migration (the SQL embeds the anon key).
