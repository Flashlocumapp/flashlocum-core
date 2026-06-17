
# FlashLocum — Pre-Acceptance Fixes (Final Plan, v3)

Scope: pre-acceptance only. No changes to post-acceptance, billing, ratings, or payments.

---

## Change 1 — 180-second SEARCHING auto-expiry (preserve, don't delete)

**Rule:** A request in `searching` (or `paused` while edit/cancel modal is open) lives at most 180 s from the current broadcast start. After that it transitions to a new persistent terminal state `expired`. Row is **never deleted**.

**`expired` state semantics:**
- Removed from all doctor feeds immediately (server RPC + client filter).
- **Not shown in requester history.**
- **Visible only in admin analytics dashboards** for reporting / demand intelligence (no-fill rate, time-of-day demand, area heatmap).
- No history row, no audit entry. In-session toast on requester only.
- Terminal — cannot return to `searching`. Requester can re-publish (new row).

**Timer is invisible** on requester and doctor surfaces. No countdown.

**Timer reset on edit:** Re-publish after Edit restarts the 180 s window (`broadcast_started_at = now()`).

**Client (requester) — `RequesterHome.tsx` `DispatchOverlay`:**
- Silent 180 s timer keyed off `broadcast_started_at`.
- On expiry: call `expireRequest(id)` RPC (does NOT delete). Clear local refs, return to `collapsed`, toast: *"No doctor accepted this request in time."*
- Cancel timer on acceptance, manual cancel, edit (re-armed after re-publish), unmount.

**Client (doctor feed) — `network.ts` / `dispatch.ts`:** `BROADCAST_TTL_MS = 180_000`, keyed off `broadcast_started_at`; filter `status = 'expired'` out.

**Client (requester history):** explicit `status <> 'expired'` filter.

**Server (every 30 s via pg_cron):**
- Add `expired` to `coverage_request_status` enum.
- New columns: `broadcast_started_at timestamptz NOT NULL DEFAULT now()`, `expired_at timestamptz NULL`.
- `expire_stale_searching_requests()` — UPDATE rows older than 180 s with no `accepted_by` to `expired`. No DELETE.
- `expire_request(_id uuid)` — requester-callable RPC for in-session expiry; same UPDATE.

---

## Change 2 — Edited request reaches previously-declined doctors (rev bump)

- Add `rev INTEGER NOT NULL DEFAULT 1` to `coverage_requests`.
- `remoteUpdateRequest` bumps `rev` on material field changes (time/duration/environment/amount/notes/days/hospital/area).
- Doctor-side decline storage keys by `${id}:${rev}`. Legacy `${id}` treated as `:1`. Realtime UPDATE with new `rev` re-shows the card.

---

## Change 3 — Cancel-broadcast symmetry

`remoteDeleteRequest` (user-initiated pre-accept cancel) keeps hard DELETE — no history, per spec. Add `emitInvalidate(id)` after a successful DELETE so doctor feeds drop the card immediately.

---

## Change 4 — Dismiss = re-broadcast to ONLINE doctors (NEW)

When the requester dismisses the cancel confirmation card via **"Wait for Doctor"**, the **X icon**, or **tapping outside** (the three dismiss paths on `CancelFlow` / its `DismissSheet`), the system must resume broadcasting to currently online doctors — not just unpause silently.

**Today:** `setCancelOpen(false)` flips status `paused → searching` via `resumeRequest()` + `emitInvalidate(id)`. Doctor feeds re-read the row, but they don't get a *fresh* push and the `broadcast_started_at` is not reset, so doctors who already discarded the card during the pause window may not see it return. The 180 s timer also continues from the original broadcast start — not from dismiss.

**Required behaviour:**
1. On all three dismiss paths, treat the dismiss as an **active re-broadcast event**, not a silent resume.
2. `remoteResumeRequest(id)` updates the row with `status='searching'`, `broadcast_started_at=now()`, and bumps `rev` by 1 (re-broadcast counts as a fresh offer, same as Edit re-publish).
3. After UPDATE, emit `emitInvalidate(id)` so all online doctor clients refetch the open pool.
4. The 180 s expiry timer on the requester side **resets** from the dismiss moment (because `broadcast_started_at` just moved).
5. Previously-declined doctors who are still online see the card again (rev bumped → decline key `${id}:${oldRev}` no longer matches).
6. Offline doctors are not paged; only online doctors receive the broadcast — same rule as initial publish.

**Files touched:** `RequesterHome.tsx` (dismiss handlers wire through the same re-broadcast path), `coverage-remote.ts` (`remoteResumeRequest` bumps `rev` + `broadcast_started_at`).

---

## Admin analytics surfacing

Surface `expired` in existing dashboards (no new page yet):
- **Admin overview (`admin_overview_stats`)** — add `coverage_expired` counter.
- **Risk overview (`admin_risk_overview`)** — include expired in unfilled counts.
- **Requester analytics (`adminRequesterAnalytics`)** — `expired` as a distinct fill outcome, separate from requester cancellations.

---

## Not changing (confirmed correct)

- Pre-accept Edit may continue to expose the full Configure UI.
- Hard DELETE on **user-initiated** pre-accept cancel — no history row.
- `skipReason` on pre-accept `CancelFlow`.
- `paused` retained as internal mechanism for edit/cancel-modal lifecycle.

---

## Technical Details

### Files to edit
1. **`src/features/request/RequesterHome.tsx`** — silent 180 s timer in `DispatchOverlay`; on expiry call `expireRequest`, reset state, toast; re-arm after Edit re-publish and after dismiss-resume. Dismiss handlers (`onDismiss`, X, outside-tap) call the new re-broadcast path. Filter `expired` from local history view.
2. **`src/lib/network.ts`** — `BROADCAST_TTL_MS = 180_000`; open-pool filter uses `broadcast_started_at` and excludes `expired`; `markDeclined` keys by `(id, rev)` with legacy shim.
3. **`src/lib/coverage-remote.ts`** —
   - `remotePublishRequest`: set `broadcast_started_at = now()`, `rev = 1`.
   - `remoteUpdateRequest`: bump `rev` and set `broadcast_started_at = now()` on material change.
   - `remoteResumeRequest`: set `status='searching'`, `broadcast_started_at = now()`, bump `rev`, then `emitInvalidate(id)`.
   - `remoteExpireRequest(id)`: call new `expire_request` RPC.
   - `remoteDeleteRequest`: `emitInvalidate(id)` after success.
4. **`src/features/cover/CoverHome.tsx` / `src/features/cover/dispatch.ts`** — composite `(id, rev)` keys; filter `status='expired'`.
5. **`src/lib/admin.functions.ts`** + admin overview / risk / requester analytics SQL — `expired` counters.

### Database migration
```sql
ALTER TYPE public.coverage_request_status ADD VALUE IF NOT EXISTS 'expired';

ALTER TABLE public.coverage_requests
  ADD COLUMN IF NOT EXISTS rev INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS broadcast_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.expire_stale_searching_requests()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.coverage_requests
     SET status = 'expired', expired_at = now()
   WHERE status IN ('searching','paused')
     AND accepted_by IS NULL
     AND broadcast_started_at < now() - interval '180 seconds';
$$;

CREATE OR REPLACE FUNCTION public.expire_request(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.coverage_requests;
BEGIN
  SELECT * INTO r FROM public.coverage_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF r.requester_id <> auth.uid() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF r.accepted_by IS NOT NULL THEN RETURN; END IF;
  IF r.status NOT IN ('searching','paused') THEN RETURN; END IF;
  UPDATE public.coverage_requests
     SET status = 'expired', expired_at = now()
   WHERE id = _id;
END $$;

SELECT cron.schedule(
  'expire-stale-searching-requests', '30 seconds',
  $$ SELECT public.expire_stale_searching_requests(); $$
);
```

---

## Verification

1. Publish + idle 200 s → row persists as `expired`, `expired_at` set. Doctor feeds empty. Requester sees toast *"No doctor accepted this request in time."* Requester history hides it. Admin expired counter increments.
2. Publish, kill app at 60 s → cron transitions to `expired` at ≥180 s.
3. Doctor A declines → requester edits + re-broadcasts → Doctor A's card re-appears within seconds; 180 s window restarts.
4. **Dismiss re-broadcast:** publish → tap Cancel (paused) → tap "Wait for Doctor" / X / outside → `rev` bumped, `broadcast_started_at = now()`, all online doctors (incl. ones who previously declined) see the card again, 180 s timer restarts. Same outcome for the X icon and outside-tap paths.
5. User-initiated cancel within window → hard DELETE, feeds drop immediately, no history, no expired row.
6. Acceptance within window → timer cancels; row goes `accepted`; never reaches `expired`.
7. No countdown visible anywhere.
