# Project Memory

## Core
- Broadcast model is intentional: every online Lagos doctor sees every new request. Do NOT redesign into targeted delivery.
- Contract notifications (lifecycle, payment, rating, reminder, request, shift, verification) MUST route through `feedback.ts` `ingest()`. Direct `pushToast` is only for operational/admin toasts.
- `<ToastHost />` lives in `src/routes/__root.tsx` (global, fixed position). Do not mount additional instances in sub-layouts.
- `pushToast({ key })` dedups within 4 s; engine passes the `ledgerKey` automatically.
- FlashLocum service area is Lagos State only. Use `LAGOS_BOUNDS` + `administrative_area_level_1 === "Lagos"` filter for all place results.

## Memories
- [Notification contract](mem://constraints/notification-contract.md) — contract vs operational toasts, foreground push suppression, payment-complete rule
- [Notification event catalog](mem://constraints/notification-events.md) — locked canonical `kind` strings; OneSignal / future providers MUST key off these names. Server emits via `notify.server.ts`; client ingests via `feedback.ts`.
- [Monnify settlement](mem://features/monnify-settlement.md) — collection + disbursement webhook URLs, daily reconciliation cron
