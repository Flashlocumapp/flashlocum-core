# Admin Dashboard — Approved Operational Gap Closure

Scope: 6 capabilities. Excluded (not approved): Payment Investigation Tools, Notification Logs.

Approach: extend existing admin routes. No new sidebar entries. No parallel workflows.

---

## 0. Foundation — Audit log table (enables §6)

Extend `admin_payment_actions` into a generic admin action log (or add sibling `admin_actions` — one migration, whichever keeps existing rows intact).

Columns: `actor_user_id`, `action`, `target_user_id`, `target_shift_id`, `target_payment_ref`, `reason`, `note`, `payload jsonb`, `created_at`.

Every admin write across the console inserts one row before returning. Backfilled call sites: verification approve/reject/suspend/request-action, trust restrict/clear/freeze/escalate, shift force-cancel/force-complete/extend-window/lift-cap/mark-paid, payment refund/write-off/record-offline, push send.

RLS: admin-only SELECT via `has_role(auth.uid(),'admin')`. GRANTs to authenticated + service_role.

---

## 1. User Detail Drawer  *(new)*

Opened by clicking any user row in `/admin/users`, and reused from Verification, Trust, Cancellations, Ratings, and Shifts row clicks.

Tabs (all read-only):
- **Overview** — profile, contact, area, surfaces, joined, last seen, online state.
- **Verification** — current state + history (reuses §4).
- **Shifts** — paginated list filtered to this user (extend `adminListShifts` with `userId`).
- **Payments** — their settled / unpaid shifts with Monnify refs.
- **Ratings** — given and received (filter `adminListRatings`).
- **Cancellations** — by/against (filter `adminListCancellations`).
- **Restrictions** — current state + history (reuses §5).
- **Devices** — `device_tokens` rows (platform, last_seen).
- **Audit** — every admin action targeting this user (from §0).

New server fn: `adminGetUserDetail({ userId })` returning a composed profile + counts payload. Per-tab data lazy-loaded via existing list fns extended with `userId` filter.

---

## 2. Shift Detail Drawer  *(extend existing RatingDetailDrawer)*

`/admin/shifts` already opens a drawer with `RatingBlock` only. Replace its body with tabs:

- **Timeline** — created → broadcast → accepted → started → paused/resumed (from `shift_segments`) → ended → billing_locked → paid → settled. Each event with timestamp.
- **Parties** — requester + doctor cards that open the User drawer (§1).
- **Billing** — coverage_type, environment, days, start/end, worked_min, paused_total, segments table, surcharge ticks (`payment_surcharge_log`), frozen total, base/surcharge breakdown.
- **Payment** — Monnify ref, webhook receipts list, disbursement status, underpayment record if any. (Read-only view of the same data §3 surfaces from Unpaid; no action buttons here.)
- **Ratings** — keep current `RatingBlock` pair.
- **Cancellation** — reason + free text + actor if cancelled.
- **Admin actions** — Force-cancel, Force-complete, Extend payment window (+15 min), Lift 24h surcharge cap, Mark paid manually (with reason). Each writes an audit row (§0).

Filters: add `paused` and `awaiting_payment` to the existing status pills. Add a copyable shift-ID column.

New server fns: `adminGetShiftDetail({ shiftId })`, `adminShiftForceCancel`, `adminShiftForceComplete`, `adminShiftExtendPaymentWindow`, `adminShiftLiftSurchargeCap`, `adminShiftMarkPaid`.

---

## 3. Payment Detail Drawer  *(new)*

Opened from `/admin/unpaid` rows and from the Shift drawer's Payment tab.

Sections:
- Monnify checkout reference + init timestamp.
- Webhook receipts (timestamps + status) from existing webhook log surface.
- Settlement disbursement: reference, 85/15 split, status, attempt count.
- Surcharge tick history (`payment_surcharge_log`).
- Underpayment record if any (`payment_underpayments`).
- `admin_payment_actions` history for this shift.

Actions: **Reconcile now** (one-shot Monnify poll), **Initiate refund** (with reason), **Write off** (with reason), **Record offline settlement** (amount + note). All write to audit log (§0).

Unpaid table additions: Monnify ref column, last-webhook-seen column.

New server fns: `adminGetPaymentDetail({ shiftId })`, `adminPaymentReconcile`, `adminPaymentRefund`, `adminPaymentWriteOff`, `adminPaymentRecordOffline`.

---

## 4. Verification Document Visibility  *(extend `/admin/verification`)*

Today: approve/reject/suspend/request-action with reason/target/note. Files are uploaded but not previewed; no per-doctor history.

Extend the verification row in place:
- Inline thumbnails for medical license, MDCN card, NYSC document, selfie. Click to enlarge. Signed URLs cached via existing `selfie-url` helper.
- MDCN external-validation badge (auto-check result if available, else "Manual review").
- Bank validation badge from Monnify account-name match result.
- **History panel** per doctor: every state change with actor, timestamp, reason, target, note — sourced from §0 audit rows written by `updateDoctorVerificationFn` (which we extend to log).

New server fn: `adminGetVerificationDetail({ userId })` returning signed file URLs + history. Surfaced in the User drawer's Verification tab too.

---

## 5. Restriction History  *(extend `/admin/trust`)*

Today: current rating / reliability / flagged/restricted, restrict + clear actions. `trust_blocks` exists but is not surfaced; no history.

Extend `/admin/trust`:
- Per-row History disclosure: every restrict / clear / freeze / escalate event (actor, timestamp, reason).
- `trust_blocks` panel inside the row: each reliability block with completed/cancelled/no-show counts.
- Outstanding-balance line (sum of unpaid for this user).
- New actions: **Freeze** (soft — blocks new bookings, allows active shifts to finish), **Escalate** (mark for senior review with note), **Set expiry** on restriction. Implemented via `admin_apply_trust_restriction` extended with `mode` + `expires_at`, or sibling RPCs.

New server fns / RPCs: `admin_list_trust_history({ user_id })`, `admin_freeze_user`, `admin_escalate_user`. Surfaced inside the User drawer's Restrictions tab.

---

## 6. Audit Logs  *(surface §0)*

Two surfaces, no new sidebar entry:
- **`/admin/system`** — full audit table with filters by actor, target, action type, time range. CSV export.
- **Scoped views** inside the User drawer (Audit tab) and Shift drawer (Admin actions tab).

New server fn: `adminListActions({ filters })`. Every admin write fn from §1–§5 inserts one row before returning.

---

## Cross-cutting

- All new server fns use the existing `requireSupabaseAuth` + admin role-check pattern from `src/lib/admin.functions.ts`.
- New RPCs ship with GRANTs + RLS scoped via `has_role(auth.uid(),'admin')`.
- Drawers are pure client components in `src/components/admin/`, keyed by entity id via TanStack Query.
- Tables get a small "Actions" column or inline disclosure — never a new screen.

## Delivery order

1. §0 audit-log table + write-through from existing actions.
2. §2 Shift Detail Drawer (extends the ratings drawer that already exists).
3. §1 User Detail Drawer (reuses §2, §4, §5, §6 panels).
4. §3 Payment Detail Drawer + Unpaid integration.
5. §4 Verification document previews + history.
6. §5 Restriction history + freeze/escalate.
7. §6 Audit log surface in `/admin/system` + CSV export.

Outcome: support, verification, payment investigation, restriction, and shift investigation are completable from the dashboard with no direct DB access.
