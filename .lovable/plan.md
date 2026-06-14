## FlashLocum Backend Authority Migration

Backend (Postgres + TanStack server fns) becomes the single source of truth for time, pricing, billing, payment windows, multi-day settlement, and account restrictions. Frontend only collects inputs and renders server results.

### 1. Schema migration

**`coverage_requests` — new columns**
- `environment text not null default 'normal' check (environment in ('normal','busy'))`
- `payment_due_at timestamptz` — set at end-shift; +15 min from server `now()`
- `payment_extension_count int not null default 0`
- `last_extended_at timestamptz`
- `total_billed_amount numeric` — authoritative final amount (overrides client `settled_amount`)
- `billing_locked_at timestamptz` — once set, pricing fields are frozen

**`profiles` — new column**
- `payment_restricted_at timestamptz` — when set, user cannot create/end shifts

**New table: `shift_segments`** (per pause/resume cycle for multi-day)
```
id uuid pk, request_id uuid fk coverage_requests, segment_index int,
started_at timestamptz, ended_at timestamptz,
billed_minutes int, billed_amount numeric, settled_at timestamptz,
created_at timestamptz default now()
```
Plus GRANTs + RLS (requester or assigned doctor can read; only service_role writes).

### 2. New SECURITY DEFINER RPCs

All read server time via `now()` (DB is `Africa/Lagos` per project setting — confirm in migration; force `SET TIME ZONE 'Africa/Lagos'` inside each fn).

- `server_now()` → `timestamptz` (client clock-skew probe)
- `validate_shift_schedule(_start timestamptz, _end timestamptz)` → throws if past, <30min lead, or end<=start
- `compute_quote(_start, _end, _environment, _coverage_kind)` → `{ amount, breakdown jsonb }` — new rate table
- `start_shift(_request_id)` → requester-only; stamps `started_at = now()`
- `pause_shift(_request_id)` → bills current segment, inserts `shift_segments` row, opens settlement window for that segment
- `resume_shift(_request_id)` → guard: previous segment must be `settled_at NOT NULL`
- `end_shift(_request_id)` → final segment + `billing_locked_at = now()`, `payment_due_at = now() + 15min`, returns `{ total_billed_amount, payment_due_at }`
- `extend_payment_window(_request_id)` → if `now() > payment_due_at` and unpaid: add 15-min billing block, recalc total, push `payment_due_at += 15min`, ++extension_count
- `apply_payment_restriction()` — cron-ish; called on each shift action to lazily set `profiles.payment_restricted_at` for users with overdue unpaid shifts
- `mark_settlement_paid` — extend existing to also clear `payment_restricted_at` if user has no other overdue shifts and to mark segment `settled_at`

### 3. New pricing engine (server-side, SQL)

Replaces `src/lib/pricing.ts` as authority. Bands: **day 06:00–22:00, night 22:00–06:00** (per new spec).

Per-shift duration buckets (bucket chosen from per-day hours):
- `>=6h`: day ₦2,000/hr, night ₦1,500/hr
- `4–<6h`: day ₦2,500/hr, night ₦2,000/hr
- `<4h`: day ₦3,000/hr, night ₦2,500/hr

Fixed: 24h → ₦36,000, 48h → ₦72,000.
Home Care: ₦15,000/hr (kept from current).

Rounding:
- Round worked minutes UP to 15-min blocks
- Minimum bill = 60 min
- Final-hour rule: if within ±15 min of booked duration, round to full booked hours

Busy multiplier ×1.25 applied AFTER hourly calc, BEFORE fee split.

Fee: doctor 85% / FlashLocum 15% (already wired in Monnify split).

### 4. Server functions (TanStack)

`src/lib/shift.functions.ts` (new) — all `requireSupabaseAuth`:
- `getServerNow` (no auth needed — public)
- `quoteShift({ start, end, environment, coverageKind })`
- `validateSchedule({ start, end })`
- `startShift({ requestId })`
- `pauseShift({ requestId })`
- `resumeShift({ requestId })`
- `endShift({ requestId })` → returns `{ totalAmount, paymentDueAt }`
- `requestPaymentExtension({ requestId })` — called by client when countdown hits 0 and still unpaid
- `getRequestBillingState({ requestId })` — polled by Settlement screen

`src/lib/account.functions.ts`:
- `getMyPaymentRestriction()` — returns `{ restricted: bool, overdueRequests: [...] }`

### 5. Frontend changes

**Delete client-side calculations**:
- `src/lib/pricing.ts` → keep only `coverageKindFromLabel` + types; mark all compute fns deprecated, route through server.
- `src/lib/clock.ts` `simNow()` → stays for dev sim, but **never** used for billing. Add big comment.

**RequesterHome / booking flow**:
- Date picker: server-time gated (call `getServerNow` on mount, disable past dates and times < server_now+30min)
- Add **Environment** toggle (Normal / Busy) — radio in booking form
- Live quote: debounced `quoteShift` call → show server-returned amount/breakdown
- Block submit if `getMyPaymentRestriction().restricted`

**ShiftSettlement.tsx**:
- On render, poll `getRequestBillingState` every 3s
- Display server `total_billed_amount` + `payment_due_at` countdown
- When countdown hits 0 and unpaid: auto-call `requestPaymentExtension`, show new amount + new 15min timer
- For multi-day: each pause triggers settlement of that segment (show segment list)

**CoverageScreen / pause/resume buttons** (requester-only — hide for doctor):
- All controls call server fns; doctor sees read-only state

**Account restriction banner**:
- Global `<RestrictionBanner />` mounted in `_app` layout; shows when restricted with list of overdue shifts

### 6. Rate replacement

Drop existing `RATE_DAY=2000 (8–22)` / `RATE_NIGHT=1500 (22–8)` model in favor of new bands + buckets above. Update `src/lib/pricing.ts` to call server, keep `computeCoveragePricing` only as a thin client-side estimate that's clearly labeled "estimate — server is authoritative", or remove entirely.

### 7. Multi-day per-pause settlement

- `pause_shift` immediately closes segment, returns its amount, opens 15-min payment window for that segment alone
- `resume_shift` blocked until prior segment paid (server-enforced)
- Each segment payment goes through existing Monnify flow with its own `payment_reference`

### 8. Migration order

1. Schema migration (tables, columns, RPCs, RLS, GRANTs)
2. Server fn files
3. Frontend rewrite (booking → settlement → restriction banner)
4. Deprecate `src/lib/pricing.ts` compute paths

### Notes / open risks

- **Timezone**: confirm DB session TZ. Will `SET LOCAL TIME ZONE 'Africa/Lagos'` at the start of each pricing/scheduling RPC to be safe.
- **Sim clock**: dev fast-forward (`src/lib/clock.ts`) won't move server time. Real server time will govern billing in dev too — pause/resume/end timing in dev will reflect wall clock, not the sim slider. Acceptable trade-off for backend-authority.
- **Existing `settled_amount`** column stays as legacy display; `total_billed_amount` is the new authority.
- **Monnify webhook** already updates `payment_status='paid'`; needs to also clear segment-level `settled_at` when applicable + clear `payment_restricted_at`.

### Scope NOT in this round

- Admin UI for managing unpaid shifts (data is there, UI later)
- Push notifications for payment-window expiry
- Retroactive cleanup of in-flight shifts (will require user to end-shift normally)

Confirm and I'll ship the migration + server fns first, then the frontend.