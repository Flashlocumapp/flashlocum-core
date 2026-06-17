## Goal
Wipe all coverage shift data across all users — history, active, and upcoming. Destructive and irreversible.

## What gets deleted (in order, to satisfy FK constraints)

1. `public.ratings` — all rows (they reference `shift_id`)
2. `public.shift_segments` — all rows (they reference `request_id`)
3. `public.payment_underpayments` — all rows (they reference `request_id`)
4. `public.coverage_requests` — all rows

Run inside a single transaction so a failure rolls back cleanly.

## What is NOT touched

- `profiles`, `user_roles`, `doctor_presence`, `device_tokens`
- Pricing tables (`pricing_versions`, `pricing_flats`, `pricing_rates`, `pricing_modifiers`)
- Email infrastructure tables
- `trust_blocks`
- `profiles.trust_snapshot` — will recompute lazily on next read; not cleared

## Execution
Use the data-change (insert) tool with `DELETE` statements wrapped in a `BEGIN … COMMIT` block. Not a schema migration.

## Verification
After deletion, run a count on each affected table — all four should return 0. Hard-refresh the app and confirm Active, Upcoming, and History sections are empty for both requester and cover views.

## Warning
This cannot be undone. If anything is mid-flight (active shift, awaiting payment), it disappears with the rest.