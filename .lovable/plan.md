# Pricing Hardening Plan

Fixes the five gaps from the audit, in priority order. Each phase is independently shippable; later phases depend on earlier ones.

---

## Phase 1 — Close the financial gap in `mark_settlement_paid` (CRITICAL)

**Problem:** Webhook-supplied `_amount` is accepted without comparison to `total_billed_amount`. A forged or replayed webhook with a smaller amount marks the shift fully paid.

**Fix (migration):**
- Rewrite `mark_settlement_paid(_payment_reference, _amount)`:
  - Load row `FOR UPDATE`; read `expected := total_billed_amount`.
  - If `_amount < expected` → do NOT set `payment_status='paid'`. Instead insert an audit row in a new `payment_underpayments` table and return `false`. The webhook handler logs and exits 200 (so Monnify stops retrying) but the shift stays unpaid.
  - If `_amount >= expected` → proceed exactly as today; `settled_amount := expected` (never the caller's amount).
- New table `public.payment_underpayments(id, request_id, payment_reference, expected_amount, received_amount, received_at, raw jsonb)` with RLS: only admin SELECT; service_role full; no anon. GRANTs included.

**No client changes.** Monnify webhook keeps its current shape.

---

## Phase 2 — Per-request rate snapshot (immutability)

**Problem:** Past requests preserve `total_billed_amount` only by accident; the rate table that produced it is not recorded, so a future rate change makes prior bills unauditable and silently re-prices in-flight quotes.

**Fix (migration):**
- Add columns to `coverage_requests`:
  - `pricing_version_id uuid` (FK to `pricing_versions.id`, nullable for legacy rows)
  - `rate_snapshot jsonb` — `{tier, rate_day, rate_night, busy_mult, product, billable_min, booked_per_day_min, d_billable, n_billable, tolerance_fired}`
- `end_shift` writes both alongside `total_billed_amount`.
- `compute_quote` returns `pricing_version_id` in its breakdown so the UI can show "Quoted at rate vNNN".
- Quotes recomputed on edit continue to use the **current active** `pricing_version_id`; that's correct (in-flight, unstarted). Once `end_shift` runs, the snapshot is frozen.

---

## Phase 3 — DB-backed pricing table (single source of truth + admin control)

**Problem:** Rates live in SQL literals and `src/lib/pricing.ts`. Two engines, manual sync, no admin control.

**Fix (migration):**
- New tables:
  - `pricing_versions(id, label, effective_at, created_by, created_at, notes, is_active boolean)` — only one `is_active=true` row at a time, enforced by a partial unique index.
  - `pricing_rates(id, version_id, tier text check in ('<4h','4-6h','>6h','home_flat'), rate_day int, rate_night int)` — unique `(version_id, tier)`.
  - `pricing_flats(id, version_id, product text check in ('straight_24h','straight_48h','home_hour'), amount int)` — flat amounts (36000, 72000, 15000/hr).
  - `pricing_modifiers(id, version_id, key text, value numeric)` — busy_mult (1.25), tolerance_min (15), block_min (15), first_hour_min (60), home_busy_applies bool.
- Seed migration writes today's rates as `pricing_versions` row v1 with `is_active=true` so behavior is byte-identical on deploy.
- RLS:
  - Read: `GRANT SELECT TO authenticated, anon` (rates are not secret; quotes are computed client-side too).
  - Write: admin only via SECURITY DEFINER `admin_publish_pricing_version(_label, _rates jsonb, _flats jsonb, _modifiers jsonb)` that inserts a new version row + children atomically and flips `is_active`. Rejects edits to an already-published version (immutable).
- Rewrite `compute_quote` and `end_shift` to read from the active version (or a passed `pricing_version_id` for already-snapshotted rows). Logic order unchanged — only the rate lookup changes.

**Client (`src/lib/pricing.ts`):**
- Convert from hardcoded constants to a `PricingTable` interface.
- Add `usePricingTable()` hook + `pricingTableQueryOptions` that fetches the active version once and caches in TanStack Query (15-min stale time, realtime-invalidated on `pricing_versions` change).
- All `computeCoveragePricing` / `computeWorkedPricing` callers pass the table explicitly. No fallback constants — if the table fails to load, the UI shows "Estimating…" instead of a stale number.

---

## Phase 4 — Admin pricing UI

New route `src/routes/_admin.admin.pricing.tsx`:
- Read-only table of active version (tiers, flats, modifiers, effective date, published by).
- "Draft new version" form pre-filled with active values; edits stage in local state; "Publish" calls `admin_publish_pricing_version`, which atomically creates v(n+1) and deactivates v(n).
- History list of past versions (read-only).
- No inline editing of past versions (enforces immutability from Phase 2).

Sidebar entry added to `AdminSidebar.tsx`.

---

## Phase 5 — `extend_payment_window` consistency

`extend_payment_window` hardcodes `rate_per_hour := 2000`. Replace with a lookup of the request's snapshotted `>6h` day rate (or fall back to the active version's `>6h` day rate when snapshot is null). Same 15-min block math.

---

## Out of scope (explicitly)

- Removing the client-side pricing mirror entirely (kept for instant estimates; now driven by DB table, so drift risk is gone).
- Refunds / partial-payment workflow beyond logging underpayments.
- Currency / multi-region.
- Changing the strict ordered pipeline itself — only the rate **source** changes.

---

## Verification matrix

After Phase 1: simulate webhook with `_amount = total - 1` → row stays `payment_status='pending'`, underpayment logged.
After Phase 2: complete a shift, then publish a new version with different rates → old shift's `total_billed_amount` and `rate_snapshot` unchanged; new quote uses new rates.
After Phase 3: publish v2 with `>6h` day rate 2,100 → 10h booked normal quote = 21,000 (was 20,000); UI updates within one realtime tick.
After Phase 4: non-admin hitting `admin_publish_pricing_version` → "Not authorized".
After Phase 5: extend on a `<4h` busy shift → block = (3000/4)*1.25 = 937.50 rounded, not the old 625.

---

## Rollout

Phases 1 and 2 ship together (one migration, no UI). Phase 3 ships next (one migration + client refactor). Phase 4 ships last. Phase 5 piggybacks on Phase 3's migration.
