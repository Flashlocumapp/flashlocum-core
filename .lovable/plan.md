
# Trust Snapshot Layer + Re-Audit

Collapse every rating/reliability/eligibility path into a single, server-computed, versioned **Trust Snapshot**. Client code, admin UI, and any future API read this one object. No scattered scoring, no client-derived eligibility, no automatic restriction.

---

## 1. The Trust Snapshot (shape)

One per user (and a small per-shift mini-snapshot for UI lock decisions).

```ts
type TrustSnapshot = {
  version: number;
  computed_at: string;
  user_id: string;
  role: 'doctor' | 'requester';

  rating: {
    score: number;                 // last closed block avg, default 5.0
    block_index: number;           // # of closed 20-blocks
    block_size: 20;
    in_progress_count: number;     // ratings since last closed block
    last_block: { from: string; to: string; avg: number; samples: 20 } | null;
  };

  reliability: {
    score: number;                 // 0–100, last closed block, default 100
    block_index: number;
    block_size: 20;
    in_progress_count: number;
    last_block: {
      from: string; to: string;
      completed: number; cancelled: number; no_show: number; total: 20;
    } | null;
  };

  eligibility: {                            // computed signals only
    rating_below_threshold: boolean;        // < 3.5
    reliability_below_threshold: boolean;   // doctor < 85, requester < 75
    any: boolean;
    reasons: string[];
  };

  restriction: {                            // admin-controlled only
    restricted: boolean;
    restricted_at: string | null;
    restricted_by: string | null;
    reason: string | null;
    source: 'admin_trust' | 'admin_manual' | 'payment_overdue' | null;
  };
};

type ShiftRatingState = {
  shift_id: string;
  doctor_rating:    { submitted: boolean; score: number | null; at: string | null };
  requester_rating: { submitted: boolean; score: number | null; at: string | null };
};
```

---

## 2. Database

### 2.1 Schema (single migration)
- `coverage_request_status` enum: add `no_show`.
- `ratings`:
  - `shift_id NOT NULL`
  - drop the partial predicate on the unique index so duplicates are blocked on **every** row
  - add `feedback text NULL`
- `coverage_requests` adds, maintained by trigger on `ratings` insert:
  - `requester_rating_submitted bool default false`
  - `requester_rating_score smallint`
  - `requester_rating_at timestamptz`
  - mirrored `doctor_rating_*`
- `profiles` adds:
  - `trust_snapshot jsonb`
  - `trust_snapshot_at timestamptz`
  - `account_restricted_at timestamptz`
  - `account_restricted_reason text`
  - `account_restricted_by uuid`
  (kept distinct from existing `payment_restricted_at`)
- New `trust_blocks` (closed 20-block history):
  ```
  id, user_id, kind ('rating'|'reliability'),
  block_index int, from_at, to_at, payload jsonb, created_at
  unique(user_id, kind, block_index)
  ```
  Standard grants: `SELECT, INSERT` to `authenticated` via RLS (own rows + admin); `ALL` to `service_role`. RLS on, policies for self-read + admin-read.

### 2.2 Functions (all `SECURITY DEFINER`, `search_path=public`)
- `_terminal_shifts_for(user_id, role)` — completed, cancelled-after-accept, no_show, ordered.
- `_ratings_received_for(user_id, role)` — ratings on terminal shifts, ordered.
- `recompute_trust(_user_id uuid) → jsonb`
  - Idempotent. Closes any new 20-blocks into `trust_blocks`, rebuilds `profiles.trust_snapshot`, returns the snapshot.
  - **Pure compute. Never writes restriction fields.**
- `get_trust(_user_id uuid) → jsonb`
  - Returns current snapshot; inline-recomputes if stale or null.
  - Authz: self, counterparty on a shared shift, or admin.
- `get_shift_rating_state(_request_id uuid) → jsonb`
  - Returns `ShiftRatingState`. Authz: requester, accepted doctor, or admin.
- `submit_shift_rating(_request_id uuid, _score int, _feedback text) → jsonb`
  - Validates rater is requester or accepted doctor; derives `ratee_entity_id` from the shift (no client-supplied slug); inserts into `ratings`; surfaces duplicate as a clean error; returns updated `ShiftRatingState`.
- `admin_list_trust(_filter text, _limit int) → setof`
  - Admin-only. Supports `eligibility.any = true` filter, sort by lowest score.
- `admin_apply_trust_restriction(_user_id uuid, _reason text)` / `admin_clear_trust_restriction(_user_id uuid)`
  - Admin-only. **The only writers of `account_restricted_*`.**
- `admin_mark_no_show(_request_id uuid, _reason text)` — admin-only status flip; not auto.

### 2.3 Triggers
- `AFTER INSERT ON ratings` → mirror to `coverage_requests.*_rating_*`, call `recompute_trust(ratee)`.
- `AFTER UPDATE OF status ON coverage_requests` when new status ∈ `('completed','cancelled','no_show')` → `recompute_trust` for requester and accepted doctor.
- `BEFORE INSERT ON ratings` → rater/ratee counterparty check against `shift_id`.

### 2.4 Explicit no-auto-restriction guard
Migration includes a comment block enumerating every site that writes `account_restricted_at`: only the two admin RPCs. Future grep enforces.

---

## 3. Client refactor

### 3.1 New module `src/lib/trust.ts`
- Replaces consumption of `src/lib/ratings.ts` and `src/lib/reliability.ts` (those files become thin re-exports backed by the snapshot, no scoring logic of their own).
- API:
  - `loadTrust(userId)` — fetch + cache.
  - `useTrust(userId)` — subscriber; re-renders on `accept`/`complete`/`cancel`/`rating` network events.
  - `useShiftRatingState(requestId)` — drives overlay + history sheet lock.
- Reuses existing `subscribeNetwork`.

### 3.2 UI wiring (presentation only, no business logic moves to client)
- `RatingPill` / `ReliabilityPill` read `useTrust(userId).rating.score` / `.reliability.score`.
- `RatingOverlay` callers (`ShiftSettlement`, `CoverDispatchPortal`): before opening, check `useShiftRatingState(requestId)`; if the relevant side is `submitted`, render a read-only "Already rated" panel instead of the form.
- `HistoryDetailSheet`: same check; CTA hidden when submitted.
- `recordRating` → `submitShiftRating({ requestId, score, feedback })`; surfaces duplicate errors with a toast and keeps the sheet open.
- Remove client-side eligibility/threshold math everywhere.

### 3.3 Admin UI
- New route `src/routes/_admin.admin.trust.tsx`:
  - Tabs: Doctors / Requesters / All
  - Default filter `eligibility.any = true`, sorted lowest first
  - Row: user, role, rating, reliability, last-block breakdown, restriction state
  - Actions (confirm-gated): Restrict / Clear restriction
- "Trust" tab on `_admin.admin.users.tsx` detail showing full snapshot + last 3 blocks per kind.
- `AdminSidebar` entry "Trust".

---

## 4. Migration & rollout order

1. **M1** schema: enum value, columns, tables, grants, triggers; backfill `coverage_requests.*_rating_*` from existing `ratings`; one-shot `recompute_trust` for every profile; migrate any `ratee_entity_id = 'hosp:<slug>'` to `req:<requester_id>` derived from the shift.
2. **M2** RPCs (`get_trust`, `get_shift_rating_state`, `submit_shift_rating`, admin RPCs).
3. **M3** `src/lib/trust.ts` + rewire pills, overlays, settlement, history.
4. **M4** Admin Trust page + sidebar entry + user-detail Trust tab.
5. **M5** Remove dead client paths (local "already rated" maps, client threshold constants).

---

## 5. Re-audit against the spec

| Spec rule | Snapshot model |
|---|---|
| Doctor starts 5.0 / 100% | ✅ snapshot defaults |
| Ratings batched every 20 completed shifts | ✅ `trust_blocks(kind='rating')` |
| Rating < 3.5 → eligible | ✅ `eligibility.rating_below_threshold` |
| Reliability batched every 20 terminal shifts | ✅ `trust_blocks(kind='reliability')` |
| Terminal = completed \| cancelled-after-accept \| no_show | ✅ `_terminal_shifts_for` + new enum value |
| Doctor reliability < 85% → eligible | ✅ role-aware threshold |
| Requester reliability < 75% → eligible | ✅ role-aware threshold |
| Requester ratings same rules | ✅ same path, role param |
| No auto-restriction from scores | ✅ only `admin_apply_trust_restriction` writes restriction state |
| Admin sees rating, reliability, block breakdown, flags | ✅ `admin_list_trust` + Trust page |
| One rating per shift per user | ✅ full unique index + counterparty trigger |
| UI lock after submission (cross-device, cross-session) | ✅ server-derived `ShiftRatingState` |
| Shift-level submission flags | ✅ columns on `coverage_requests` maintained by trigger |
| Timestamps + values preserved | ✅ `*_rating_at` / `*_rating_score` + original `ratings` row |

### Residual risks called out
- **No-show detection** is admin-only (`admin_mark_no_show`); no auto-mark policy. Out of scope to design here.
- **Reliability backfill will shift historical scores** (denominator changes from "lifetime incl. in-progress" to "terminal-only, blocks of 20").
- **Snapshot staleness**: triggers drive recompute; `get_trust` falls back to inline recompute when `trust_snapshot_at` predates the latest qualifying event.

---

## Out of scope
- Pricing engine (shipped).
- No-show auto-detection.
- Feedback moderation.
- Notification copy when admin restricts a user.

## Verification matrix
1. Insert 20 ratings averaging 4.2 → snapshot `rating.score=4.2`, `block_index=1`; 21st does not move the score.
2. Doctor with 18 completed + 2 cancelled-after-accept → reliability still 100; one more terminal closes the block.
3. Duplicate `submit_shift_rating` → server error, toast shown, no second `ratings` row.
4. Open History on a fresh device after rating → "Already rated" panel; no form.
5. Doctor rating drops to 3.4 → appears in admin Trust list with `eligibility.any=true`; **no restriction applied**.
6. Admin Restrict → `account_restricted_at` set, snapshot reflects, banner shows; Clear reverses.
7. Grep DB functions → only `admin_apply_trust_restriction` writes `account_restricted_at`.
