# Why the requester sometimes stays on "Searching" after a doctor accepts

## Reproduction profile

Reported as intermittent and per-request rather than universal. That matches a **timing window**, not a broken happy path — every step in the happy path is wired correctly today. Two independent windows reliably reproduce the symptom; both end with the row already past `accepted` server-side while the requester's `DispatchOverlay` is still in the `"dispatch"` stage (which renders the "Searching" UI).

## Root cause A — Acceptance trigger only matches `status === "accepted"`

`src/features/request/RequesterHome.tsx` lines 1377-1393 advance the overlay only on a strict match:

```ts
if (stage === "dispatch" && r.status === "accepted" && !!r.acceptedBy) {
  setStage("accepted");
}
```

After the doctor taps Accept, the server flow on the doctor side often progresses the row almost immediately:

- `claim_coverage_request` → `status = 'accepted'`
- doctor taps Start Shift → `start_shift` → `status = 'active'`
- or the doctor pauses → `status = 'paused'`

If the requester's realtime channel delivers only the **latest** `UPDATE` (postgres_changes is row-level, not transition-level), `r.status` arrives as `active`/`paused`. The effect short-circuits. `r.acceptedBy` is populated, the 180 s expire timer correctly stops (it gates on `broadcasting`/`paused` only), so the overlay sits in "dispatch" forever showing "Searching". Same gap exists for the `cancelled` branch — only handled while `stage === "accepted"`, so a pre-overlay-advance cancel cannot clear the dispatch view either.

## Root cause B — Edit-gate side-effect can push stage to `configure` mid-accept

Lines 1319-1323:

```ts
if (editOpen && stage === "dispatch" && _curStatus && _curStatus !== "broadcasting") {
  setStage("configure");
}
```

If the requester taps Edit at the exact moment the doctor accepts:
1. `openEdit()` fires `pauseRequest` (optimistic local `status = "paused"`).
2. Realtime echo for the acceptance lands and overwrites the row with `status = "accepted"`, `acceptedBy = <doc>`.
3. `_curStatus !== "broadcasting"` is true → `setStage("configure")`.
4. The user closes the edit sheet; nothing transitions them to `accepted` because the trigger in (A) only fires from `stage === "dispatch"`.

Outcome: the next time they open the overlay it's "Searching" again (DispatchOverlay re-mounts on `stage === "dispatch"`), but the underlying row is already accepted.

## Root cause C — No watchdog reconcile while in dispatch

`useLifecycleReconcile` is mounted on `CoverageScreen` / `ShiftSettlement` for in-flight shifts. `DispatchOverlay` does NOT mount it. If realtime drops the single `accepted` UPDATE (mobile reconnect, channel grace, `recentEventIds` 1.5 s coalescer eating a duplicate before the listener wires up), there is no 4 s poll to recover. The `coverage_invalidations` broadcast helps but is not received if the channel is mid-reconnect at the moment the doctor accepts.

## Why it looks random

A, B, and C each require a sub-second alignment:
- A: doctor's Start tap inside the realtime fan-out latency
- B: requester's Edit tap inside the acceptance fan-out
- C: a missed event on the only delivery channel

Most requests miss all three. The ones that hit any one of them get stuck.

## Remediation

Minimal, surgical, frontend-only. No DB changes, no business-logic changes.

### 1. Broaden the acceptance/terminal trigger (Root cause A)

`src/features/request/RequesterHome.tsx` — the effect at ~1377:

- Advance to `"accepted"` whenever the overlay is on `dispatch` AND `r.acceptedBy` is set AND `r.status` is anything other than `broadcasting`/`paused`. Covers `accepted`, `active`, `paused-post-accept`, `awaiting_payment`, `completed`.
- Handle `r.status === "cancelled"` while in `stage === "dispatch"` too (clear `requestId`, return to `collapsed`, optional toast). Today only `"accepted"` stage handles it.

### 2. Skip the edit-gate stage push while a doctor has accepted (Root cause B)

Same file, the `editOpen` effect at ~1319: add `&& !_curAcceptedBy` to the guard. Once a doctor is on the row, the edit flow is no longer the pre-acceptance "configure" flow — the row should move through (1) into the accepted view, not into configure.

### 3. Mount the watchful reconcile in DispatchOverlay (Root cause C)

In `DispatchOverlay` (~line 1164), add:

```ts
useLifecycleReconcile(requestId, { enabled: stage === "dispatch" });
```

This re-reads the single row every 4 s plus on focus/visibility/online while waiting for acceptance. With realtime healthy it is a no-op; when realtime misses, it closes the gap within one tick.

### 4. Defensive symmetry on the doctor side (no behavioural change expected)

While we're here, double-check `dispatch.ts` already advances the doctor view on any `status !== "searching"` for the row they accepted — it does (uses `acceptedBy === sid` + status set including `accepted/active/paused/awaiting_payment`). No change needed.

## Files touched

- `src/features/request/RequesterHome.tsx` — two effect edits (root causes A + B), one hook mount (root cause C).

## Verification plan

1. **Happy path:** request → accept → confirm overlay flips to "Accepted" within < 500 ms.
2. **Race A:** request → accept → start (fast). Confirm overlay flips to Accepted, not stuck on Searching.
3. **Race B:** request → open Edit at the moment of accept. Confirm overlay reaches the accepted card (not stuck in configure or searching).
4. **Race C:** request → DevTools throttle Realtime channel (disable network 3 s right after publish). Accept from a second device. Confirm watchdog reconcile recovers within 4 s.
5. **Build + console:** clean `bun run build`; no new realtime channels created; no extra DB writes (watchdog uses existing coalesced single-row read).

## What we are NOT changing

- No DB schema / RLS / RPC changes.
- No new realtime channels or subscriptions.
- No changes to the Edit/Cancel server flows or to `claim_coverage_request`.
- No change to the 180 s pre-acceptance expiry behaviour.
