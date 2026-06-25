---
name: Canonical notification event catalog
description: Locked event kinds used by feedback.ts / notify.server.ts / push payloads. Provider-agnostic — OneSignal templates and tags MUST key off these names.
type: constraint
---

# Canonical notification events

These `kind` strings are the contract between business events, the feedback
engine (`src/lib/feedback.ts`), the server dispatcher (`src/lib/notify.server.ts`),
and any future push provider (OneSignal, etc.). Do NOT rename or repurpose
them — segments, templates, dedup keys, and the notification outbox all key
off these exact strings.

Envelope (every event carries): `{ kind, entityId, version, occurredAt, audience }`.

| kind                          | audience           | trigger                                            | entityId                |
|-------------------------------|--------------------|----------------------------------------------------|-------------------------|
| `offer.new`                   | doctor             | DB trigger on `coverage_requests` insert (open)    | `coverage_requests.id`  |
| `shift.accepted`              | requester          | server fn `acceptCoverageFn`                       | `coverage_requests.id`  |
| `shift.started`               | requester          | server fn `start_shift` wrapper                    | `coverage_requests.id`  |
| `shift.paused`                | requester          | server fn `pause_shift` wrapper                    | `coverage_requests.id`  |
| `shift.resumed`               | requester          | server fn `resume_shift` wrapper                   | `coverage_requests.id`  |
| `shift.ended`                 | requester          | server fn `end_shift` wrapper                      | `coverage_requests.id`  |
| `shift.cancelled`             | doctor + requester | server fn `cancelAndNotifyFn`                      | `coverage_requests.id`  |
| `payment.completed`           | doctor + requester | Monnify collection webhook                         | `coverage_requests.id`  |
| `payment.disbursed`           | doctor             | Monnify disbursement webhook + reconcile cron      | `coverage_requests.id`  |
| `rating.submitted`            | doctor / requester | server fn `submitRatingFn`                         | `coverage_requests.id`  |
| `reminder.shift_starting`     | doctor             | `shift-reminders` cron (≤15 min to scheduled start)| `coverage_requests.id`  |
| `reminder.shift_ending`       | doctor + requester | `shift-reminders` cron (≤15 min to scheduled end)  | `coverage_requests.id`  |
| `reminder.payment_due`        | requester          | `surcharge-drain` cron + settlement watchdog       | `coverage_requests.id`  |
| `verification.approved`       | doctor             | admin fn `approveVerification`                     | `auth.users.id`         |
| `verification.rejected`       | doctor             | admin fn `rejectVerification`                      | `auth.users.id`         |

## Rules

- The server is the source of truth — UI never emits a canonical event;
  emissions originate from DB triggers, server functions, or webhooks.
- `version` is monotonic per `(kind, entityId)` and is usually the row's
  `updated_at` in ms. The client engine uses it for the 6 s dedup window.
- `audience` selects the recipient role and is also used as an OneSignal /
  segment tag when we swap providers — never overload it for filters.
- `payload.data` is free-form string map for adapter extras and MUST stay
  flat (push providers reject nested objects).
- Adding a new kind requires:
  1) updating this table,
  2) wiring the emitter through `feedback.ts` (client) or `notify.server.ts`
     (server) — not direct `pushToast` / direct FCM,
  3) confirming idempotency via the outbox `(user_id, kind, entity_id, version)`
     uniqueness constraint.

## High-priority kinds

`offer.new` and `shift.cancelled` are the only kinds that send with
HIGH push priority + branded chime (see `push.server.ts`). Keep this list
small — overusing HIGH erodes user trust.
