# Doctor "Incoming Coverage" card missing — root cause and fix

## What I confirmed against the live DB

- A `searching` request was created at 04:30:45 (`06faed25-…`), still within
  the 180s broadcast window, `accepted_by` null.
- `list_open_coverage_requests`'s underlying SELECT (status='searching' AND
  accepted_by IS NULL AND broadcast_started_at > now()-180s) returns that row.
- The signed-in cover doctor (`d01894fb-…`, Dr. Momoh Victoria) is
  `verification_status = 'approved'` and `doctor_presence.online = true` with
  `last_seen` ~1 min ago — so the doctor-side gate
  `online && upcoming.length<3 && hasLiveSnapshot()` should pass.
- Doctors are intentionally hidden from `coverage_requests` postgres_changes
  for `status='searching'` rows (RLS strips the pool). The ONLY paths that
  surface a new request to a doctor are:
  1. The `coverage_invalidations` broadcast emitted from the requester's tab
     in `remoteInsertRequest` (`src/lib/coverage-remote.ts:740`).
  2. The 15 s polling safety net in `subscribeCoverageRemote`.

## Root cause

The realtime fan-out is entirely client-emitted. `emitInvalidate` calls
`invalidationChannel.send()` immediately after the insert resolves, but:

- If the requester's `invalidationChannel` hasn't reached the `SUBSCRIBED`
  state yet (cold mount, brief reconnect, throttled mobile network), the send
  is silently dropped — Supabase Realtime drops broadcasts queued before
  `SUBSCRIBED`.
- The 15 s poll then becomes the only fallback, which matches the symptom
  ("placed a request — card didn't appear").

There is no server-side guarantee that any other client learns about a new
`searching` row. The system is one missed broadcast away from a silent miss
every time.

## Fix — promote invalidation to a DB trigger

Add an `AFTER INSERT OR UPDATE` trigger on `public.coverage_requests` that
calls `realtime.send(...)` on the `coverage_invalidations` topic whenever the
row enters/stays in the pre-acceptance pool (`searching` / `paused`) OR exits
it (so other doctors drop a row that was just claimed). Payload mirrors what
`emitInvalidate` already sends: `{ id, at }`. Doctor client code is
unchanged — the existing `invalidationChannel` listener already calls
`scheduleRefresh()` on every `invalidate` event.

### Migration (new file)

```sql
-- Server-authoritative coverage_invalidations broadcast.
CREATE OR REPLACE FUNCTION public.coverage_requests_emit_invalidate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_id uuid := COALESCE(NEW.id, OLD.id);
  should_emit boolean := false;
BEGIN
  -- Emit on every relevant lifecycle change so doctors can reconcile the pool:
  --   * INSERT of a searching row (new offer)
  --   * paused/searching <-> any transition (resume, accept, cancel, expire)
  --   * material edits while still in the pool (rev bump handled elsewhere)
  IF TG_OP = 'INSERT' THEN
    should_emit := NEW.status IN ('searching','paused');
  ELSIF TG_OP = 'UPDATE' THEN
    should_emit :=
         OLD.status IS DISTINCT FROM NEW.status
      OR (NEW.status IN ('searching','paused')
          AND (OLD.broadcast_started_at IS DISTINCT FROM NEW.broadcast_started_at
               OR OLD.rev IS DISTINCT FROM NEW.rev))
      OR OLD.accepted_by IS DISTINCT FROM NEW.accepted_by;
  END IF;

  IF should_emit THEN
    PERFORM realtime.send(
      jsonb_build_object('id', row_id, 'at', (extract(epoch from now()) * 1000)::bigint),
      'invalidate',
      'coverage_invalidations',
      false  -- public (no auth filter); payload carries no PII
    );
  END IF;

  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS coverage_requests_emit_invalidate ON public.coverage_requests;
CREATE TRIGGER coverage_requests_emit_invalidate
AFTER INSERT OR UPDATE ON public.coverage_requests
FOR EACH ROW
EXECUTE FUNCTION public.coverage_requests_emit_invalidate();
```

### Why this is safe

- `realtime.send` is server-side; delivery does not depend on the requester's
  channel being `SUBSCRIBED` at insert time.
- The payload is just `{ id, at }` — same shape the client already emits, so
  no client changes are needed and no sensitive data leaves the DB.
- The doctor's existing listener calls `scheduleRefresh()` which then hits
  `list_open_coverage_requests` (RLS/security-definer still gates which rows
  the doctor actually receives).
- The client-side `emitInvalidate(...)` calls can stay as a belt-and-braces
  signal; they're idempotent because `scheduleRefresh` debounces to one
  RPC every 80 ms.

## Out of scope

- No UI changes, no changes to `dispatch.ts` / `network.ts` / `coverage-remote.ts`.
- No change to the 180s expiry, the 3-upcoming gate, or `hasLiveSnapshot`.
- Not touching RLS or the `list_open_coverage_requests` projection.

## Verification after apply

1. From the requester account, create a new coverage request.
2. On the doctor account (online, <3 upcoming), the "New incoming coverage
   request" card appears within ~1 s without waiting for the 15 s poll.
3. Accept on the doctor side; on a second doctor account, the card disappears
   on the next tick (driven by the same trigger firing on `accepted_by`
   change).
