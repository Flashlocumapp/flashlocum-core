## Clean-slate data wipe

Wipe operational data + profiles/roles. Keep `auth.users` so you can sign in with existing credentials, but everyone (including you) re-onboards from scratch. Pricing is preserved.

### What gets deleted

- `ratings`
- `shift_segments`
- `payment_underpayments`
- `coverage_requests`
- `doctor_presence`
- `device_tokens`
- `email_send_log`, `email_send_state`, `suppressed_emails`, `email_unsubscribe_tokens`
- `trust_blocks`
- `user_roles` (all rows — including admin)
- `profiles` (all rows)

### What is preserved

- `auth.users` (your login still works)
- `pricing_versions`, `pricing_rates`, `pricing_flats`, `pricing_modifiers`
- All schema, RLS, functions, triggers

### After the wipe

1. Sign in with your existing email — `handle_new_user` already auto-creates a fresh blank `profiles` row on next sign-in (or you re-register).
2. Complete onboarding for whichever role(s) you want.
3. Ping me with your user id (or email) and I'll grant `admin` in `user_roles`.

### Execution

One `DELETE` migration in dependency order (children before parents). No schema changes.

### Confirm before I run

This is irreversible. Reply "go" and I'll execute.
