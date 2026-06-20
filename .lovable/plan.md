# Audit 10 — Notification Cleanup & Replacement Plan

This is a **cleanup** plan. The Audit 10 contract is the single source of truth. Every old toast, push body, and trigger point that does not match it gets removed, replaced, or re-wired. No event may produce more than one outcome.

---

## Part A — Cleanup Report (what exists today vs. what should exist)

### A1. Copy that must be REPLACED (wrong wording in the central planner)

`src/lib/feedback.ts` → `plan()` switch is the single rendering policy. Today its copy is generic and in some cases factually wrong. Replace each kind's templates:

| Kind | Current copy (remove) | New copy (Audit 10) |
|---|---|---|
| `shift.started` (doctor) | "Your shift with {hospital} has started." + "Tap the active card for shift details." | "Your shift with {hospital} has started." (no subtitle) |
| `shift.started` (requester) | "Doctor started the shift at {hospital}." | **No toast** — self-initiated. Remove. |
| `shift.paused` (doctor) | "Your shift with {hospital} has been paused." + "Coverage timer is preserved…" | "{hospital} paused your shift until the next scheduled session." |
| `shift.paused` (requester) | "Doctor paused the shift at {hospital}." | **No toast** — self-initiated. Remove. |
| `shift.resumed` (doctor) | "Your shift with {hospital} has resumed." + "Coverage timer continues…" | "Your shift with {hospital} has resumed." (no subtitle) |
| `shift.resumed` (requester) | "Doctor resumed the shift at {hospital}." | **No toast** — self-initiated. Remove. |
| `shift.ended` (doctor) | "Your shift with {hospital} has ended." + **"Payment will be remitted to your account by 10PM today."** | "Your shift with {hospital} has ended. Payment processing has started." (single line, no payment-remittance subtitle — that belongs to `payment.settled`) |
| `shift.ended` (requester) | "Doctor ended the shift at {hospital}." | **No toast** — self-initiated. Remove. |
| `shift.updated` (doctor) | "{hospital} updated this shift" | "{hospital} updated your shift details." |
| `shift.updated` (requester) | (same generic) | **No toast** — self-initiated. Remove. |
| `shift.cancelled` (doctor) | "{hospital} cancelled shift" | "{hospital} cancelled the shift." |
| `shift.cancelled` (requester) | "Doctor cancelled shift" | "Dr. {doctorName} cancelled the shift." |
| `payment.settled` (doctor) | "Payment settled" | "Payment received for your shift with {hospital}. Remittance will be made by 10PM today." |
| `payment.settled` (requester) | (not handled) | "Payment completed successfully for your shift with Dr. {doctorName}." |
| `reminder.preshift` (doctor) | "Your shift with {hospital} starts in 1 hour" | "Reminder: your shift with {hospital} starts in 1 hour." |
| `reminder.preshift` (requester) | (not handled) | "Reminder: Dr. {doctorName}'s shift starts in 1 hour." |
| `rating.submitted` (new kind) | n/a | "Thank you for your feedback." (both roles) |

Add `doctorName` to `CanonicalEvent.ctx`; require it for every requester-facing message that references the doctor. Treat a missing `doctorName` or `hospitalName` as a data bug to fix upstream — do not ship "the doctor"/"the hospital" fallbacks anywhere in the planner.

### A2. Haptics that must be REMOVED

Audit 10 reserves haptic for `offer.new` only. Remove the haptic from every other kind in `plan()`:

- `offer.accepted` — medium → none
- `shift.started` — light → none
- `shift.paused` — light → none
- `shift.resumed` — light → none
- `shift.ended` — light-medium → none
- `shift.cancelled` — medium → none

Keep `offer.new` medium haptic for the doctor only.

### A3. Toasts firing from the WRONG event (the End Shift bug, and friends)

`src/features/cover/dispatch.ts` `subscribeNetwork` branch reacts on `ev.action`. When the requester clicks End Shift:
- The server flips `status` to `completed`, but the in-app network event currently surfaces as `action: "update"` first (see `src/lib/network.ts` `completeRequest` — applies no local patch with `action: "complete"`; the doctor side only sees the postgres_changes UPDATE).
- Result: doctor receives "Hospital Y updated your shift" before (or instead of) `shift.ended`.

Fix at the **event-source layer**, not the planner:
- In `network.ts`, when an incoming row update transitions `status` from active/paused → `completed`/`cancelled`, classify the synthesized event as `action: "complete"` / `action: "cancel"` (not `"update"`). This is the single switch that prevents the wrong toast for end-shift.
- Apply the same rule to terminal transitions on `start_shift`, `pause_shift`, `resume_shift`. If the row's status changed, the event MUST carry the lifecycle verb — never the generic `update`.

In `dispatch.ts`, reorder the branch so `complete` / `cancel` are evaluated before `update`. Even with the network fix, this guarantees a stray `update` arriving for a terminal row is dropped (the terminal-kind version ceiling in `feedback.ts` already suppresses it, but defence-in-depth here is cheap).

### A4. Push bodies that must be REPLACED (server side)

`src/lib/coverage-notify.functions.ts`:
- `claimAndNotifyFn` → currently: `"${doctorName} accepted your shift at ${hospital}"`. Replace with `"Dr. ${doctorName} accepted your request."`
- `cancelAndNotifyFn` → currently: `"The doctor cancelled the shift at ${hospital}"` / `"The requester cancelled the shift at ${hospital}"`. Replace with `"Dr. ${doctorName} cancelled the shift."` / `"${hospital} cancelled the shift."`
- `startAndNotifyFn` → push to doctor on `shift.started`. **REMOVE** — `start_shift` is always requester-initiated; doctor is the audience but the doctor-facing in-app toast is the foreground path. Keep a push only for backgrounded doctors using the same wording: `"Your shift with ${hospital} has started."` (no "${requesterName} started your shift" wording — that's not in the contract).

`src/routes/api/public/monnify-webhook.ts`:
- Currently pushes doctor: `"You've been paid ₦X for {hospital}"`. Replace with `"Payment received for your shift with ${hospital}. Remittance will be made by 10PM today."`
- **ADD** a second push for the requester: `"Payment completed successfully for your shift with Dr. ${doctorName}."` Fetch `requester_id` + `doctor name` in the same `select`.

`src/routes/api/public/hooks/shift-reminders.ts`:
- Doctor push: replace `"Your shift starts in 1 hour" / "{hospital} — be ready to clock in."` with title `"Reminder"` body `"Your shift with ${hospital} starts in 1 hour."`
- Requester push: replace `"Shift starts in 1 hour" / "{hospital} — your covering doctor will be ready shortly."` with title `"Reminder"` body `"Reminder: Dr. ${doctorName}'s shift starts in 1 hour."`
- **Multi-day fix**: stop stamping `reminder_sent_at` as a single boolean. Use the existing per-day schedule (compute the per-day `start_ts` for each scheduled day of a multi-day shift) and dedupe against a per-day stamp — either a JSONB array column or a separate `reminder_sent_days` table. The cron must fire once per scheduled day, not once per row.

### A5. Toasts that must be REMOVED

`src/features/cover/dispatch.ts` line ~408–422 — the multi-day pause override (`Day X of N complete — shift with {hospital} moved to Upcoming.` + `Resume on the next scheduled day to continue.`) Remove the override entirely; the planner's new copy ("{hospital} paused your shift until the next scheduled session.") is the only message. The Day-X-of-N visibility belongs in the card UI (Audit 9), not in the toast.

`src/features/request/RequesterHome.tsx` — currently produces zero canonical lifecycle ingests. After Audit 10, the requester is also an audience for `offer.accepted` / `shift.cancelled` (when doctor cancels) / `payment.settled` / `reminder.preshift` / `rating.submitted`. Wire a requester-side mirror of `dispatch.ts` that listens to the same network events and calls `ingest()` with `audience: "requester"`. **Do not** add raw `pushToast` calls for lifecycle events; they bypass dedupe.

### A6. Toasts that must REMAIN unchanged (operational, not lifecycle)

These are out of Audit 10's scope and must not be touched:
- `network.ts` warn toasts for failed RPCs ("Couldn't start this shift" / "Couldn't pause…" / "Couldn't end…") — operational errors, single-channel by definition.
- `RequesterHome.tsx` request-form guards ("Coverage requests start from today", "limited to 14 days", "FlashLocum is only available in Lagos", "Couldn't load that location") — form validation, not lifecycle.
- `RequesterHome.tsx` expiry toast ("No doctor accepted this request in time") — keep; this is the requester's `request.expired` signal and Audit 10 leaves it as-is.
- `CoverHome.tsx` upload/verification toasts ("Re-uploaded", "Refreshing your location…") — operational, presence-related, not in the lifecycle contract.
- `ShiftSettlement.tsx` rating-failure toast ("Couldn't save rating…") — keep as the warn-path; add a new positive path (see A7).

### A7. Notifications that must be ADDED (new outputs required by the contract)

| Event | New output | Where to wire |
|---|---|---|
| `offer.new` background push | "New coverage request available" — only path that uses device sound + vibration | New server fn invoked from the broadcast/dispatch fan-out; recipients = `list_open_coverage_requests` snapshot, gated `online=true` |
| `offer.accepted` requester toast | "Dr. {doctorName} accepted your request." | Requester-side `ingest()` from new `RequesterHome` lifecycle subscriber |
| `shift.updated` doctor push (background only) | "{hospital} updated your shift details." | Extend `coverage-notify` with `updateAndNotifyFn`, called by the requester's update RPC |
| `shift.paused/resumed` doctor push | Match A1 copy | Same place |
| `shift.ended` doctor push | "Your shift with {hospital} has ended. Payment processing has started." | Triggered the moment the requester's End Shift RPC succeeds — push from a new `endAndNotifyFn` wrapper around `end_shift`, mirroring `startAndNotifyFn` |
| `payment.settled` requester push | "Payment completed successfully for your shift with Dr. {doctorName}." | `monnify-webhook` — add second `sendPushToUser` call |
| `rating.submitted` toast | "Thank you for your feedback." | Add new kind to `feedback.ts`; emit from `ShiftSettlement.tsx` on RPC success (both roles) |

### A8. Duplicates and ordering hazards to fix

1. **Foreground push re-ingest.** `push-registration.ts` re-ingests OS push payloads through the in-app engine. Audit 10 requires *exactly one* output per event per recipient. The 6-second dedupe key collapses identical `kind:entityId:version` triples, but server pushes today use `Date.now()` as their version, which won't match the realtime `updatedAt`. **Standardize the version**: every server push must use the row's `updated_at` (epoch ms) as its `version`, identical to the realtime path. Without this, push + realtime are two different versions and both render.
2. **Visibility gate.** Add a single product rule at `ingest()`: if recipient is visible AND `source === "push"`, drop the push (the realtime/local path will own the toast). If recipient is hidden AND `source !== "push"`, render nothing and let the OS banner show. This is the canonical "one channel per event" enforcement; the dedupe ledger remains as belt-and-braces.
3. **Cancellation push asymmetry.** `cancelAndNotifyFn` currently only pushes the counterparty. Audit 10 keeps that rule (self-initiated → silent), so this is already correct — flagged so it isn't "fixed" by mistake.
4. **End-shift double toast.** Fixed by A3 (event classification at the network layer) plus terminal-kind version ceiling already in `feedback.ts`.

---

## Part B — Implementation Order

1. **Planner copy + haptic cleanup** — rewrite `plan()` in `feedback.ts` for every kind in A1, remove haptics per A2, add `doctorName` to `ctx`, add new `rating.submitted` kind.
2. **Event-source classification** — patch `network.ts` so terminal transitions emit `complete` / `cancel` actions, not `update`. Reorder `dispatch.ts` branches so terminal kinds win.
3. **Version standardization** — every server push uses the row's `updated_at` as `version`. Update `coverage-notify.functions.ts`, `monnify-webhook.ts`, `shift-reminders.ts`.
4. **Visibility gate** in `ingest()` — push dropped when foreground, in-app dropped when backgrounded.
5. **Server push body rewrites** — A4 wording changes in `coverage-notify.functions.ts`, `monnify-webhook.ts`, `shift-reminders.ts`.
6. **Add missing outputs** — A7: new `endAndNotifyFn`, `updateAndNotifyFn`, requester-side `payment.settled` push, offer.new background push, rating-submitted toast.
7. **Requester-side lifecycle subscriber** — new module mirroring `dispatch.ts`'s `subscribeNetwork`, scoped to `requester` audience, wired into `RequesterHome`.
8. **Remove dead overrides** — drop the multi-day pause copy override in `dispatch.ts`; drop any `pushToast` lifecycle calls left over after Step 7.
9. **Multi-day reminder per-day fix** — replace single `reminder_sent_at` with per-day stamping.
10. **Verify by walking each lifecycle** on two devices (single-day and multi-day; doctor cancel, requester cancel, payment success). Confirm exactly one feedback outcome per event per recipient.

---

## Part C — Cleanup Report Summary

| Item | Action |
|---|---|
| All current lifecycle copy in `feedback.ts plan()` | REPLACE |
| Haptics on every kind except `offer.new` | REMOVE |
| Multi-day pause toast override in `dispatch.ts` | REMOVE |
| Generic actor wording ("the doctor", "the hospital", "this shift") | REPLACE with real names |
| `shift.updated` firing for end-shift transitions | FIX at event source |
| Server push versions using `Date.now()` | REPLACE with row `updated_at` |
| Foreground OS-push re-ingest with no visibility gate | GATE in `ingest()` |
| Operational warn toasts (network failures, form validation, location, uploads) | KEEP unchanged |
| Request-expiry toast in `RequesterHome` | KEEP unchanged |
| Rating-failure toast in `ShiftSettlement` | KEEP; add rating-success path |
| Requester-side lifecycle ingest (offer.accepted, shift.cancelled, payment.settled, rating, preshift) | ADD |
| Per-day pre-shift reminder for multi-day shifts | ADD |
| Background push for `offer.new` | ADD |

End-state: one canonical planner, one channel per event per recipient, actor-named copy, haptic reserved for the one event that needs it.

**Awaiting approval.**