## FLASHLOCUM AUDIT — FIX PLAN (revised)

Audit 4 origin confirmed by user: the ₦62,000 the UI displayed was a **stale cached Monnify virtual account from a prior pre-quoted booking**. Monnify accepted the actual ₦8,000 transfer because it matched on `paymentReference`, not amount. No further reproduction work needed.

---

### AUDIT 1 — Online doctors not visible to some requesters

**Root cause.** RLS on `public.doctor_presence` requires the viewing requester to already have a `coverage_requests` row with `accepted_by = doctor_presence.user_id`. New requesters never satisfy the EXISTS clause, so `subscribePresence()` returns 0 rows. Compounding: `public.profiles` SELECT is self/admin-only, so `presence-remote.ts`'s lazy `verification_status` lookup also returns nothing → `approvedIds` stays empty → `buildSnapshot()` filters every doctor out.

**Fix.**
1. New `SECURITY DEFINER` RPC `public.list_online_approved_doctors()` returning only safe presence columns (`user_id, online, last_seen, lat, lng`) joined to `profiles.verification_status='approved'`.
2. Replace the `doctor_presence` SELECT policy with one that allows any authenticated user to read `online=true` rows for approved doctors only (still restrictive for offline rows and unapproved doctors).
3. `presence-remote.ts` switches its initial fetch to the RPC and drops the lazy `profiles` batch lookup.

---

### AUDIT 2 — User location icons change after request creation  *(revised per user constraints)*

**Root cause.** `doctor_presence` carries no real geolocation. `GoogleMapBackground.tsx:328-334` synthesizes marker positions **relative to `center`**:
```
lat = center.lat + (0.5 - m.top) * 0.03
lng = center.lng + (m.left - 0.5) * 0.03
```
`center` flips from the requester's GPS fix to the selected hospital when a request is created (`RequesterHome.tsx:358-361`), so every doctor marker re-anchors around the hospital even though no doctor moved.

**Fix — event-driven only. No continuous GPS, no `watchPosition`, no background tracking, no Capacitor background-geolocation plugins.**

1. Schema: add `lat double precision`, `lng double precision` to `doctor_presence` (nullable).
2. Doctor app captures GPS via a single `navigator.geolocation.getCurrentPosition` call and writes via `upsertMyPresence({ lat, lng })` on **exactly** these triggers:
   - **App open / mount** of the doctor home screen.
   - **Sign-in** (after auth resolves to a `cover` role).
   - **Doctor toggles Online** on.
   - **Manual "Refresh location" control** on the online card (new small button).
   - **Optional low-frequency tick: every 20 minutes** while `online=true` AND `document.visibilityState==='visible'`. `setInterval` is cleared on offline, unmount, sign-out, and `visibilitychange→hidden`. No timer faster than this.
3. If GPS permission is denied or `getCurrentPosition` errors, presence still writes `online=true` with `lat/lng = NULL`. The map simply omits that doctor's marker — no fake/synthesized position.
4. `GoogleMapBackground.tsx` renders each doctor marker at its **absolute** `lat/lng`. `center` becomes camera-only — selecting a hospital pans the camera but **never relocates any user icon**. The requester's self-marker stays anchored to `userCenter` (their own GPS), not to `center`.

### Sign-out → Offline (new, per user request)

5. On `SIGNED_OUT` (and on explicit sign-out button), call `clearMyPresence()` which already flips `online=false` and bumps `last_seen`. Add: also send a synchronous best-effort `online=false` write on `beforeunload`/`pagehide` using `navigator.sendBeacon` so a tab close also removes the doctor.
6. `STALE_MS` stay-fresh window in `presence-remote.ts` remains 60 s — combined with (5), a signed-out doctor disappears from every requester's "Online Doctors" within at most one realtime tick (sub-second in practice) and, worst case, within 60 s if the network drops the offline write.
7. Auth listener in `__root.tsx` already runs `unregisterDoctor()` on SIGNED_OUT; we wire `clearMyPresence()` into that same path so presence is always cleared before the cache teardown.

---

### AUDIT 3 — Edit Request only hides the doctor card once

**Root cause.** Stale guards in `network.ts:1040-1079`.

1. First Edit open → `pauseRequest` writes `status='paused'`. ✅
2. Close + save → `resumeRequest` sets `status='broadcasting'`, then `updateRequest` triggers `bump_request_rev_on_change`. The realtime echo round-trips a row whose `startedAt` / `accumulatedMs` are now non-null/non-zero.
3. Second Edit open → `pauseRequest` short-circuits on `if (cur.acceptedBy || cur.startedAt != null) return;` (and `resumeRequest` short-circuits on `accumulatedMs > 0`). No UPDATE is sent. Server stays `searching`. Doctor card stays visible.

Race: `handleEditSave` calls `updateRequest` after `setEditOpen(false)`; the resume UPDATE and the material-edit UPDATE collapse into one bump-rev echo that overwrites the next click's optimistic state.

**Fix.**
1. Drop the `startedAt`/`accumulatedMs`/`acceptedBy` guards in `pauseRequest`/`resumeRequest` for the pre-acceptance broadcast path. Keep only "no-op if status already matches target".
2. Invoke pause/resume from explicit `onOpen` / `onDismiss` handlers on the edit sheet, not via a `net`-dependent `useEffect`.
3. In `handleEditSave`, run the material-field UPDATE first, then re-broadcast, so `bump_request_rev_on_change` does not race the resume.

---

### AUDIT 4 — Monnify ₦62,000 mismatch (origin confirmed)

Two values exist per coverage request:

| Column | Meaning | Set by |
|---|---|---|
| `amount` | Quoted full booking total (per-day rate × hours × days) | request creation (`_lock_rate_on_insert` + `compute_quote`) |
| `total_billed_amount` | Actually-worked total after `end_shift` | `end_shift` from `shift_segments.billed_amount` |

Live DB evidence — three June 19 rows from before the safeguards landed:

| id | days | per-day | env | `amount` | `total_billed_amount` |
|---|---|---|---|---|---|
| 7300ac18… | 3 | 8AM–6PM (10h) | normal | **₦60,000** | ₦6,000 |
| 85eaadb4… | 3 | 8AM–6PM (10h) | normal | **₦60,000** | ₦6,000 |
| 605f3ac8… | 3 | 8AM–6PM (10h) | normal | **₦60,000** | ₦6,000 |

`amount = days × per_day_hours × tier_rate`. A 4-day equivalent at 8AM–3:45PM (7.75 h × ₦2,000 × 4) = **₦62,000** — the exact figure on the screenshot.

**How ₦62,000 reached the Monnify virtual account (now user-confirmed):**

1. Pre-fix `beginSettlementCheckout` read (or fell back to) `coverage_requests.amount`, called `initiateSplitTransaction({ amount: 62000, … })`, then `initBankTransferAccount(txRef)` minted the Monnify virtual account at ₦62,000 and persisted the full account JSON into `coverage_requests.payment_account`.
2. `end_shift` later wrote `total_billed_amount = 8,000`. There was no DB trigger to clear the cached `payment_account` and no amount-match guard in the RESUME-IF-PENDING branch, so subsequent opens returned the same ₦62,000 cached virtual account verbatim.
3. The user transferred the backend-authoritative ₦8,000; Monnify matched the webhook on `paymentReference` (not amount), so the shift completed and rated correctly while the UI kept showing ₦62,000.

**What the current code already prevents:**
- `settlement.functions.ts:44-47` requires `billing_locked_at` AND `total_billed_amount > 0`; quoted `amount` is never read.
- `settlement.functions.ts:55-89` requires `Math.round(cachedAmount) === serverAmount` to reuse cached `payment_account`; otherwise mints fresh at current `total_billed_amount`.
- DB trigger `trg_invalidate_payment_cache` (BEFORE UPDATE OF `total_billed_amount`) clears `payment_account`/`payment_reference`/`payment_url` on every amount change.

**Evidence the screenshot cannot recur today:**
- Most recent 4-day completed shift `77f19c65…` → 4 segments × ₦2,000, `total_billed_amount=8,000`, cached `payment_account.amount=8,000`, paid ₦8,000.
- `WHERE (payment_account->>'amount')::numeric BETWEEN 50000 AND 80000` → **0 rows** project-wide.
- `WHERE total_billed_amount <> (payment_account->>'amount')::numeric AND payment_account IS NOT NULL` → **0 rows**.

**Fix.** No production code change. Add a regression test that:
1. Creates a 4-day standard shift whose quoted `amount` is far larger than the eventual `total_billed_amount`.
2. Runs `start → pause → resume × N → end`.
3. Asserts `Σ(segment.billed_amount) == total_billed_amount == payment_account.amount == amount-sent-to-Monnify`.
4. Manually corrupts `payment_account.amount` to ₦62,000 and confirms the next `beginSettlementCheckout` discards the cache and mints fresh.

---

## Implementation Order

1. **Audit 1** — RLS + `SECURITY DEFINER` RPC, then trim `presence-remote.ts`.
2. **Audit 2** — `doctor_presence` lat/lng migration + event-driven GPS writes (app open / sign-in / online toggle / manual refresh / 20-min foreground tick) + sign-out auto-offline (incl. `pagehide` beacon) + absolute-coordinate markers.
3. **Audit 3** — Drop stale guards in `network.ts`; explicit pause/resume in edit-sheet handlers.
4. **Audit 4** — Regression test only.

**Awaiting approval before implementing.**