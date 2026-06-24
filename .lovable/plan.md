## 1. Post-Acceptance Edit Shift — Audit (no changes proposed)

**Trigger.** `src/features/request/RequesterHome.tsx:1655` — "Edit Shift" button on the accepted card calls `openEdit()` → `setEditOpen(true)`, mounting `EditShiftSheet` (`RequesterHome.tsx:1694`).

**Save path.** `EditShiftSheet.onSave` → `handleSaveEdit` (`RequesterHome.tsx:1426-1472`). Behavior when the request is already accepted:
- Lines 1457-1466 call `updateRequest(requestId, { note, start, end, durationHrs, amount, startTs, endTs, days })` — a **field-only patch**. No `status` field, no `broadcastStartedAt`, no `rev` reset.
- Lines 1467-1469 only call `resumeRequest` when `cur.status === "paused" && !cur.acceptedBy`. **Accepted shifts skip resume** — so no `paused → broadcasting` transition is emitted.
- `openEdit` (lines 1410-1422) only calls `pauseRequest` when `cur.status === "broadcasting" && !cur.acceptedBy`. **Accepted shifts are never paused.**

**Network layer.** `updateRequest` (`src/lib/network.ts:887`) → `applyPatch` → `remoteUpdateRequest` writes the patch to `coverage_requests`. Since `status` does not change, the realtime ingester (`network.ts:365-419`) lands in the `oldStatus === newStatus` branch (line 406) and synthesizes an `action: "update"` event **only** when the row is in `broadcasting | accepted | active | paused`. For an accepted row this fires a single `"update"` lifecycle event, ingested by all clients holding the row.

**Which clients hold the row?** `coverage_requests` is RLS-gated. Once `accepted_by` is set, only the requester and the assigned doctor read the row (`coverage-remote.ts:83` ownership filter + `list_open_coverage_requests` excludes accepted rows from the open-pool snapshot — comment at lines 78-79). No other doctor's client receives the UPDATE.

**Push notifications.** A repo-wide grep for `sendPushToUser` in the edit path returns nothing — `coverage-notify.functions.ts` only ships `claimAndNotifyFn`, `cancelAndNotifyFn`, `startAndNotifyFn`. **There is no `editAndNotifyFn`.** The assigned doctor learns about the edit purely through the realtime UPDATE + the local `"update"` lifecycle event; no push is sent to anyone — assigned doctor included.

**Verified answers to your six checks:**

| Check | Result | Evidence |
|---|---|---|
| Update sent only to assigned doctor | ✅ | RLS + `list_open_coverage_requests` exclusion |
| Does NOT rebroadcast | ✅ | `handleSaveEdit` never resumes/republishes accepted rows |
| No new offer created | ✅ | `updateRequest` patches in place; no insert |
| No feed refresh for unrelated doctors | ✅ | open-pool RPC excludes accepted; pool hash unchanged |
| No push to unrelated doctors | ✅ | no push call exists in this path |
| Assigned doctor receives the update + new details | ⚠️ Partial | Realtime UPDATE delivers details and a `"shift.updated"` toast fires; **no push** — if the doctor's app is backgrounded they get nothing until next foreground |

**Manual verification steps (no code change):**
1. Sign in as Requester R and Doctor D in two browsers. R broadcasts; D accepts.
2. Sign in as Doctor D2 on a third browser; confirm the card is gone from D2's feed (it was the moment D accepted).
3. R taps Edit Shift, changes start time, Save & Notify. Watch D — assigned card text updates; toast "Hospital X updated your shift".
4. Watch D2 — no card reappears, no toast.
5. DB check (psql): `select id, status, accepted_by, rev, broadcast_started_at, updated_at from coverage_requests where id = '<id>';` — `status='accepted'`, `accepted_by=D`, `broadcast_started_at` unchanged, `rev` bumped by the field-change trigger only.

> **Gap flagged, not fixed:** the assigned doctor receives no push on post-acceptance edit. Out of scope for this plan; flag it if you want a follow-up.

---

## 2. Post-Acceptance Cancellation Reasons — Implementation Plan

**Current state (audit).** `coverage_requests` has no `cancellation_reason*` column (grep: zero hits). `cancelAndNotifyFn` (`coverage-notify.functions.ts:89-167`) accepts `reason?: string` in its validator but **never writes it** — only `status='cancelled'` and `cancelled_by`. The post-accept `CancelFlow` (`RequesterHome.tsx:1684-1692`) uses the default reasons list but the selected reason is dropped on the client — `handleCancelPostAccept` (line 1485) ignores the `reason` argument and calls `netCancel(id)` with no reason. Doctor-side post-accept cancel (`dispatch.ts:550 cancelUpcoming(id, reason)`) is similar: reason accepted by signature, never persisted.

### 2a. Schema changes (one migration)

```sql
ALTER TABLE public.coverage_requests
  ADD COLUMN cancellation_reason_code text,
  ADD COLUMN cancellation_reason_text text,
  ADD COLUMN cancelled_at timestamptz;

-- Validation trigger (CHECK can't enforce conditional length cleanly):
--   * code required when status='cancelled'
--   * text required when code='other'
--   * code must be in the allowed set per actor
```

Allowed codes:
- Requester: `no_longer_needed`, `schedule_changed`, `wrong_details`, `found_alternative`, `other`
- Doctor: `personal_emergency`, `illness`, `scheduling_conflict`, `travel_issue`, `other`

No new table. Reason lives on the row it describes.

### 2b. Server function changes

Update `cancelAndNotifyFn` input validator to require `{ requestId, reasonCode, reasonText? }` for post-acceptance cancels (`row.accepted_by != null`). Pre-acceptance silent cancel path (`removeRequest`) is untouched. The handler writes `cancellation_reason_code`, `cancellation_reason_text`, `cancelled_at = now()` in the same UPDATE that sets `status='cancelled'`.

Add the same fields to the doctor cancel path used by `dispatch.cancelUpcoming` so doctor-initiated post-accept cancels also persist a reason.

### 2c. UI changes

`CancelFlow` already implements the two-step "Are you sure → Reason" pattern (`src/components/CancelFlow.tsx:55-148`). Required tweaks:
- Add an `otherTextRequired` prop. When the selected reason is `"Other"`, render a `<textarea>` below the list and disable "Confirm Cancellation" until non-empty.
- Pass distinct `reasons={...}` lists for Requester (post-accept) and Doctor (post-accept) — already supported via the `reasons` prop.
- `onCancelled` signature changes to `(reasonCode: string, reasonText?: string)`.
- Map UI labels ↔ stable codes in a shared `src/lib/cancellation-reasons.ts` so server and admin share one source of truth.

Wire `handleCancelPostAccept` (`RequesterHome.tsx:1485`) and `cancelUpcoming` callers (`CoverageScreen.tsx:1305`) to pass the code/text through to the server fn.

Pre-acceptance flow keeps `skipReason` (no change).

### 2d. Admin visibility

Add a new admin view `src/routes/_admin.admin.cancellations.tsx` listing rows where `status='cancelled' AND cancellation_reason_code IS NOT NULL`, columns: Shift ID · Cancelled by (role + name) · Cancelled at · Reason (label from code) · Free-text. Backed by an admin RPC that joins `profiles` for the actor's display name. Add a row link from the existing `_admin.admin.shifts.tsx` detail view.

### 2e. Verification

- Migration applies cleanly; trigger rejects `update set status='cancelled'` without `cancellation_reason_code`.
- E2E: Requester cancels accepted shift → reason sheet appears, "Other" requires text, submit succeeds, DB row has code+text+timestamp, doctor receives existing cancel push (unchanged).
- E2E: Doctor cancels accepted shift → same.
- Admin page lists the row with all five fields visible.

---

## 3. Google Sign-Up — Audit

**Code path.** `src/routes/auth.$role.tsx:274-291` `handleGoogle` calls `lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin })` — the Lovable managed broker, which is the correct API for Lovable Cloud (do not use raw `supabase.auth.signInWithOAuth` for Google). On success `adoptVerifiedSession(auth.session, "SIGNED_IN")` then `proceed()` which runs the same role/onboarding routing as email signup.

**What I can verify from code:** ✅ uses managed broker · ✅ session adoption + `proceed()` routes to `/onboarding/$role` for new users (`_app.tsx` redirects when `isAccountOnboardedProfile` is false) · ✅ role selection persists via `setRole` before profile insert · ✅ `redirect_uri: window.location.origin` works for both `*.lovable.app` and the configured custom domains `app.flashlocum.com` / `admin.flashlocum.com` (broker handles the allowlist).

**What I cannot verify without tools/checks I'm not running in plan mode:**
- Whether the Google provider is currently **enabled** in the Cloud auth config (managed credentials vs disabled). Needs `supabase--configure_social_auth` to assert or `cloud_status` to read.
- Whether the project is using Lovable-managed Google credentials or a custom OAuth client (no env vars set for the latter).
- Mobile deep-linking: `capacitor.config.ts` exists (project ships Capacitor) but the OAuth helper today returns `result.redirected` for a web popup. Native deep-link back into the Capacitor app via `app.flashlocum.com` Universal Links is **not configured in code** — no `appUrlOpen` handler reads OAuth callbacks.

**Recommendation before claiming production-ready:** I will run `supabase--configure_social_auth({ providers: ["google"] })` in build mode (idempotent — enables managed Google if not already) and then perform a live sign-up test via Playwright against the preview to capture: new-user creation, session establishment, role/onboarding redirect, existing-user re-sign-in.

**Mobile deep-link compatibility:** flag as a known gap — needs a `CapacitorApp.addListener('appUrlOpen', …)` bridge in `src/lib/native.ts` that hands the OAuth fragment back to `supabase.auth.exchangeCodeForSession`. Out of scope for this plan; surface as a follow-up.

---

## 4. Email Verification — Audit

**Confirmed: the app already uses a 6-digit CODE, not a magic link.**

Evidence:
- `auth.$role.tsx:160-165` calls `supabase.auth.signUp({ email, password, options: { emailRedirectTo } })`.
- `auth.$role.tsx:242-246` calls `supabase.auth.verifyOtp({ email, token, type: "signup" })`.
- UI copy at line 360: *"We've sent a 6-digit code to {email}. Enter it below to verify your account."*
- Resend path (lines 307-310) uses `supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo } })`.
- `supabase/templates/confirmation.html` renders `{{ .Token }}` as the 32-px letter-spaced 6-digit code (not `{{ .ConfirmationURL }}`). Subject configured in `supabase/config.toml`: *"Your FlashLocum verification code"*.

**Audit trail:**
- Trigger: `auth.$role.tsx:160` (`signUp`) sends the code; `auth.$role.tsx:242` (`verifyOtp`) consumes it.
- Verification status: Supabase `auth.users.email_confirmed_at`; read via `auth.user?.email_confirmed_at` in `auth.$role.tsx:99,110,180,259` and gated in `src/routes/_app.tsx:31-37` which redirects unconfirmed users back to `/auth/$role`.
- Onboarding gate: after `_app.tsx` confirms email, lines 40-78 check `effectiveOnboardedRole`/`getCachedOnboardingStatus` and redirect to `/onboarding/$role` until the profile is marked onboarded — so unverified users cannot reach `/home`.
- Success log: structured `logAuthDebug("verify-otp:succeeded", {...})` at line 256 and `"resend:email-send-accepted"` at line 320.

**`emailRedirectTo` clarification.** It is present in `signUp` and `resend` options but is only used by the magic-link button inside Supabase's default template — the **active template renders `{{ .Token }}`**, so users see a code regardless of whether they also see a fallback link. If you want to fully remove any clickable link, the template at `supabase/templates/confirmation.html` already does not embed `{{ .ConfirmationURL }}`, so nothing further is required. ✅

**No implementation needed.** Code verification is already active. The follow-ups I would recommend:
- Drop the `emailRedirectTo` option from `signUp`/`resend` calls (cosmetic; prevents Supabase from generating a URL the template ignores).
- Add a unit-level assertion (or comment in `confirmation.html`) that `{{ .ConfirmationURL }}` is intentionally excluded so future template edits don't regress to magic-link.

---

## What to approve

Approving this plan authorizes:
1. **No-op** for §1 (audit only — flag the missing assigned-doctor push as a follow-up if desired).
2. **Build §2** in full: migration + trigger + `cancelAndNotifyFn` update + `CancelFlow` "Other" textarea + admin cancellations route.
3. **§3 verification only**: run `supabase--configure_social_auth({ providers: ["google"] })` and a Playwright sign-up e2e against the preview; report findings. Mobile deep-link work stays out of scope.
4. **No-op** for §4 (already correct); optionally remove the unused `emailRedirectTo` options.

Reply "approved" or call out which items to skip / reorder.
