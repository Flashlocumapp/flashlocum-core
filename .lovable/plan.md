## Root cause

`resume_shift` rejects an invalid enum literal before it even evaluates the row:

```sql
IF r.status NOT IN ('paused','upcoming') THEN ...
```

`r.status` is typed `coverage_request_status`, so Postgres coerces every literal in the `IN` list to that enum. The enum values are:

`searching, accepted, active, paused, completed, cancelled, expired, no_show, awaiting_payment`

There is no `upcoming` — it's a UI-only label (the client maps `accepted` / between-day `paused` rows to the "Upcoming" tab). The cast fails immediately with:

> invalid input value for enum coverage_request_status: "upcoming"

So **every** Resume Shift click on a multi-day shift errors out, regardless of the row's real status.

## Fix

Single migration replacing the `resume_shift` guard with valid enum values.

Multi-day Resume is only reachable from a between-day `paused` row (set by `pause_shift` and `_auto_advance_day_boundary`). `accepted` shifts use **Start Shift**, not Resume. So the correct guard is:

```sql
IF r.status <> 'paused' THEN
  RAISE EXCEPTION 'Shift cannot be resumed from %', r.status;
END IF;
```

Everything else in `resume_shift` (straight-product block, segment insert, status flip to `active`, lifecycle bypass) stays unchanged.

## Verification

1. After migration, click Resume on a paused multi-day shift → status flips to `active`, new `shift_segments` row inserted, no enum error.
2. Confirm Start Shift on an `accepted` row still works (different code path — `start_request`).
3. Confirm straight 24h/48h still rejected with `straight_no_pause`.

## Out of scope

No client changes — the UI's `"upcoming"` label is intentional and stays.
