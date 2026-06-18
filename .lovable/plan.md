# Audit Report — Offline Broadcast, Paused Auto-Resume, Paused Buttons

Read-only investigation. No code is changed yet — this plan ends with the targeted fix proposal you can approve.

---

## Issue 1 — Offline doctors still receive broadcasts

### Distribution path
```
Requester taps Find
  → publishRequest (src/lib/network.ts)
    → remoteInsertRequest → INSERT coverage_requests(status='searching')
      → trigger public.coverage_requests_emit_invalidate
        → realtime.send('coverage_invalidations','invalidate')   ← broadcast (NOT RLS-gated)

Every signed-in doctor subscribed to channel 'coverage_invalidations'
  (src/lib/coverage-remote.ts:622)
  → scheduleRefresh → refreshSnapshot → fetchAll(userId)
    → supabase.rpc('list_open_coverage_requests')                ← server filter
  → snapshotListeners → src/lib/network.ts onSnapshot
  → state.requests updated → useDispatch() recomputes
  → src/features/cover/CoverDispatchPortal.tsx renders Incoming card
```

### Where `doctor_presence.online` is (and isn't) enforced

| Layer | Honors `online`? |
| --- | --- |
| Realtime broadcast `coverage_invalidations` | No — broadcast channels bypass RLS by design; every subscribed client receives the wake-up. |
| RPC `public.list_open_coverage_requests` (verified via `pg_get_functiondef`) | **No.** Only gate is `current_user_is_approved_doctor()`. The WHERE clause filters by `status='searching' AND accepted_by IS NULL AND broadcast_started_at > now() - 180s`. `doctor_presence` is never joined. |
| `coverage-remote.ts` `fetchAll` (317–366) | No — just calls the RPC. |
| `dispatch.ts` Incoming-Coverage gate (229–247) | **Deliberately disabled.** Comment says "Eligibility (approved doctor + online) is enforced SERVER-SIDE in the RPC" — that claim is false. |
| `dispatch.ts` toast cue (316) | Yes — suppresses audible cue when `!me.online`, but the **card** is still produced by the gate above. |
| Restricted-doctor check | Enforced only on row writes (`coverage_requests_enforce_account_restriction`), never on reads. |

### Root cause
`list_open_coverage_requests` does not gate on `doctor_presence.online` (or `profiles.account_restricted_at`), and the UI fallback gate was intentionally removed under the false assumption that the RPC enforces this. Net effect: any approved doctor — offline, restricted, or both — receives every broadcast.

### Files & functions involved
- DB: `public.list_open_coverage_requests`, `public.doctor_presence`, `public.profiles.account_restricted_at`.
- Client: `src/lib/coverage-remote.ts` (`fetchAll`, `subscribeCoverageRemote`), `src/features/cover/dispatch.ts:229-247`.

---

## Issue 2 — Paused multi-day shift auto-resumes to Active

### State transitions traced

| Step | Site | Behavior |
| --- | --- | --- |
| 1. User taps Pause | `src/features/app/CoverageScreen.tsx:300 beginPause` | `await netPauseShift(id)` |
| 2. Server RPC | `public.pause_shift` (verified) | Closes open `shift_segments` row, sets `status='paused'` under `app.lifecycle_bypass='on'`. No payment / settlement / rating side-effects — correct. |
| 3. Local mirror | `src/lib/network.ts:933-937 pauseShift` | `applyLocalPatch(id, { status: "accepted", startedAt: undefined, accumulatedMs })`. **Writes `'accepted'`, not `'paused'`.** Today's segment folded into `accumulatedMs`. |
| 4. Realtime fan-out | trigger → `coverage_invalidations` broadcast | Every client calls `refreshSnapshot`. |
| 5. Snapshot diff | `src/lib/network.ts:412-484 onSnapshot` | Server row `paused`, local `accepted`. **No diff clause for `accepted → paused` (or `active → paused`)** — state replaced wholesale, no `NetEvent` synthesized. |
| 6. Postgres-changes UPDATE | `src/lib/network.ts:326-380 applyRemoteEvent` | For `old.status='active' / new.status='paused'`, no clause matches (only `broadcasting↔paused` are handled, lines 362-365). Row upserted as `paused`, no event. |

By the end of step 6 the row IS `paused` everywhere. The visible "snaps back to Active" therefore must come from a writer that flips paused away. Audit of every writer:

1. **`network.ts:1021 resumeRequest`** — flips `status: paused → broadcasting`, bumps `rev`, resets `broadcast_started_at`. **No server RPC**; pure client write via `applyPatch → remoteUpdateRequest`. Call sites:
   - `src/features/request/RequesterHome.tsx:1221` — inside the publish/resume effect that runs whenever `stage === 'dispatch'` AND `cur.status === 'paused' || 'broadcasting'`.
   - `src/features/request/RequesterHome.tsx:1263` — when the cancel/edit sheet closes AND `stage === 'dispatch'`.
2. **`network.ts:883 startRequest` → `callServerLifecycle('resume')` → `resume_shift` RPC** — only invoked by the explicit Resume button (`CoverageScreen.moveToActive`). Not automatic.
3. **No setInterval / setTimeout / background polling** in `CoverageScreen.tsx`, `CoverHome.tsx`, `dispatch.ts`, or `coverage-remote.ts` writes status.
4. **DB triggers**: `_cr_after_status_change` only recomputes trust on terminal states. `bump_request_rev_on_change` only handles `paused → searching` rev bumps. `prevent_requester_sensitive_change` does **not block `status` writes** — so any client write that sets status lands. No trigger auto-promotes `paused → active`.

### Root cause
The `paused` enum value is **overloaded**: it represents both
- "pre-acceptance broadcast paused by the requester sheet" (lifecycle managed by `pauseRequest` / `resumeRequest` in `network.ts`), and
- "post-acceptance multi-day shift on hold" (lifecycle managed by `pause_shift` / `resume_shift` RPCs).

`resumeRequest()` does not check whether the row has been accepted/started — it just sees `status === 'paused'` and flips it to `broadcasting`. The `RequestDispatch` effect at `RequesterHome.tsx:1200-1257` therefore auto-resumes a post-acceptance paused multi-day shift whenever the requester's home sheet is re-mounted with `stage='dispatch'` and the persisted `requestId` still points at it.

Secondary: `network.ts:pauseShift` writes the **local** status as `'accepted'` (not `'paused'`). It masks the true paused state in cross-tab `BroadcastChannel` snapshots and inflates the surface that any "accepted means upcoming" reader can act on.

### Files & functions involved
- `src/features/request/RequesterHome.tsx` (1186, 1200–1257, 1260–1264, 1272–1305).
- `src/lib/network.ts` (`resumeRequest` 1021, `pauseRequest` 1003, `pauseShift` 917).
- `src/lib/coverage-remote.ts` (`dbStatusToNet` / `netStatusToDb`, 153–173).
- DB: `pause_shift`, `resume_shift`, `bump_request_rev_on_change` — all currently correct; bug is purely client-side.

---

## Issue 3 — Upcoming-card buttons for paused multi-day shift

`RequesterCoverage.toRequestItem` (`CoverageScreen.tsx:100-110`) maps `r.status='paused' → status:'upcoming'` and preserves `accumulatedMs > 0`.

The card-button logic in `DismissSheet` content (lines 661–716) is:
- `Call` — always (662–667).
- `Resume Shift` — `status==='upcoming'`, label switches to "Resume Shift" when `accumulatedMs > 0` (668–676). ✅
- `End Shift` — `status==='active' || (status==='upcoming' && accumulatedMs > 0)` (688–699). ✅
- `Pause Shift` — only `status==='active' && days > 1 && dayIndex < days` (677–685). Never on paused. ✅
- `Edit / Cancel` — only `status==='upcoming' && accumulatedMs === 0` (701–716). Never on paused (since paused always has a closed segment). ✅

So **Issue 3 is a downstream symptom of Issue 2**: the auto-resume flips the row out of `paused` (into `broadcasting → accepted → active`), which is what changes the button set. Fix the auto-resume and the button set stays stable across N pause/resume cycles. No standalone fix required for Issue 3.

---

## Proposed Fix (still requires approval)

**Issue 1 — `online` enforcement**
1. **DB:** rewrite `public.list_open_coverage_requests` to additionally require:
   ```sql
   AND EXISTS (
     SELECT 1 FROM public.doctor_presence dp
     WHERE dp.user_id = auth.uid() AND dp.online = true
   )
   AND NOT EXISTS (
     SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid() AND p.account_restricted_at IS NOT NULL
   )
   ```
   Keep `current_user_is_approved_doctor()` guard. Result: offline / restricted doctors get an empty pool from the RPC.
2. **Client (defense in depth):** re-enable the local gate in `src/features/cover/dispatch.ts:229-247` so cold-start / reconnect windows can't briefly leak a cached card to an offline doctor. Gate on `!!me?.online`.

**Issue 2 — stop the auto-resume**
1. **`src/lib/network.ts:resumeRequest`** — refuse to act on post-acceptance rows. Add early return if `cur.acceptedBy` is set or `cur.startedAt != null` or `(cur.accumulatedMs ?? 0) > 0`. Only the legitimate pre-acceptance dispatch sheet should mutate `paused → broadcasting`.
2. **`src/lib/network.ts:pauseRequest`** — symmetric guard: only act when `cur.status === 'broadcasting'` AND `!cur.acceptedBy`. Already partially correct (`status==='broadcasting'` check on line 1006); keep but add `!acceptedBy` for clarity.
3. **`src/features/request/RequesterHome.tsx:1200-1264`** — in both effects, before calling `resumeRequest/pauseRequest`, require `!cur.acceptedBy && cur.startedAt == null`. This makes the dispatch sheet inert toward any leftover multi-day shift id.
4. **`src/lib/network.ts:pauseShift`** — write `status: "paused"` locally (matching server), not `"accepted"`. Eliminates the mirror divergence.

**Issue 3** — covered automatically by fix 2; no additional code change.

### Verification plan (manual after fix)
- Scenario A: Start → Pause → row stays in Upcoming, buttons {Resume, End, Call}, timer frozen at accumulatedMs, no DB writes for 60s+.
- Scenario B: Resume → row in Active, buttons {Pause, End, Call}, timer continues from accumulatedMs.
- Scenario C: A→B 5× — row never disappears, no Monnify call, no rating overlay, `coverage_requests.status` history shows only manual transitions.
- Scenario D: Pause → End Shift → `end_shift` RPC, settlement sheet opens, Monnify checkout, no `resume_shift` fires.
- Issue 1 spot-check: doctor toggles offline → publish a request from a second account → doctor sees no Incoming card and no toast. Toggle online → next publish appears within one broadcast cycle.

Reply "approve" (or with edits) and I'll switch to build mode and implement exactly these changes.
