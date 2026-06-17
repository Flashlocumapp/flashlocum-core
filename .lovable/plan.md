## Clear all coverage data

Wipe active, upcoming, and history coverage for every doctor and requester.

### What gets cleared
- All rows in `coverage_requests` (covers searching/assigned/in-progress/completed/cancelled — i.e. incoming, active, upcoming, and history feeds)
- All rows in `shift_segments` (per-shift time tracking tied to coverage)
- All rows in `ratings` (post-shift ratings have no parent shift after wipe)
- All rows in `payment_underpayments` (settlement records tied to cleared shifts)

### What is preserved
- `profiles`, `user_roles`, `doctor_presence`, `device_tokens`
- Pricing tables, trust blocks, email/auth tables
- Auth users

### Technical details
Single data-mutation call via the insert tool:
```sql
DELETE FROM public.ratings;
DELETE FROM public.payment_underpayments;
DELETE FROM public.shift_segments;
DELETE FROM public.coverage_requests;
```
Clients will refresh on next realtime invalidation / poll (~15s) and show empty Incoming, Active, Upcoming, and History tabs.
