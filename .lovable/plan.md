
## 1. Remove Google sign-up / continue with Google

`src/routes/auth.$role.tsx` is the only consumer.
- Delete `handleGoogle`, the "Continue with Google" button, the divider above it, the `GoogleIcon` component, and the `lovable.auth.signInWithOAuth` import.
- Leave the email/password form and the role layout untouched.
- No backend disable call — the social provider stays available at the Cloud level but the UI no longer reaches it (the user only asked to remove the flow from the app).

## 2. Splash screen

`src/components/SplashScreen.tsx`
- Drop the final `{ text: "FlashLocum", ms: 3000 }` entry from `PHRASES`.
- Keep the existing animation, timing, and `onDone` call so the next screen still mounts immediately after "Let's Cover" finishes.

## 3. Friendly coverage card labels

The "About to request" card reads `pricing.explanation` from `priceFor(...)` in `src/lib/pricing.ts` (lines ~262–303). That string is also what produces lines like `10h day · ₦2,000/hr × 3 days · Busy ×1.25`.

Replacement (UI-only, no pricing math touched):
- Introduce a new helper `coverageLabel({ coverage, totalHours, days, environment })` that returns a single sentence:
  - Standard, single day → `"{H}-hour Single-Day Coverage"` (+ ` (Busy Environment)` when `environment === "busy"`).
  - Standard, multi day → `"{H}-hour Multi-Day Coverage"` using the booked total hours across the span (+ busy suffix).
  - `straight24` → `"24-hour Straight Coverage"` (+ busy suffix).
  - `straight48` → `"48-hour Straight Coverage"` (+ busy suffix).
  - `home` → `"{H}-hour Home Care Coverage"` (busy never applies, per existing rule).
- `priceFor` keeps returning `{ amount, explanation }` so server/audit logs are unchanged, but `SettlementSheet` in `src/features/request/RequesterHome.tsx` renders the new label from `coverageLabel(...)` instead of `pricing.explanation`.
- No other consumer of `explanation` is shown to users in the request flow; admin/audit surfaces keep the technical string.

## 4. Email template branding (FlashLocum, not flashlocum-core)

- `src/routes/lovable/email/auth/preview.ts` and `src/routes/lovable/email/auth/webhook.ts`: change `SITE_NAME` to `"FlashLocum"`. Update `SAMPLE_PROJECT_URL` display copy only if it shows the slug to users (URL itself stays).
- Templates already render `{siteName}`, so the subject lines, preview text, and body copy in `signup.tsx`, `recovery.tsx`, `magic-link.tsx`, `invite.tsx`, `email-change.tsx`, `reauthentication.tsx` will pick up the new name automatically.
- Grep for any remaining `flashlocum-core` literal in the email pipeline and replace with `FlashLocum` (display) — but leave the deployed URL (`flashlocum-core.lovable.app`) alone where it's a real link.

## 5. Toast cleanup

In `src/lib/feedback.ts` (single engine that fans out to `pushToast`):
- `shift.resumed`: drop the toast entirely for **both** sides. Keep haptic + presence-pill update so the UI transition is still felt.
- `shift.updated`: keep as today (this is what fires after a real edit). The doctor-side false positive comes from the resume path re-emitting `shift.updated`; audit `src/lib/coverage-notify.functions.ts` + `src/features/request/RequesterHome.tsx` (resume call site) and make sure resume only emits `shift.resumed` and never also `shift.updated`.
- `offer.new` ("New Incoming Coverage Request"): set `toast: undefined` (the incoming card is already the signal). Haptic stays.

For the duplicated "Your shift with X has ended. Payment processing has started." toast (see attached video):
- Engine already has `TERMINAL_KINDS` + a `lkey` dedup window; the duplication points to multiple emit sites firing with non-matching keys.
- Audit emitters: `coverage-notify.functions.ts` (`shift_ended` broadcast), `ShiftSettlement.tsx` reconcile loop, and the lifecycle watchdog. Consolidate to a single emission keyed on `shiftId + "shift.ended"`, and ignore further `shift.ended` events for that shift id for the lifetime of the session (small in-memory `Set<string>`).
- No change to the user-visible copy or business semantics — payment continues unchanged whether or not the toast fires again.

## 6. In-app OTP password reset

Goal: no email links, no `/reset-password` route landing from a browser link. Flow lives entirely inside the app.

Routes / UI:
- New `src/routes/forgot-password.tsx` (or extend the existing entry point already linked from the sign-in screen) with three steps in a single component:
  1. **Email** input → calls `requestPasswordOtpFn` (server function).
  2. **6-digit code** input (reuse `src/components/ui/input-otp.tsx`) → calls `verifyPasswordOtpFn`.
  3. **New password** input → calls `setNewPasswordFn`.
- Existing `src/routes/reset-password.tsx` (link-based) is removed; any internal `<Link to="/reset-password">` references switch to the new in-app flow.

Server functions (new file `src/lib/password-reset.functions.ts`, all `createServerFn`):
- `requestPasswordOtpFn({ email })` — calls `supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: undefined } })`. This triggers Supabase's recovery/OTP path which we already render via the `signup` (OTP) email template; we'll reuse it by mapping the `recovery` action type in `src/routes/lovable/email/auth/webhook.ts` to the OTP template (`SignupEmail`) so users get a 6-digit code instead of a link.
- `verifyPasswordOtpFn({ email, token })` — `supabase.auth.verifyOtp({ email, token, type: "recovery" })`. Returns the resulting session tokens to the client; the client calls `supabase.auth.setSession(...)` so the next call is authenticated.
- `setNewPasswordFn({ password })` — guarded by `requireSupabaseAuth`, runs `supabase.auth.updateUser({ password })`, then signs out and returns success so the UI navigates to `/role`.

Webhook update:
- `src/routes/lovable/email/auth/webhook.ts`: when `email_action_type === "recovery"`, render `SignupEmail` (which already shows a prominent `{token}` code) instead of `RecoveryEmail`. Update its body copy slightly so it reads as a password-reset code rather than a signup code (small prop tweak — no new template file needed if we generalize `SignupEmail`'s heading; otherwise add a tiny `password-reset.tsx` mirroring `SignupEmail`).
- The link-based `RecoveryEmail` template is retained only as fallback if Supabase forces a magic link (it won't, because we'll request OTP type), but unused in the new flow.

Cleanup:
- Delete `src/routes/reset-password.tsx` and remove `clearRecoveryTokensFromUrl` / `validateResetSessionOnce` callers.
- Remove any `resetPasswordForEmail` call sites that still send magic links.

---

### Out of scope

No pricing math, no shift lifecycle logic, no realtime/ratings/reliability, no Capacitor wiring. The webhook reroute in step 6 only swaps the rendered template for the `recovery` action — it does not change Supabase auth settings or DNS.

### Files touched (summary)

```text
src/routes/auth.$role.tsx                       (#1)
src/components/SplashScreen.tsx                 (#2)
src/lib/pricing.ts                              (#3 helper export)
src/features/request/RequesterHome.tsx          (#3 render)
src/routes/lovable/email/auth/webhook.ts        (#4, #6)
src/routes/lovable/email/auth/preview.ts        (#4)
src/lib/feedback.ts                             (#5)
src/lib/coverage-notify.functions.ts            (#5 dedup audit)
src/features/request/ShiftSettlement.tsx        (#5 dedup audit)
src/routes/forgot-password.tsx                  (#6 new)
src/lib/password-reset.functions.ts             (#6 new)
src/routes/reset-password.tsx                   (#6 deleted)
```
