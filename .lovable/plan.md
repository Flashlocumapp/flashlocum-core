## FLASHLOCUM — Pre-Capacitor Stability Fixes

Fix root-cause state propagation + lifecycle issues identified in testing. No UI workarounds.

---

### 1. Acceptance not reflected on requester

**Root cause:** `coverage_requests` postgres_changes events to the requester are best-effort (RLS-filtered, can be missed during reconnect or replication flush). The `coverage_invalidations` broadcast trigger covers fan-out to doctors but the requester does NOT subscribe to it for their own row, so if the postgres_changes UPDATE is missed the requester stays on "Searching".

**Fix:**
- Have the requester's coverage-remote subscriber also reconcile its own request rows when a `coverage_invalidations` broadcast carrying their `id` arrives (single-row authoritative re-read).
- Audit `acceptRequestAtomic` RPC: ensure it emits the invalidate broadcast even when `realtime.send` is best-effort by relying on the trigger fired on UPDATE; if the trigger short-circuits when `OLD.status = 'searching' AND NEW.status='accepted'` matches the `OR accepted_by IS DISTINCT` condition (it does), confirm by reviewing recent migrations.
- Add a server-anchored short poll (max 4 s, 2 ticks) on the requester's "Searching" screen as a safety net keyed on the request id — fires only while status is still `searching` more than 2s after we expected acceptance (the in-flight broadcast race window).

### 2. Doctor feed doesn't refresh after declining

**Root cause:** `declineIncoming()` only marks the request id locally and calls `bump()`. The "current pending offer" is derived from the legacy `network-snapshot` store via `pendingIncomingId()`, NOT from `coverage-remote`. The second open request lives in `coverage-remote.cachedSnapshot` but is not surfaced into the dispatch portal until something writes it into `network-snapshot`, which only happens on initial broadcast.

**Fix:**
- Replace the legacy `network-snapshot`-backed `pendingIncomingId()` path with a `coverage-remote` subscriber: derive the next pending offer from `cachedSnapshot` filtered by `status === 'searching'`, `accepted_by IS NULL`, conflict-free, and not in local declined-set.
- On `declineIncoming()`, additionally call `reconcileNow()` so any other newly broadcast request not yet in the snapshot is fetched immediately.
- This makes the open pool the single source of truth for the doctor's incoming-offer card and eliminates the "must recreate request" symptom.

### 3. Multi-day payment completion leaves requester on "Connecting…"

**Root cause:** Two issues compound:
1. The Monnify webhook updates `coverage_requests` (status → `completed`) but the requester's postgres_changes filter (`requester_id=eq.<uid>`) can miss the event when the realtime channel is flapping during the long payment redirect. The `coverage_invalidations` broadcast trigger DOES fire, but the requester's handler only reconciles when a row id is present — which it is, so it should work — meaning the bug is the "Connecting…" pill, not the data.
2. The "Connecting…" pill from `realtime-health.ts` is being driven into a stuck state because `invalidations` channel reconnect during the payment redirect leaves health pinned to `reconnecting` while the watchdog waits out backoff, even though the snapshot has already been re-fetched.

**Fix:**
- In `realtime-health.ts`, when a channel transitions to `ok` after a reconnect, clear any latched "connecting" UI immediately and emit a healthy event (don't wait for the next backoff window to clear).
- In `ShiftSettlement`/`CoverageScreen` requester path, on `coverage_invalidations` for our `id` OR on a postgres_changes UPDATE that flips `status → completed`, force-render the settlement/ratings view from the freshly-reconciled row instead of gating on the "live snapshot seen" flag (the flag is for the open pool — it shouldn't gate own-row terminal transitions).
- Add a one-shot post-`endShift` reconcile loop (every 2s, max 8s) on the requester side keyed on the request id, terminating as soon as `status` becomes `completed` or `awaiting_payment → completed`. Pure safety net.

### 4. In-app 1-hour reminder never appears

**Root cause:** `shift-reminders` cron only sends pushes via `notifyUser` (OneSignal/FCM). Foreground push → toast routing requires the service worker to re-ingest into `feedback.ts`, which assumes a registered push subscription. Users without push permission (most web users today) receive nothing while in the app. There is no client-side timer-based foreground reminder.

**Fix:**
- Add a client-side scheduler in `CoverageScreen`/`HomeRouter` that, for every confirmed shift (`accepted | active | paused`) belonging to the current user with `start_ts > now`, sets a `setTimeout` for `start_ts − 60 min`. On fire, route through `feedback.ingest({ kind: "reminder.preshift", entityId: row.id, version: start_ts, ... })` so the existing dedup ledger and toast routing handle it. The server-side push path remains for background delivery; the ledger key (`reminder.preshift:<id>:<start_ts>`) ensures background push + foreground timer can't double-fire.
- Reschedule on snapshot changes, tab focus, and visibility change. Cancel timers on unmount + on row status leaving `accepted/active/paused`.

### 5. Password reset still sends magic link + branding cleanup

**Root cause A (magic link):** `supabase.auth.resetPasswordForEmail(email)` is invoked WITHOUT `options.captchaToken` AND, more importantly, the Supabase project's default `recovery` template (`supabase/templates/confirmation.html`) is still active. Even though our auth hook (`/lovable/email/auth/webhook`) sends an OTP-styled email using the `token` field, Supabase's hook fires alongside its default template only when the hook is set up correctly. The user is receiving the legacy magic-link email, indicating either (a) the auth hook is not registered as the Send Email hook, or (b) we're calling `resetPasswordForEmail` with a `redirectTo` that pushes Supabase to prefer URL-only delivery.

**Fix:**
- Confirm the Send Email hook is registered for this project. If not, scaffold it via the managed email tool so all six templates (including `recovery`) route through our webhook with the `token` field — the recovery template already renders the 6-digit code.
- Replace the unused `supabase/templates/confirmation.html` legacy template references in `supabase/config.toml` with empty defaults (or remove `template.recovery` overrides) so Supabase falls back to the hook payload exclusively.
- Continue calling `supabase.auth.resetPasswordForEmail(email)` with NO `redirectTo` so the OTP path is preferred.
- After hook reconciliation, verify by sending a reset to a test account and reading the email.

**Root cause B (branding):** Stale `flashlocum-core` references remain in:
- `capacitor.config.ts:33`
- `src/routes/terms-of-service.tsx` (og:url + canonical)
- `src/routes/privacy-policy.tsx` (og:url + canonical)
- `src/routes/lovable/email/auth/preview.ts` (`SAMPLE_PROJECT_URL`)

**Fix:** Replace `flashlocum-core.lovable.app` → `app.flashlocum.com` everywhere user-facing (the published custom domain). Keep the lovable.app URL internally only where used as a stable pg_cron callback (none of the above are).

---

### Files to edit

- `src/lib/coverage-remote.ts` — requester reconcile on invalidate for own rows; safety net poller helpers
- `src/lib/realtime-health.ts` — clear "connecting" pill the moment a channel becomes ok
- `src/features/cover/dispatch.ts` + `src/features/cover/CoverDispatchPortal.tsx` — derive pending offer from coverage-remote, reconcile on decline
- `src/features/request/RequesterHome.tsx` + `src/features/app/CoverageScreen.tsx` — terminal-state surfacing for requester, post-`endShift` short poll, client-side 1h reminder scheduler
- `src/features/cover/CoverHome.tsx` (or equivalent) — same client-side 1h reminder scheduler for doctor's accepted shifts
- `src/lib/feedback.ts` — confirm `reminder.preshift` ledger key uses `entityId:version` so timer + push are deduped
- `capacitor.config.ts`, `src/routes/terms-of-service.tsx`, `src/routes/privacy-policy.tsx`, `src/routes/lovable/email/auth/preview.ts` — replace `flashlocum-core.lovable.app` → `app.flashlocum.com`
- `supabase/config.toml` (or scaffold auth email templates) — ensure recovery routes through the OTP hook, not the legacy magic-link template

### Verification (after build)

1. Two browsers: requester creates request → second browser doctor accepts → requester flips to Accepted within 2 s with no refresh.
2. Two requesters create back-to-back → doctor declines first → second appears immediately.
3. End a multi-day shift → requester moves to Ratings/Payment Summary with no "Connecting…" hang.
4. Schedule a shift 61 minutes ahead → both sides receive in-app reminder toast at T-60.
5. Trigger password reset → email contains a 6-digit code only.
6. `rg flashlocum-core` returns zero hits.