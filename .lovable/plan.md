
## Context

Today, both Cover & Earn and Request Coverage share an in-memory simulated network (`src/lib/network.ts`, ~640 lines) that lives in `localStorage` + `BroadcastChannel`. All coverage state (requests, doctors, accept/decline, pause/resume, history) flows through it. `src/features/cover/dispatch.ts`, `src/features/request/RequesterHome.tsx` (1304 lines), `src/routes/_app.coverage.tsx` (1382 lines), and `ShiftSettlement.tsx` all read from this store.

The request is to replace that simulated state with a real Supabase backend, while keeping all current UI intact.

## Approach (2 phases)

### Phase 1 — Backend-driven coverage requests

**New table: `coverage_requests`**
- id (uuid)
- requester_id (uuid → auth.users.id)
- hospital, area, coverage_type (text)
- day, start_time, end_time (text — preserve current "Mon", "8:00 AM" display format)
- start_ts, end_ts (timestamptz — absolute window for conflict detection)
- duration_hrs (numeric)
- amount (int), fee_pct (int)
- phone, note (text)
- accommodation (text, nullable) — new per spec
- status (enum: searching, accepted, active, paused, completed, cancelled)
- accepted_by (uuid → auth.users.id, nullable)
- started_at, accumulated_ms, settled_amount, days, day_index, cancelled_by
- created_at, updated_at

Status name change: "broadcasting" → **"searching"** (per spec "Initial status: Searching").

**RLS**
- Requesters: select/insert/update/delete their own rows (`requester_id = auth.uid()`)
- Doctors (any approved doctor): select rows with `status = 'searching'` OR `accepted_by = auth.uid()`; update only when `accepted_by = auth.uid()` (for accept/pause/resume/complete from doctor side) and the initial accept transition
- Service role: full access

**Realtime**: enable `REPLICA IDENTITY FULL` and add to `supabase_realtime` so both sides see updates instantly.

**Code wiring**
- New `src/lib/coverage-remote.ts`: typed CRUD + a `useCoverageRequests()` hook that subscribes via Supabase Realtime and returns `{ mine, searching, accepted }` filtered by current user + role.
- Rewrite `src/lib/network.ts` internals to delegate to `coverage-remote.ts` while keeping the existing exported function signatures (`acceptRequest`, `cancelRequest`, `completeRequest`, `broadcastingRequests`, `useNetwork`, `subscribeNetwork`, etc.). This avoids touching the 5000+ lines of consumer code.
  - Doctor presence (`doctors[sid]`, declined list, online flag) stays client-side (per-session) — not required by the spec to be backend.
  - All request CRUD goes through Supabase.
- `RequesterHome` "Create coverage" path writes to Supabase; the Home / Upcoming / Active / History sections read the same hook.
- Coverage tab (`_app.coverage.tsx`) reads from the same hook.

### Phase 2 — Doctor acceptance backend

- `acceptRequest(id)` becomes a Supabase UPDATE: set `accepted_by = auth.uid()`, `status = 'accepted'`, guarded by `WHERE status = 'searching' AND accepted_by IS NULL`. Returns ok if 1 row affected (atomic claim — wins the race naturally).
- Pause/resume/complete/cancel also flow through Supabase updates.
- Realtime broadcasts back to both sides:
  - Requester sees `accepted_by` populated → "Doctor Accepted"
  - Doctor sees their row appear in `accepted` → "Coverage Confirmed"

## Scope guardrails

- **No UI changes** — only data source swap.
- **No new screens**, no redesign of cards, settlement, ratings, or onboarding.
- Doctor presence/online/declined remains local (not in spec, and changing it would ripple into the map/dispatch UI).
- Settlement transparency, ratings, payment overlay — already present, untouched.

## Files

**New**
- `supabase/migrations/<ts>_coverage_requests.sql`
- `src/lib/coverage-remote.ts`

**Edited**
- `src/lib/network.ts` — replace request store internals with Supabase calls; keep exported API stable; add realtime subscription on mount.
- `src/features/cover/dispatch.ts` — minor (status name `broadcasting` → `searching` if needed; keep behavior).
- `src/features/request/RequesterHome.tsx` — replace local request-create call site with the new remote create; remove hardcoded sample requests if any.
- `src/routes/_app.coverage.tsx` — confirm it reads via the hook (already does via `useNetwork` / `useDispatch`).

## Risks

- `network.ts` is large and shared. Wrapping its API around an async backend means turning some sync calls (`acceptRequest`) into fire-and-forget that resolves via the realtime subscription. Plan: keep sync call signature, kick off async update, optimistic local update, reconcile on realtime event.
- Conflict detection (1-hour buffer, max 3 shifts) stays client-side as a pre-check; the DB UPDATE-with-WHERE is the authoritative claim.

## After approval

I'll write the migration first (for your approval), then wire `coverage-remote.ts` + rewire `network.ts` internals, then verify both flows in the preview.
