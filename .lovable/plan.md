
# FlashLocum Feedback System — Final Implementation Plan (v3)

UI is the primary feedback layer; push handles background awareness; haptics confirm state transitions. **All feedback flows through a single canonical-event engine that normalizes local, realtime, and push as delivery channels of the same event and guarantees a deterministic first visible outcome regardless of arrival order.**

---

## 1. Canonical event model (new core)

Local actions, realtime postgres_changes, and push payloads are **not** independent emitters. They are three delivery channels of the same underlying domain event. Each is normalized to a single shape before the engine reasons about it:

```ts
type CanonicalEvent = {
  kind: 'shift.started' | 'shift.paused' | 'shift.resumed' | 'shift.ended'
      | 'shift.updated' | 'shift.cancelled' | 'offer.new'
      | 'payment.settled' | 'verification.result' | 'reminder.preshift'
  entityId: string            // coverage_request id (or offer id for offer.new)
  occurredAt: number          // server timestamp in ms; local actions use Date.now()
  version: number             // monotonically increasing per (kind, entityId); from DB row updated_at epoch
  source: 'local' | 'realtime' | 'push'
  audience: 'doctor' | 'requester'
  ctx?: { hospitalName?: string; amount?: number }
}
```

Three thin adapters produce `CanonicalEvent`:
- `fromLocal(action)` — wraps a user action just before the optimistic RPC.
- `fromRealtime(row)` — derives kind from row state diff (`status`, `paused_at`, `ended_at`, `cancelled_at`, `updated_at`).
- `fromPush(payload)` — push payload carries `{ kind, entityId, occurredAt, version }` so the foreground handler can reconstruct the same shape.

All three call **one** entry point: `feedback.ingest(event)`.

---

## 2. Engine guarantees

`src/lib/feedback.ts` enforces these invariants:

**G1 — Single canonical representation.** Adapters are pure functions; the rest of the engine never branches on `source`. UI rendering depends only on `kind`, `entityId`, `version`, `ctx`.

**G2 — Deterministic first visible outcome.** For a given `(kind, entityId)`, the first ingest that passes dedupe wins the visible emission. Channel priority `local > realtime > push` is **only a tiebreaker** when two channels report the same `version` within the dedupe window.

**G3 — Versioned ordering (out-of-order safe).** The engine tracks `lastEmittedVersion[kind:entityId]`. An ingest with `version <= lastEmittedVersion` is dropped silently — late pushes after realtime never replay a stale state. Terminal kinds (`shift.ended`, `shift.cancelled`) raise the version ceiling so subsequent `pause`/`resume`/`update` for the same entity are also dropped.

**G4 — Cross-channel dedup window.** A ledger keyed by `kind:entityId:version` holds entries for 6 s. Repeat arrivals on any channel within the window collapse into the already-emitted outcome and are silently acknowledged (so the channel can mark as delivered without re-rendering).

**G5 — Coalescing of equivalent late arrivals.** If realtime arrives 200 ms after local for the same `version`, the engine records the secondary delivery for telemetry but produces zero additional UI/haptic effects.

**G6 — Multi-tab consistency.** A `BroadcastChannel('flashlocum-feedback')` mirrors `(kind, entityId, version, decision)` across tabs. Other tabs adopt the decision without re-rendering.

**G7 — Cold-start replay suppression.** First 3 s after hydration, the ledger pre-seeds the latest known `version` per active entity from the initial query result, so backlogged realtime/push events for already-known states are dropped instead of replaying.

**G8 — Throttle for noisy kinds.** `shift.updated` is throttled to 1 emission / 10 s per entity (last-wins on `version`).

**G9 — Accessibility & user prefs.** `prefers-reduced-motion` disables haptics; user toggles gate haptics and push channels. Toast always fires (it is the primary feedback layer).

**G10 — Foreground push routing.** When `document.visibilityState === 'visible'`, OS push handler intercepts payload, calls `fromPush()` → `ingest()`, and suppresses the OS banner. Background pushes display normally; on app resume, the ledger reconciles via G3/G7.

---

## 3. Final feedback matrix (resolved per canonical event)

### Doctor

| Kind | In-app (visible tab) | Push (background) |
|---|---|---|
| `offer.new` | Card appears + medium haptic | High-priority, branded chime |
| `shift.started` | Toast + light haptic | Default soft sound |
| `shift.paused` | Toast + light haptic | Default soft sound |
| `shift.resumed` | Toast + light haptic | Default soft sound |
| `shift.ended` | Toast ("…Payment will be remitted by 10PM.") + light-medium haptic | Default soft sound |
| `shift.updated` | Toast — "Hospital Y updated this shift" | Default soft sound |
| `shift.cancelled` | Toast — "Hospital Y cancelled shift" + medium haptic | High-priority, default soft sound |
| `payment.settled` | Toast | Default soft sound |
| `verification.result` | Toast (once/session) | Default soft sound |
| `reminder.preshift` | Toast | Default soft sound (T-60) |

### Requester

| Kind | In-app | Push |
|---|---|---|
| Doctor accepted (`shift.started` by doctor) | Toast | Yes |
| `shift.cancelled` by doctor | Toast — "Doctor cancelled shift" | Yes |
| No doctor in 180 s | Single toast | — |
| Local taps (Start/Pause/Resume/End buttons) | Haptic on tap only | — |
| `reminder.preshift` | — | Yes (T-60) |

Foreground push is suppressed everywhere — engine owns the experience.

---

## 4. Adapter wiring

- **Local** — in `src/features/cover/dispatch.ts`, `CoverageScreen.tsx`, `CoverHome.tsx`, `RequesterHome.tsx`: just before the RPC call, build `fromLocal({...})` and `ingest()` optimistically.
- **Realtime** — single subscription per role in `dispatch.ts` already exists; replace direct toast/sound calls with `fromRealtime(row, prevRow)` → `ingest()`. The diff function derives `kind` and `version` (from `updated_at`).
- **Push** — in `src/lib/push-registration.ts`, foreground message handler calls `fromPush(payload)` → `ingest()`. Push payloads emitted from `src/lib/push.server.ts` must include `kind`, `entityId`, `occurredAt`, `version`.

---

## 5. Push server changes (`src/lib/push.server.ts`, `coverage-notify.functions.ts`)

- Payload envelope: `{ notification: {...}, data: { kind, entityId, occurredAt, version } }`.
- FCM `priority: "high"` for `offer.new` and `shift.cancelled` only.
- Bundled `offer.caf/ogg` chime for `offer.new` + cancellation; OS default soft sound for the rest.
- Retry with backoff; persist failures to new `notification_outbox` table.
- Token refresh on app resume.

---

## 6. Pre-shift reminder

- Migration: `coverage_requests.reminder_sent_at timestamptz`.
- New route `src/routes/api/public/hooks/shift-reminders.ts` — `pg_cron` every 5 min selects shifts starting in 55–65 min with `reminder_sent_at IS NULL`, pushes both audiences as `reminder.preshift`, stamps the column. Idempotent.

---

## 7. Copy rules (locked)

- All updates → **"Hospital Y updated this shift"** (no field diff).
- Requester-initiated cancel → **"Hospital Y cancelled shift"**.
- Doctor-initiated cancel → **"Doctor cancelled shift"**.
- 180 s no-doctor → single toast; no "expired — try again" UI.

---

## 8. Toast & cleanup pass

- Remove WebAudio (`tone`, `shiftCue`, `AudioContext`).
- Remove redundant admin "refresh failed" toasts → inline retry.
- Remove "Profile updated" toast → inline "Saved" pill.
- Verification online-toggle: dedupe once-per-session via the engine ledger.
- Lagos out-of-region: single `notifyOutOfRegion()` helper.
- `ToastHost`: `role="status"` (info) / `role="alert"` (error); TTL `max(3400, title.length * 60)` ms; reduced-motion respected; dark-mode contrast pass.

---

## 9. User controls

- New Account → **"Haptics & notifications"** panel: toggles for haptics and push. No in-app sound toggle (none exists).

---

## 10. Camera abstraction

- New `src/lib/media.ts` exposing `pickPhoto()` — `@capacitor/camera` on native, web `getUserMedia` / `<input type="file">` fallback. Rewire onboarding + 3 re-upload sites.

---

## 11. Files touched

- `src/lib/feedback.ts` — rewrite as canonical-event engine (`ingest`, adapters, ledger, version ceiling, broadcast).
- `src/lib/notifications.ts` — thin wrappers that build canonical events.
- `src/lib/push.server.ts` — envelope with `kind/entityId/version`; bundled chime; high priority for offer/cancel.
- `src/lib/push-registration.ts` — foreground handler → `fromPush` → `ingest`; token refresh on resume.
- `src/lib/coverage-notify.functions.ts` — backoff + outbox; new event payloads.
- `src/features/cover/dispatch.ts` — realtime adapter; local-action ingest sites.
- `src/features/app/CoverageScreen.tsx`, `src/features/cover/CoverHome.tsx`, `src/features/request/RequesterHome.tsx` — local ingest; tap haptics.
- `src/components/ToastHost.tsx` — roles, length-aware TTL, reduced-motion.
- `src/routes/_app.account.tsx` — Haptics & notifications panel.
- `src/lib/media.ts` (new) — camera abstraction.
- `src/routes/onboarding.$role.tsx` + 3 re-upload sites — use `pickPhoto()`.
- `src/routes/api/public/hooks/shift-reminders.ts` (new) — cron handler.
- Migration: `notification_outbox` table + RLS + GRANTs; `coverage_requests.reminder_sent_at`.

---

## 12. Rollout phases

1. **Engine rewrite.** Canonical event type, adapters, ledger with version ceiling, broadcast. Remove WebAudio.
2. **Wire adapters.** Replace every existing toast/sound/haptic call site with `ingest()` via the correct adapter.
3. **Push envelope upgrade.** Add `kind/entityId/version` to all push payloads; foreground handler routes through engine.
4. **Copy lockdown + toast cleanup.**
5. **Push hardening.** High priority for offer/cancel, retry + outbox, token refresh, bundled chime.
6. **New events.** Payment settled, verification result, shift updated, cancellation, pre-shift reminder (cron + migration).
7. **Account panel + accessibility pass.**
8. **`media.ts` camera abstraction.**

Each phase is independently shippable and reversible.

---

## 13. Confirmed non-goals

❌ Apple Critical Alerts. ❌ In-app WebAudio. ❌ "Material field" diffing. ❌ Reasons/metadata in cancel copy. ❌ "Expired — try again" UI. ❌ Removing pause/resume haptics. ❌ Channel-specific UI branches — all three channels resolve to one canonical event before rendering.
