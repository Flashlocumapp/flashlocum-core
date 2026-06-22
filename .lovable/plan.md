# FINAL REMEDIATION PLAN — Notifications, Settlement, Edit Flow, Map, Search

User-approved scope. Each section is independently shippable.

---

## §1 — Notification / Toast / Push / Haptic Compliance

### 1.1 Delete duplicate/non-compliant toasts

**`src/features/app/CoverageScreen.tsx`** — delete the legacy realtime listener at lines 270–296. The engine (`feedback.ts` `plan()`) already emits `offer.accepted` and `shift.cancelled` toasts with the correct, name-bearing wording. Removes:
- ❌ `"Doctor accepted your request." / "Open Coverage → Upcoming for details."`
- ❌ `"Doctor cancelled this shift."`

**`src/lib/presence-remote.ts:342–347`** — delete the online/offline ambient toast. Presence reconciliation is silent.

### 1.2 Fix `verification.result` wording

**`src/lib/feedback.ts` `plan()`** — replace the generic `"Verification update"` with two contract-exact strings derived from `ctx.title` payload:
- approved → `"Your account has been verified successfully."`
- rejected → `"Your verification requires attention. Please review and resubmit."`

**`src/lib/admin.functions.ts:110–112`** — set push `body` to the same two strings (was: arbitrary `bodyByStatus`).

### 1.3 Strip haptics from non-`offer.new` events

**`src/lib/feedback.ts` `shiftCue()`** — remove the `haptic` intensity computation. The function becomes a no-op shim (kept only for API compatibility). The planner's `offer.new → medium` haptic remains the ONLY haptic emit in the codebase.

### 1.4 Add missing background pushes

New server functions in `src/lib/coverage-notify.functions.ts` (mirror the existing `startAndNotifyFn` shape):
- `pauseAndNotifyFn` — body `"{Hospital Name} paused your shift until the next scheduled session."`
- `resumeAndNotifyFn` — body `"Your shift with {Hospital Name} has resumed."`
- `updateAndNotifyFn` — body `"{Hospital Name} updated your shift details."` (called from the requester's "Edit Request → re-broadcast (POST-acceptance)" path only — pre-acceptance edits never push).

Wire these from the existing lifecycle call sites in `src/lib/network.ts` (replace direct `remoteUpdateRequest` with the notify variants for the post-acceptance pause/resume paths) and from the edit-republish path in `RequesterHome.tsx`.

### 1.5 Add `Request Created` background push to doctors

In `src/lib/coverage-remote.ts` `remoteInsertRequest` (or a new `createAndNotifyFn` on the server), after the row is inserted, fan out a push to every currently-online eligible doctor:
- title: `"New coverage request"`
- body: `"New coverage request available from {Hospital Name}"`

Foreground doctors already get the card + haptic via the realtime path; the engine's 6 s ledger collapses the foreground push echo into a no-op (per §1.7).

### 1.6 Payment-complete rule (per user decision)

- **Doctor**: unchanged. Foreground toast + background push, both bodied `"Payment received for your shift with {Hospital Name}. Remittance will be completed by 10PM today."` (already correct in `monnify-webhook.ts:144` and `feedback.ts plan()`).
- **Requester**: **delete the requester push** in `src/routes/api/public/monnify-webhook.ts:160–177`. Requester initiates payment, so contract = toast-only. Foreground toast `"Payment completed successfully for your shift with Dr. {Doctor Name}."` continues to fire via the engine's `payment.settled` path (the realtime `paid_at` flip drives it; or a local `fromLocal` emit at successful Monnify return).

### 1.7 Foreground push suppression

Single global rule in the service-worker / Capacitor push handler: if `document.visibilityState === "visible"`, do NOT post a system notification. Always re-ingest into the engine. Guarantees the contract's "foreground = toast only" rule across every event.

### 1.8 Normalize push title

Across `coverage-notify.functions.ts`, `monnify-webhook.ts`, `shift-reminders.ts`, set push `title` equal to the body (or a short prefix derived from it), so the OS notification shade shows contract-exact wording — never a generic word like `"Reminder"` or `"Shift started"`.

### 1.9 Operational toasts — KEEP (per user decision)

These are explicitly NOT contract notifications; they remain as operational guidance. No changes:
- `"You already have the maximum number of confirmed shifts."`
- `"Coverage requests are limited to 14 days maximum."`
- `"No doctor accepted this request in time."`
- Lifecycle RPC error toasts (`"Couldn't start/pause/end this shift"`).
- Rating save error, profile save, verification re-upload, race-loss-on-accept, place-details-error toasts.
- All `_admin.*` toasts and admin push notifications (admin tooling is out of contract).

### 1.10 Operational toasts — REMOVE (per user decision)

In `src/features/request/RequesterHome.tsx:988–996`, delete the date-floor toast (`"Coverage requests start from today."`). Replace with inline form validation (disable past dates in the `<input type="date" min={today}>` and silently clamp via `onChange?.(min)` without surfacing a toast — `min` is already set, so no message is needed).

### 1.11 Memory write

Create `mem://constraints/notification-contract.md` capturing the full contract verbatim plus the operational-vs-contract split. Add a Core line to `mem://index.md` enforcing: "Contract events (lifecycle, payment, rating, reminder, request, shift, verification) route through `feedback.ts ingest()`. Direct `pushToast` calls outside operational/admin scope are forbidden."

---

## §2 — Monnify Settlement Completion

1. New route `src/routes/api/public/monnify-disbursement-webhook.ts` — HMAC-SHA512 verify with `MONNIFY_SECRET_KEY` (same shape as `monnify-webhook.ts`). Handle `SUCCESSFUL_DISBURSEMENT` and `FAILED_DISBURSEMENT`.
2. On success, call `mark_settlement_remitted(_payment_reference, _amount)` RPC — sets `remitted_at`.
3. Push the doctor: body `"Your earnings for {Hospital Name} have been successfully remitted to your bank account."` (also surfaces foreground toast via engine `payment.settled` second-stage event — extend `EventKind` with `settlement.remitted` for clean separation).
4. Broadcast `coverage_invalidations` so Earnings + Admin Finance refresh without polling.
5. Reconciliation cron at `src/routes/api/public/hooks/reconcile-settlements.ts` (daily) — for any `payment_status='paid' AND remitted_at IS NULL AND paid_at < now() - interval '36h'`, query Monnify per-reference and call `mark_settlement_remitted` for confirmed disbursements.
6. Document Monnify dashboard webhook URL setup in `mem://features/monnify-settlement.md` — published URL is `https://flashlocum-core.lovable.app/api/public/monnify-disbursement-webhook`.

---

## §3 — Edit Request Flow

1. Drop the `cur.status !== "broadcasting"` guard in `pauseRequest` (`src/lib/network.ts:1118`). Authoritative gate becomes: if `acceptedBy` is set, no-op; otherwise always issue the DB UPDATE.
2. Convert `pauseRequest` to `async`; await `remoteUpdateRequest` so the Edit screen can block on confirmation. Surface failures via operational toast.
3. Add server RPC `pause_for_edit(_request_id)` (asserts `requester_id=auth.uid()` + `accepted_by IS NULL`, sets `status='paused'`, bumps `rev`, broadcasts invalidate atomically). Use it from `pauseRequest` in place of the generic UPDATE.
4. Edit screen shows an inline "Hiding from doctors…" indicator that resolves the moment the RPC returns (typically <200 ms). No UI workaround — fix is purely state-machine + atomic RPC.

---

## §4 — Map Lagos Restriction

1. Tighten `LAGOS_BOUNDS` in `src/lib/google-maps.ts:69–72` to the actual state extent: `sw: { lat: 6.393, lng: 2.703 }, ne: { lat: 6.702, lng: 3.692 }`.
2. Request `addressComponents` field in `Place.searchByText` and filter results where `administrative_area_level_1 !== "Lagos"` (deterministic admin-area check on top of bounds).
3. Apply the same admin-area check in `selectSuggestion`'s Place Details path.
4. Standardize rejection toast to `"FlashLocum is not available in this location yet."`.

---

## §5 — Hospital Search Bar Clearing

1. In `RequesterHome.tsx`, after `setLocation(...)` succeeds in both `selectLocation` and `selectSuggestion`, call `setQuery("")` and `setSuggestions([])`.
2. Add a reset effect: on `stage === "collapsed"`, clear `query` and `suggestions`.
3. Also clear on the expiry paths (`RequesterHome.tsx:1314, 1324`).

---

## Execution Order

1. §5 Search clear (trivial, ~5 lines).
2. §3 Edit flow (small blast radius, biggest UX win).
3. §4 Map bounds (single-file change).
4. §1 Notification compliance (delete legacy + add missing pushes).
5. §2 Settlement webhook (new route + cron + Monnify dashboard config).

Each section ships independently. Approve to begin.