# Clear all coverage (history, active, upcoming)

Full wipe across all users, same as previous runs. Irreversible.

## Tables cleared (all rows)

1. `public.ratings`
2. `public.shift_segments`
3. `public.payment_underpayments`
4. `public.coverage_requests`

Run in one `BEGIN ... COMMIT` transaction, in that order, to respect FK references back to `coverage_requests`.

## Not touched

`profiles`, `user_roles`, `doctor_presence`, `device_tokens`, pricing tables, email infra, `trust_blocks`.

## Verification

After commit, `SELECT count(*)` on all four tables — expect 0 each. History, Active, and Upcoming tabs in the app will be empty.
