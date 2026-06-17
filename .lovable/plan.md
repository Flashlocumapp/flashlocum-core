## Evidence from the audit so far

The chain currently breaks at the **doctor feed refresh RPC**:

```text
Requester creates request
  -> coverage_requests row exists
  -> trigger is installed to emit coverage_invalidations
  -> doctor client refreshes feed
  -> list_open_coverage_requests() fails with HTTP 400
  -> fetchAll() reuses empty lastPoolRows
  -> net.requests has no broadcasting pool row
  -> useDispatch().incoming stays null
  -> Incoming Coverage card never renders
```

Proven signals:
- The doctor tab is authenticated as the approved doctor (`d01894fb...`), not the requester.
- Browser network shows repeated calls to `rpc/list_open_coverage_requests` returning `400`.
- Response body: `Number of returned columns (41) does not match expected column count (49)`.
- Console logs show `[coverage-remote] pool fetch error: structure of query does not match function result type`.
- Database definition confirms `list_open_coverage_requests()` returns `SETOF coverage_requests` but selects only 41 columns.
- `coverage_requests` currently has 49 columns, so the function cannot return rows.
- UI render condition is not the root failure: `incoming` only needs `upcoming.length < 3`, `hasLiveSnapshot()`, a broadcasting request, not own request, and not declined. The broadcasting request never enters the snapshot because the RPC fails.

## Fix plan

1. **Repair the database RPC shape**
   - Replace `public.list_open_coverage_requests()` so its `RETURN QUERY` returns all 49 `coverage_requests` columns in exact table order.
   - Keep the approved-doctor gate.
   - Keep the 180-second broadcast window.
   - Keep sensitive fields redacted for doctors:
     - phone, note, accommodation
     - payment provider/reference/status/url
     - paid/remitted timestamps
     - billing/payment due/extension fields
     - pricing/rate snapshot
     - rating submission/score/timestamps

2. **Keep the realtime architecture unchanged**
   - Do not add fallback hacks.
   - Do not add duplicate polling.
   - Do not add optimistic/local incoming-card patches.
   - Keep the card server-derived through `list_open_coverage_requests()`.

3. **Verify every layer after migration**
   - Confirm a fresh requester-created row exists with `status='searching'`, `accepted_by is null`, and `broadcast_started_at` inside 180 seconds.
   - Confirm the trigger exists and is enabled for `coverage_requests_emit_invalidate`.
   - Confirm `coverage_requests` is in the realtime publication.
   - Confirm doctor session calls `list_open_coverage_requests()` and receives HTTP 200 with the open row.
   - Confirm `fetchAll()` can merge the pool row into the network snapshot.
   - Confirm `useDispatch()` can derive `incoming` from that row.
   - Confirm the Incoming Coverage card appears without refresh during a real requester + doctor test.

## Technical migration target

The replacement function will still return `SETOF public.coverage_requests`, but will include the missing columns:

```text
pricing_version_id
rate_snapshot
requester_rating_submitted
requester_rating_score
requester_rating_at
doctor_rating_submitted
doctor_rating_score
doctor_rating_at
```

Those will be returned as safe redacted/null/default values for the open doctor pool, matching the table's exact column count and types.