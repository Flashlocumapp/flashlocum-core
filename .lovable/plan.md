## AUDITS 5–9 — DIAGNOSIS & FIX PLAN

### AUDIT 5 — Doctor → Requester rating fails: `record 'new' has no field 'location'`

**Root cause (confirmed against live DB).**
`submit_shift_rating` (SECURITY DEFINER) inserts a row into `public.ratings`. The `trg_ratings_after_insert` trigger then runs `_ratings_after_insert()`, which `UPDATE`s `public.coverage_requests` to set `doctor_rating_*` / `requester_rating_*`. That UPDATE fires the BEFORE-UPDATE trigger `prevent_requester_sensitive_change()`.

The function — verified live via `pg_get_functiondef` — contains a doctor-branch block that assigns six fields that **do not exist** on `coverage_requests`:

```sql
NEW.location        := OLD.location;
NEW.lat             := OLD.lat;
NEW.lng             := OLD.lng;
NEW.scheduled_start := OLD.scheduled_start;
NEW.scheduled_end   := OLD.scheduled_end;
NEW.notes           := OLD.notes;
```

`information_schema.columns` confirms only `phone` exists from that group. The doctor branch executes whenever `OLD.accepted_by = auth.uid()`. When a doctor rates, `auth.uid()` is still the doctor (SECURITY DEFINER bypasses RLS, not `auth.uid()`), so the branch fires and PostgreSQL raises `record "new" has no field "location"`. Requester→Doctor rating works because it takes the *first* branch (`NEW.requester_id = auth.uid()`), which only touches columns that exist.

Two more issues found while inspecting:
- The trigger is registered **twice** on `coverage_requests` (`coverage_requests_prevent_requester_sensitive_change` and `prevent_requester_sensitive_change_trg`). Harmless when correct, but doubles the failure surface — drop the duplicate.
- `_ratings_after_insert` runs as the caller. Combined with `prevent_requester_sensitive_change`, a doctor rating that *did* succeed would silently reset `requester_rating_*` if the function ever got expanded — pin the rating-recording UPDATE behind `app.lifecycle_bypass = on` so it cannot be undone.

**Fix.**
1. `CREATE OR REPLACE FUNCTION public.prevent_requester_sensitive_change` — keep the requester branch unchanged; in the doctor branch, drop the six nonexistent columns and the `accumulated_ms`/`started_at` reset (those already lifecycle-bypass), keep `requester_id`, `accepted_by`, `settled_amount`, `payment_status`, `payment_reference`, `payment_provider`, `payment_url`, `paid_at`, `fee_pct`, `remitted_at`, `hospital`, `phone`.
2. `DROP TRIGGER prevent_requester_sensitive_change_trg ON public.coverage_requests` (keep `coverage_requests_prevent_requester_sensitive_change`).
3. Wrap the UPDATE in `_ratings_after_insert` with `set_config('app.lifecycle_bypass','on',true)` / `''` so future expansions of the prevent-trigger can never strip rating fields.

---

### AUDIT 6 — Reliability not updating

**Root causes.**

(a) **Counts the wrong party.** `_trust_terminal_shifts(_user_id, _role)` includes every cancelled row where `accepted_by IS NOT NULL`, with `outcome = 'cancelled'`, regardless of `cancelled_by`. So when a *doctor* cancels an accepted shift, the *requester's* reliability denominator gets a "cancelled" entry too. Violates the stated rule: "Reliability changes only when YOU cancel."

(b) **Score doesn't move until a block closes.** `recompute_trust` only writes `rl_score` from the *last closed block* (`rl_blocks_closed > 0`). Before the first 20 terminal shifts complete, score stays at the default 100 and never reflects current cancellations. Same problem at counts 21–39 (still showing block 1 = oldest 20).

(c) **Triggered only on rating insert.** `recompute_trust` is invoked exclusively from `_ratings_after_insert`. A cancellation/completion alone never recomputes — so reliability lags until somebody also rates.

**Fix.**
1. Rewrite `_trust_terminal_shifts(_user_id, _role)`:
   - `completed` rows where the user was a participant → count toward both numerator & denominator.
   - `cancelled` rows where `accepted_by IS NOT NULL` AND `cancelled_by = _user_id` → count toward denominator only (their cancellation).
   - `cancelled` rows where the OTHER party cancelled → **excluded entirely** (no numerator, no denominator).
   - `no_show` → counted against the no-show party only (use existing `cancelled_by` / outcome conventions).
   - Pre-acceptance cancels (`accepted_by IS NULL`) — already excluded ✓.
2. New trigger `trg_cr_recompute_trust_on_terminal` AFTER UPDATE OF `status` on `coverage_requests`: when row transitions to a terminal state (`completed`, `cancelled`, `no_show`), call `recompute_trust(requester_id)` and `recompute_trust(accepted_by)`.
3. Score formula in `recompute_trust` updated per Audit 7 (below) — same change covers both.

---

### AUDIT 7 — Latest-20 not enforced

**Root cause.** `recompute_trust` uses **closed blocks of 20** (block 1 = ratings 1–20, block 2 = ratings 21–40, etc.) and the displayed score is the *last closed block*. Two failure modes:
- At 25 ratings: shows block 1 (oldest 20) instead of latest 20.
- At <20 ratings: shows default 5.0 / 100 — current behavior never reflects them.

This applies equally to rating and reliability.

**Fix.** Switch to a true rolling latest-20 in `recompute_trust`:

```sql
-- rating (rolling)
WITH latest AS (
  SELECT score FROM public._trust_ratings_received(_user_id)
  ORDER BY created_at DESC LIMIT 20
)
SELECT COALESCE(AVG(score)::numeric(4,2), 5.0), COUNT(*)
  INTO rt_score, rt_sample_size FROM latest;

-- reliability (rolling)
WITH latest AS (
  SELECT outcome FROM public._trust_terminal_shifts(_user_id, v_role)
  ORDER BY terminal_at DESC LIMIT 20
)
SELECT COUNT(*) FILTER (WHERE outcome='completed'),
       COUNT(*)
  INTO rl_completed, rl_sample_size FROM latest;
rl_score := CASE WHEN rl_sample_size > 0
                 THEN ROUND(rl_completed::numeric / rl_sample_size * 100)
                 ELSE 100 END;
```

Keep `trust_blocks` table for historical/audit display (already populated by existing code), but the live `trust_snapshot.rating.score` and `reliability.score` come from the rolling-20 window. Snapshot payload exposes `sample_size` so the UI can render "Based on your last N shifts" honestly when N < 20.

Admin dashboard reads `profiles.trust_snapshot` → automatically picks up the corrected score the moment `recompute_trust` is re-invoked. Add a one-shot backfill at the end of the migration: `SELECT public.recompute_trust(id) FROM public.profiles;` so every existing snapshot is rewritten under the new rules.

---

### AUDIT 8 — Sign-out doesn't always force offline

**Root cause.** `__root.tsx`'s `subscribeAuthState(SIGNED_OUT)` calls `unregisterDoctor()` → `clearMyPresence()`. `clearMyPresence` reads `getCurrentUserIdSync()`, but by the time the SIGNED_OUT event fires Supabase has already cleared the session, so `uid === null` and the function **early-returns without writing**. The presence row remains `online=true` until its 60s freshness window expires — the doctor "stays online" to other requesters.

`AccountScreen.tsx:252` and `auth.$role.tsx:72` call `supabase.auth.signOut()` directly without first clearing presence. `pagehide`/`beforeunload` beacons (added previously) cover tab close, but not the in-app sign-out path.

**Fix.**
1. Add `clearMyPresenceForUser(uid)` to `presence-remote.ts` that accepts an explicit uid (does not consult auth) and PATCHes `doctor_presence` with `online=false`, `last_seen=now()`.
2. Create `src/lib/sign-out.ts` exporting `signOutAndClearPresence()`:
   - Read current uid via `supabase.auth.getUser()` (or `getCurrentUserIdSync`) BEFORE sign-out.
   - `await clearMyPresenceForUser(uid)` (await — must land before sign-out invalidates the bearer).
   - `await supabase.auth.signOut()`.
3. Replace all in-app sign-out call sites (`AccountScreen.tsx`, `auth.$role.tsx`, `reset-password.tsx`) with `signOutAndClearPresence()`.
4. As a backstop, change `__root.tsx`'s SIGNED_OUT handler to capture `session?.user?.id` from the previous event (cache the last seen userId via a module-scope ref in `auth-ready.ts`) and call `clearMyPresenceForUser(prevUid)` even if the wrapper above was bypassed.

After this, a signed-out doctor's row flips to `online=false` synchronously, the realtime DELETE/UPDATE propagates, every requester's `subscribePresence` snapshot drops them within one tick, the admin online-doctor count decrements immediately, and dispatch broadcasts skip them (`list_open_coverage_requests` already gates on `dp.online = true`).

---

### AUDIT 9 — Multi-day day counter visibility

**Server-side: already correct.**
- `start_shift` sets `day_index = GREATEST(1, COALESCE(r.day_index, 1))`.
- `pause_shift` advances `day_index` to `LEAST(days, day_index + 1)` and freezes the day's billed amount.
- `resume_shift` preserves `day_index` (does NOT increment).
- `_auto_advance_day_boundary` cron also advances `+1` at the booked-per-day boundary.
- `end_shift` persists final `day_index` so completed history reads correctly.

**Client-side: gaps.** The Day-counter badge IS rendered in `CoverDispatchPortal` (incoming & accepted cards) and in `CoverageScreen` (requester Active/Upcoming/History lists). It is **missing** from:
- `CoverHome.tsx` → `CoverageTile` — the doctor's home-screen focus tile (the "Active coverage" / "Next coverage" card) never shows `Day X of N`.
- `RequesterHome.tsx` — the active-coverage overlay on the requester's map home does not show `Day X of N` either.

**Fix.**
1. In `CoverHome.tsx` `CoverageTile`, render the same `Day {dayIndex} of {days}` pill that `CoverDispatchPortal` uses, gated on `coverage.days > 1`. Source `dayIndex` from the same `Coverage` shape (already includes `days` and `dayIndex` — `dispatch.ts:88`).
2. In `RequesterHome.tsx`, where the accepted/active coverage chip is rendered (the floating tile that shows hospital + meta during dispatch/accepted/active), add the same pill, gated on `days > 1`. Pull `dayIndex` from the matching `net.requests[requestId]` row.
3. Verify `fmtOpMeta` is unchanged — the badge is a separate element so the meta line stays readable.

No DB change for Audit 9.

---

## Implementation Order

1. **Audit 5** — Migration: fix `prevent_requester_sensitive_change`, drop duplicate trigger, harden `_ratings_after_insert`.
2. **Audit 7** — Migration: rewrite `recompute_trust` to use rolling latest-20 for both rating and reliability; backfill all snapshots.
3. **Audit 6** — Migration: rewrite `_trust_terminal_shifts` to attribute cancellations to `cancelled_by` only; add `trg_cr_recompute_trust_on_terminal` AFTER-UPDATE-OF-status trigger.
4. **Audit 8** — Frontend: `clearMyPresenceForUser(uid)` + `signOutAndClearPresence()`; replace sign-out call sites; cache previous uid in `auth-ready.ts` for the root SIGNED_OUT backstop.
5. **Audit 9** — Frontend: add Day-X-of-N pill to `CoverHome` `CoverageTile` and the requester active-coverage overlay in `RequesterHome`.

**Awaiting approval.**