## Clear All Coverage Data (All Users)

### Scope
Wipe every coverage request and its dependent rows from the database. Affects all users (requesters and doctors), all environments (live + test rows), and every status — active, paused, searching, accepted, completed, cancelled, expired, no_show.

### What gets deleted
1. **`shift_segments`** — every row (FK child of `coverage_requests`).
2. **`payment_surcharge_log`** — every row (per-request surcharge history).
3. **`payment_underpayments`** — every row (per-request underpayment records).
4. **`ratings`** — every row tied to a shift.
5. **`admin_payment_actions`** — left intact (audit trail; not coverage data). *Confirm if you also want these wiped.*
6. **`coverage_requests`** — every row.
7. **`profiles.payment_flagged_at` / `payment_flagged_reason`** — cleared (since the underlying overdue shifts are gone). `account_restricted_at` and `payment_restricted_at` are **left alone** (those are admin-imposed sanctions, not auto-derived from shift data).
8. **`trust_blocks`** — left intact unless you say otherwise (these are admin/abuse blocks, not shift records).

### What is NOT touched
- User accounts, profiles, roles, verification status, doctor presence.
- Pricing versions, rates, modifiers.
- Email logs / device tokens / notification outbox.

### Execution
One `DELETE` migration in the correct FK order, followed by the profile flag reset. No schema changes.

### Reversibility
**This is destructive and permanent.** There is no soft-delete or backup snapshot taken as part of this operation.

### Confirm before I proceed
- Wipe **all environments** (both `live` and `test` rows)? Default: yes, all.
- Also clear `admin_payment_actions` audit log? Default: **no, keep it**.
- Also clear `trust_blocks`? Default: **no, keep it**.
