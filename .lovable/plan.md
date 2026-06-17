## Root cause (proven)

Active/Upcoming shows shifts you closed days ago because the lifecycle migration's backfill silently flipped historical `completed`-but-unpaid rows into `awaiting_payment`. The dispatch + CoverageScreen filters then correctly route `awaiting_payment` into the Active (requester) and Upcoming (doctor) lanes. RLS, snapshot merge, cache, realtime, and optimistic state are all clean.

### DB evidence

All `awaiting_payment` rows in the system right now:

| metric | value |
|---|---|
| total rows | 5 |
| with `billing_locked_at` | 5 |
| with `billing_locked_at IS NULL` | 0 |
| min `updated_at` | `2026-06-17 08:45:05.053336+00` |
| max `updated_at` | `2026-06-17 08:45:05.053336+00` |

All five rows share an **identical microsecond `updated_at`** = the moment migration `20260617084506_…sql` ran. They were rewritten by a single SQL `UPDATE`. No real `end_shift()` call has produced an `awaiting_payment` row today — the only shift you ended (`9b1ef578…`) is still `status='active'` because the End Shift button wasn't wired to the server when you ran the test.

Row identities (all owned by `requester_id=ce06e7f8…`, `accepted_by=d01894fb…`):
`67b51afc-f7aa-4eb5-a0ad-1ca4207b2ad8`, `1b932a9c-94e4-4ffa-8358-6d601f0d827a`, `e82a1560-f213-479a-887c-28ad1d6e3e8d`, `cfd06d74-27cf-4237-9c17-7de6d1e348f3`, `269b38b6-e400-4975-a3c7-6b0c7f37528c`.

### Classification

- RLS bug? No.
- Backend query bug? No.
- Cache bug? No.
- Realtime merge bug? No.
- Optimistic state bug? No.
- **Data bug** caused by an over-broad backfill in the lifecycle migration.

## Fix plan (data-only, one statement)

No code or schema changes. The new lifecycle rule is correct going forward.

### Step 1 — Re-verify the backfill set (read-only)

```sql
SELECT id, requester_id, accepted_by, created_at, updated_at, payment_status, billing_locked_at
  FROM public.coverage_requests
 WHERE status = 'awaiting_payment'
   AND updated_at = '2026-06-17 08:45:05.053336+00';
```

Expect 5 rows, all owned by the same requester/doctor pair shown above.

### Step 2 — Revert the backfill

Run via the data tool:

```sql
UPDATE public.coverage_requests
   SET status = 'completed'
 WHERE status = 'awaiting_payment'
   AND updated_at = '2026-06-17 08:45:05.053336+00';
```

Discriminator rationale: that microsecond stamp is the migration's signature. Any genuine `awaiting_payment` row produced by `end_shift()` after this audit will carry a different `updated_at`, so this surgical filter cannot touch real in-flight shifts.

### Step 3 — Verify zero unintended rows remain

```sql
SELECT id, status, billing_locked_at, payment_status, updated_at
  FROM public.coverage_requests
 WHERE status = 'awaiting_payment'
 ORDER BY updated_at DESC;
```

Pass criteria:
- Either 0 rows, or only rows whose `updated_at` postdates this audit (i.e. real new End Shift flows).
- Active tab (requester) and Upcoming tab (doctor) drop the resurrected historical shifts on next snapshot refresh.

### Out of scope (deliberately)

- No change to `end_shift()`, `mark_settlement_paid()`, or the `coverage_request_status` enum.
- No change to `dispatch.ts` or `CoverageScreen.tsx` filters — they correctly route `awaiting_payment` and were not the cause.
- No change to RLS or to rows where `billing_locked_at IS NOT NULL` *outside* the backfill batch — the filter is keyed on the migration's `updated_at` fingerprint, not on the lock column.