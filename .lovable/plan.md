## Audit — where stale state can trap a user

Source of truth audit (every surface that reads `coverage_requests` state and could miss a realtime event):

| Surface | Lifecycle state it watches | Current reconcile path | Gap |
|---|---|---|---|
| RequesterHome — dispatch slider | `searching → accepted / cancelled / expired` | Realtime invalidate + postgres_changes only | **No fallback while the sheet is open** |
| RequesterHome — accepted card | `accepted → cancelled (by doctor)` and shift start | Realtime only | **No fallback** |
| CoverHome — Incoming feed | new `searching` rows, accept-by-other (drop), edit-pause (drop), expire | Invalidate broadcast → `fetchAndIngestRow` / `refreshSnapshot` | OK in steady state, but no reconcile on invalidations channel `SUBSCRIBED` (re)connect |
| CoverHome — Upcoming / Active card | `accepted → active → paused → awaiting_payment → completed / cancelled` | Realtime only | **No fallback** |
| CoverageScreen tabs (Active / Upcoming / History) | same as above, both roles | Realtime only | **No fallback** |
| ShiftSettlement | `awaiting_payment → completed`, surcharge window, payment_due_at extensions | Realtime only | **No fallback while sheet is mounted** |

`src/lib/coverage-remote.ts` already wires:
- `visibilitychange → refreshSnapshot()` ✓
- `online → refreshSnapshot()` ✓
- Coverage channel `SUBSCRIBED → refreshSnapshot()` ✓
- Idle "silence" reconcile timer ✓ (passive only — only fires when realtime has been quiet)

Missing pieces that allowed today's incident:
1. The **invalidations** channel SUBSCRIBED handler only resets backoff — it does NOT `refreshSnapshot()`. If that channel reconnects after dropping the accept broadcast, the missed event is never recovered.
2. There is no `window.focus` listener. On iOS Safari / PWA shells, `focus` fires when `visibilitychange` does not (e.g. coming back from a system sheet).
3. There is no **per-row "watchful" reconcile** while a screen is actively staring at a specific in-flight row. The full-snapshot refresh covers it, but only fires on visibility/focus/reconnect — between those events, any screen showing a single live row (dispatch slider, accepted card, active shift, settlement) has zero fallback if its channel dropped the most recent event.
4. There is no explicit "reconcile this row now" entry point for lifecycle screens to call on mount and on stage transitions.

## Remediation — unified reconciliation strategy

Realtime stays primary. Snapshot reconciliation becomes the universal safety net, exposed through one small API and wired into every lifecycle surface.

### A. `src/lib/coverage-remote.ts` — global reconcile surface

1. Export `reconcileNow()` → coalesces onto `refreshSnapshot()` (full snapshot).
2. Export `reconcileRequest(id)` → coalesces onto `fetchAndIngestRow(id)` (single-row authoritative re-read).
3. Add a `window.focus` listener that calls `reconcileNow()` (in addition to `visibilitychange` and `online`).
4. In the **invalidations** channel SUBSCRIBED handler, also call `reconcileNow()` so any broadcast missed while the channel was down is recovered on reconnect.
5. After every server-side mutation initiated by THIS client (claim, start, pause, resume, end, cancel, extend payment window, mark paid), call `reconcileRequest(id)` once after the awaited RPC resolves — this guarantees the local cache reflects authoritative server state regardless of whether the trigger's broadcast round-tripped.

### B. New `useLifecycleReconcile(id, opts)` hook in `src/lib/use-lifecycle-reconcile.ts`

A small hook that any lifecycle screen mounts. While mounted, it:
- Calls `reconcileRequest(id)` immediately on mount.
- Re-runs `reconcileRequest(id)` every 4 s (cheap single-row read; coalesced).
- Re-runs on `visibilitychange → visible`, `window.focus`, and `online`.
- Auto-stops once the row enters a terminal state defined by the caller (e.g. `cancelled` / `completed` / `expired`, or a custom predicate like "left dispatch stage").

Implementation note: the 4 s heartbeat is bounded — every lifecycle screen has a natural exit (180 s dispatch timer, shift end, completion). At realistic scale this is < 1 read/s per active user with one shift in flight, well within Supabase budget and gated to active windows only.

### C. Wire the hook into every lifecycle surface

- `src/features/request/RequesterHome.tsx` — mount the hook for `requestId` while `stage ∈ {dispatch, accepted}`; terminal predicate: row leaves `broadcasting|paused|accepted|active`.
- `src/features/cover/CoverHome.tsx` — for the doctor's currently-engaged shift (the Upcoming/Active card); terminal predicate: row is `completed|cancelled|awaiting_payment` and the sheet has been dismissed.
- `src/features/app/CoverageScreen.tsx` — when the user expands any card showing an in-flight shift (Active or Upcoming tab); terminal: row leaves the tab's category.
- `src/features/request/ShiftSettlement.tsx` — for the entire mounted lifetime; terminal: `payment_status === "paid"` or `status === "cancelled"`.

### D. Lifecycle-action reconcile fan-out (already partly in place)

Confirm every server-mutating helper in `src/lib/coverage-remote.ts` emits an invalidate AND, on the caller side, awaits one `reconcileRequest(id)` so the actor's UI is never left behind its own action:
- `remoteClaimRequest`, `pauseRequest`, `resumeRequest`, `startShift`, `endShift`, `cancelRequest`, `extendPaymentWindow`, `markPaid`.

### E. No changes to

- The broadcast model (every online Lagos doctor still receives every new request — core product constraint).
- RLS, triggers, RPCs, schema.
- The realtime channel topology — realtime remains primary.
- The 180 s pre-acceptance expiry.

## Files to touch

- `src/lib/coverage-remote.ts` — `reconcileNow`/`reconcileRequest` exports, `window.focus` listener, invalidations-channel SUBSCRIBED reconcile, post-mutation reconcile in each helper.
- `src/lib/use-lifecycle-reconcile.ts` *(new)* — the shared hook.
- `src/features/request/RequesterHome.tsx` — mount hook in `Dispatch` + `DispatchAccepted`.
- `src/features/cover/CoverHome.tsx` — mount hook for the engaged shift card.
- `src/features/app/CoverageScreen.tsx` — mount hook for the expanded in-flight card.
- `src/features/request/ShiftSettlement.tsx` — mount hook for the open settlement.

## Acceptance criteria

With realtime artificially blocked (channel forced offline):
- A doctor accept becomes visible to the requester within ≤4 s, anywhere in the requester app.
- A requester cancel/pause/resume/end becomes visible to the doctor within ≤4 s, in CoverHome and CoverageScreen.
- Payment completion / extension / surcharge timer change becomes visible to both sides within ≤4 s in ShiftSettlement.
- Returning to the tab (visibility / focus / online / reconnect) ALWAYS triggers a snapshot reconcile.
- No screen can remain in a stale state indefinitely because a realtime event was missed.

Negative test: with realtime fully connected, the 4 s heartbeat is a no-op (single-row read returns identical data; coalesced refresh detects no hash change and skips re-render) — zero visible cost.
