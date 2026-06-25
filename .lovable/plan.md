# Plan — Reconnecting pill, OTP email, OneSignal readiness (minimal)

## 1. Requester "Reconnecting…" pill stays visible

**Root cause:** `ReconnectingPill` in `src/features/app/CoverageScreen.tsx` uses `isAnyReconnecting(h)`, which OR's all three channels including `presence`. On the requester side the `presence` channel never reaches `SUBSCRIBED`, so the pill stays on forever.

**Fix:**
- Add `isCoverageReconnecting(h)` to `src/lib/realtime-health.ts` — true only when `coverage` or `invalidations` is unhealthy. Presence excluded (it's a doctor-roster signal).
- `CoverageScreen.tsx` `ReconnectingPill` switches to `isCoverageReconnecting`.
- `isAnyReconnecting` kept for any future doctor-only surface that genuinely depends on presence.

## 2. Sign-up email shows a link instead of the 6-digit code

**Root cause:** Lovable Auth Emails intercept via `src/routes/lovable/email/auth/webhook.ts` and render `src/lib/email-templates/signup.tsx`, which renders a `Verify Email` button. The OTP `token` is already passed to the component (webhook line 140) but the component ignores it.

**Fix:**
- Update `src/lib/email-templates/signup.tsx`:
  - Add `token: string` to props.
  - Drop the `Button` + `confirmationUrl` UI.
  - Render the 6-digit code in a large, letter-spaced block matching the look of `supabase/templates/confirmation.html`.
- No webhook / Supabase template change needed.
- Other auth templates untouched.

## 3. OneSignal readiness — minimal preparation (no OneSignal yet)

Per your scope: only a provider abstraction layer + a documented event catalog. **Not adding** `notification_prefs` table or `device_tokens.provider` column.

### A. Provider abstraction — `src/lib/notify.server.ts`

New thin file. Exports a single function:

```ts
export async function notifyUser(
  userId: string,
  payload: PushPayload,
  opts?: { skipOutbox?: boolean },
): Promise<void>
```

Implementation today: forwards directly to `sendPushToUser` from `push.server.ts`. When OneSignal lands, this file is the only swap point — replace the body with the OneSignal call. No call site changes required at that time.

All existing call sites migrate to `notifyUser` from `notify.server.ts`:
- `src/lib/coverage-notify.functions.ts` (3 call sites)
- `src/lib/admin.functions.ts` (2 call sites)
- `src/routes/api/public/monnify-webhook.ts`
- `src/routes/api/public/monnify-disbursement-webhook.ts`
- `src/routes/api/public/hooks/shift-reminders.ts` (2 call sites)
- `src/routes/api/public/hooks/reconcile-settlements.ts`
- `src/routes/api/public/hooks/outbox-drain.ts` (drain keeps importing `sendPushToUser` directly since it owns the FCM-specific failure semantics; will be refactored when OneSignal swap happens)

`push.server.ts` stays as the FCM adapter — unchanged behavior, outbox semantics preserved.

### B. Canonical event catalog — `mem://constraints/notification-events.md`

A single project-memory file documenting the locked event kinds. OneSignal templates / tags will key off these names, so locking them now prevents drift:

- `offer.new` — new coverage request broadcast to eligible doctors
- `shift.accepted` — doctor accepted a request (notify requester)
- `shift.started` / `shift.paused` / `shift.resumed` / `shift.ended`
- `shift.cancelled` — by either party
- `payment.completed` — successful Monnify collection
- `payment.disbursed` — Monnify split-payout to doctor confirmed
- `rating.submitted`
- `reminder.shift_starting` / `reminder.shift_ending` / `reminder.payment_due`
- `verification.approved` / `verification.rejected`

Each line: kind, audience (doctor / requester / both), trigger (DB trigger or server fn), and the canonical `entityId` shape (`coverage_request.id` in all cases except `offer.new` which uses the offer/request id, and `verification.*` which uses `user_id`).

Index updated to reference the new memory.

## Files touched

- `src/lib/realtime-health.ts` — add `isCoverageReconnecting`
- `src/features/app/CoverageScreen.tsx` — pill condition
- `src/lib/email-templates/signup.tsx` — OTP, drop button
- `src/lib/notify.server.ts` *(new)* — provider abstraction wrapping `sendPushToUser`
- `src/lib/coverage-notify.functions.ts`, `src/lib/admin.functions.ts`, `src/routes/api/public/monnify-webhook.ts`, `src/routes/api/public/monnify-disbursement-webhook.ts`, `src/routes/api/public/hooks/shift-reminders.ts`, `src/routes/api/public/hooks/reconcile-settlements.ts` — switch to `notifyUser`
- `mem://constraints/notification-events.md` *(new)* + index update

## Explicitly out of scope (per your instruction)

- No `notification_prefs` table
- No `device_tokens.provider` column
- No OneSignal SDK / REST integration
- No in-app notifications center / email / SMS adapters
