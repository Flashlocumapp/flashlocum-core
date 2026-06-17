Re-run the full coverage wipe across all users (in case new rows have appeared since the last clear).

**Delete in a single transaction:**
1. `public.ratings` — all rows
2. `public.shift_segments` — all rows
3. `public.payment_underpayments` — all rows
4. `public.coverage_requests` — all rows

**Not touched:** profiles, user_roles, doctor_presence, device_tokens, pricing tables, email infra, trust_blocks.

**Verify:** count all four tables = 0 after commit.

Cannot be undone.