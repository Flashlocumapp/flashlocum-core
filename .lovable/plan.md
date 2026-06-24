## Scope (strict)

Only the **pre-acceptance** state inside `DispatchOverlay` in `src/features/request/RequesterHome.tsx`. No changes to post-acceptance Edit Shift, post-acceptance Cancel, accepted/assigned flows, `network.ts`, or `coverage-remote.ts`.

## Confirmed root cause

The two buttons live side-by-side at lines 1526–1538, but they take different code paths:

- **Cancel Request (works)** — `onClick={() => setCancelOpen(true)}`
  - `DispatchOverlay` stays mounted.
  - Derived `paused = cancelOpen || editOpen` flips true.
  - The effect at line 1234 runs synchronously and calls `pauseRequest(cur.id)` while `cur.status === "broadcasting"`.
  - Server flips the row to `paused` → doctor feeds drop the card.

- **Edit Request (broken)** — `onClick={() => setStage("configure")}`
  - `DispatchOverlay` unmounts immediately.
  - The proven `paused` gate never engages because `editOpen` is never set.
  - Pause is left to a parent stage-watching effect that fires *after* unmount and races with re-render, so the doctor's card remains visible (and on later cycles the server-side `rev` keeps climbing while the doctor UI never refreshes).

That is the entire bug. Edit is not using the same withdrawal primitive as Cancel.

## Fix (single file, two-line change in behavior)

Edit only `src/features/request/RequesterHome.tsx`.

1. Change the pre-acceptance Edit Request button (line 1528) from:
   ```
   onClick={() => setStage("configure")}
   ```
   to:
   ```
   onClick={() => setEditOpen(true)}
   ```
   This makes Edit hit the exact same `paused` gate as Cancel — `DispatchOverlay` stays mounted, the existing line-1234 effect calls `pauseRequest(cur.id)` synchronously, and the doctor feed drops the card immediately.

2. Add a small effect inside `DispatchOverlay` that, once `editOpen` is true **and** the request has actually been paused on the server (`cur.status !== "broadcasting"`), transitions to the configure stage so the user can edit:
   ```
   useEffect(() => {
     if (editOpen && cur && cur.status !== "broadcasting") {
       setStage("configure");
     }
   }, [editOpen, cur?.status]);
   ```
   This guarantees the withdrawal lands before the overlay unmounts, mirroring Cancel's ordering.

3. If the user dismisses the edit sheet without proceeding (taps outside / swipes the sheet), the existing `editOpen → false` path already triggers `resumeRequest` via the same derived `paused` effect Cancel uses. No extra resume code is needed for the abandon case.

4. Save / republish on completion is unchanged — the existing configure → match → dispatch path already calls `resumeRequest` and the doctor sees the updated row.

## Out of scope (explicitly not touched)

- Post-acceptance Edit Shift (`EditShiftSheet`)
- Post-acceptance Cancel (`cancelUpcoming`)
- Accepted / assigned shift behavior
- `src/lib/network.ts` snapshot fallback (deferred — not the cause of the reported bug)
- `src/lib/coverage-remote.ts`
- Any prior `beginLiveRequestEdit` parent-level handler in `HomeScreen`

## Verification after build mode

1. Start broadcast → tap **Edit Request** → observe the doctor's feed: card must disappear within the same render frame, identical to Cancel.
2. Dismiss the edit sheet without saving → card reappears on doctor's feed (resume path).
3. Save an edit → updated card appears on doctor's feed as a fresh offer.
4. Repeat the full Edit/Save cycle 5 times on the same request id without reload. Each cycle's withdrawal must be visually identical to Cancel's withdrawal.
