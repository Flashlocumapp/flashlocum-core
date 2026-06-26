
# Pre-Scale Optimization Plan (Approved Items 1–4)

Apply four targeted optimizations to comfortably support ~700 concurrent doctors and ~1,000 requests/week. No behavioral changes for users.

## 1. Presence Heartbeat Jitter
**File:** `src/lib/doctor-presence.ts` (or current heartbeat module)
- Keep 60s base interval, visibility-gated (unchanged).
- Add ±15s random jitter to each scheduled heartbeat so 700 doctors don't align on the same wall-clock tick.
- No change to event-driven online/offline broadcasts (those stay instant).

## 2. Open-Coverage List Read-Coalescer (1.5s, with bust-on-event guarantee)
**File:** `src/lib/coverage-remote.ts`

Adds a tiny in-memory Promise cache **only** around `list_open_coverage_requests`:
- If a fetch for the same key is in-flight or completed within 1.5s, return that Promise.
- Otherwise issue a fresh fetch.

**Hard contract — propagation is never delayed:**
- Export `bustOpenListCache(key?)`. Every Realtime handler that currently calls `invalidateOpenList()` will call `bustOpenListCache()` **before** triggering the refetch. The next fetch is guaranteed fresh.
- Handlers that bust the cache: `coverage_invalidations` broadcast (new/accepted/cancelled/edited/rebroadcast), `coverage_requests` postgres_changes (lifecycle + payment), realtime watchdog, and the explicit invalidate path in `dispatch.ts`.
- The 1.5s window therefore only collapses *simultaneous duplicate* fetches (e.g. two components mounting at once, tab-focus + reconcile timer firing the same instant). Those produce identical results — collapsing them is invisible to the user.
- Unaffected paths (separate code, separate channels): `doctor_presence`, shift lifecycle UI, payment countdown (server-anchored), Monnify webhooks.

**Acceptance check:** grep confirms every Realtime listener that triggers an open-list refetch calls `bustOpenListCache()` first. Add a unit-style assertion comment in the file documenting the contract.

## 3. Realtime Reconnect Jitter + Cap
**File:** `src/lib/realtime-health.ts` (and any channel reconnect callsites)
- Replace fixed reconnect delay with exponential backoff: 500ms → 1s → 2s → 4s, capped at 5s.
- Add ±30% jitter to each delay to prevent thundering-herd on Realtime restarts.
- Cap maximum concurrent reconnect attempts per client to 1 in-flight.

## 4. Server-Side Broadcast Confirmation Index
**Migration:** new SQL migration
- Add composite index on `coverage_requests (status, created_at DESC) WHERE status = 'open'` to accelerate `list_open_coverage_requests` under load.
- Add covering index on `doctor_presence (online, last_seen_at DESC) WHERE online = true` to speed presence sweeps.
- `CREATE INDEX CONCURRENTLY` so it does not lock the table.

## Verification (after build)
- Confirm `list_open_coverage_requests` still returns instantly on broadcast (manual check via two preview tabs).
- Check `tsgo` passes.
- Confirm migration `EXPLAIN` shows index usage on the open-list query.

## What is explicitly NOT changed
- Broadcast model (all online Lagos doctors receive requests) — product constraint.
- Presence event propagation — remains instant.
- Payment timers, RLS, Monnify flow, FIFO ordering — untouched.
