## Audit findings (recap)

The canonical-event engine in `src/lib/feedback.ts` already collapses local + realtime + push arrivals for the same `(kind, entityId, version)` into one visible outcome (G2/G3/G4/G6/G7). What it doesn't currently emit is **sound** — the file explicitly declares "In-app sound is intentionally absent." That decision is being reversed for two events only:

- `offer.new` (doctor side) — soft chime + medium haptic, no toast, card is the signal.
- `offer.accepted` — soft confirmation tone for both the doctor (after the server confirms their claim won) and the requester (when their request flips to accepted). No haptic.

Push for `offer.new` will switch from the branded chime to the device-default sound + default vibration so background behaviour matches the OS conventions the user expects.

## Plan

### 1. Sound assets

Two short, soft, professional WAVs committed under `src/assets/sounds/`:

- `alert.wav` — 2-note soft chime, ~600 ms, Slack/Teams-grade, never alarm-like.
- `confirm.wav` — single softer/shorter tone, ~250–300 ms, low-key acknowledgement.

Generated deterministically with a tiny `numpy` script in the sandbox (sine partials, gentle ADSR envelope, –18 dBFS peak), then committed. No external CDN dependency. They ship inside the Capacitor bundle automatically because they're imported via Vite (`?url`) and end up in `dist/assets/`.

Files stay under ~30 KB each, so they're well below the asset-CDN externalisation threshold.

### 2. `src/lib/sound.ts` — single playback layer (web + Capacitor)

A thin, isolated module exporting `playAlert()` and `playConfirm()`. Both:

- Resolve their URL via `import alertUrl from "@/assets/sounds/alert.wav?url"` so the bundler hashes and ships them in both web and native builds.
- Use **`HTMLAudioElement`** as the universal backend. It works inside the Capacitor WebView on iOS and Android without any extra plugin — Capacitor wraps a standard WebView and `<audio>` works the same as in mobile Safari/Chrome. No `@capacitor-community/native-audio` dependency.
- Maintain one cached `HTMLAudioElement` per asset; on each call reset `currentTime = 0` and call `.play()` so rapid retriggers don't stack two voices.
- Catch the autoplay-rejection promise silently. In practice the user has already interacted with the app to reach a foreground state, so the gesture requirement is satisfied; this is just defensive.
- No-op cleanly when `typeof window === "undefined"` (SSR) and when `document.visibilityState !== "visible"` (defence-in-depth: foreground-only).
- **No user-facing toggle.** Sound is always on for these two events; the existing reduced-motion / haptics prefs are unaffected.

Capacitor-specific notes baked into comments:
- WebView audio requires the route to be foregrounded — handled by the visibility guard.
- iOS silent switch: a standard `<audio>` element respects the ringer/silent switch, which is the correct behaviour for notification sounds.
- No background playback, no `AVAudioSession` config needed.

### 3. Engine integration in `src/lib/feedback.ts`

Two narrow edits, fully inside `ingest()` so dedup automatically governs sound:

a. Extend `RenderPlan`:
```ts
type RenderPlan = {
  toast?: { tone: ToastTone; title: string; body?: string; ttl?: number };
  haptic?: HapticIntensity;
  sound?: "alert" | "confirm"; // NEW
};
```

b. Update the planner:
- `offer.new`: add `sound: !skipHaptic && isDoctor ? "alert" : undefined`. (Tied to the same doctor-only / not-suppressed conditions as the haptic so the contract stays "card + chime + buzz, all once" for an in-app doctor.)
- `offer.accepted`:
  - doctor → `{ sound: "confirm" }` (no toast, no haptic).
  - requester → keep existing actor-named toast, **add** `sound: "confirm"`.

c. In `ingest()`, after `emitHaptic`:
```ts
if (p?.sound === "alert") playAlert();
else if (p?.sound === "confirm") playConfirm();
```

Because this lives **after** the G3 staleness check, the G4 6 s ledger lookup, the G7 hydration window, and the terminal-emit / lifecycle-suppression gates, sound inherits **exactly one fire per (kind, entityId, version)** across local + realtime + push + multi-tab. The BroadcastChannel echo at the end of `ingest()` already mirrors the decision to peer tabs so two tabs of the same user produce one sound, not two.

### 4. Server-confirmed acceptance — only play after the server says we won

This is the most important behavioural requirement, and the existing code is already shaped to support it; we just need to be careful not to add a local optimistic emit.

Current flow (`src/features/cover/dispatch.ts`):
1. Doctor taps Accept → `claimAndNotifyFn` server fn runs → returns `{ won: true | false }`.
2. The `dispatch.ts` watcher subscribes to the network/realtime stream and **only** calls `ingest({ kind: "offer.accepted", source: "realtime", ... })` once `ev.action === "accept" && r.acceptedBy === sid` lands from the row.
3. There is no `fromLocal("offer.accepted", …)` anywhere — the doctor side never emits acceptance locally.

The plan:
- **Do not add any `fromLocal("offer.accepted")` call.** The sound is bound to the engine's `offer.accepted` planner branch, which only fires when the realtime echo (or the foreground push) arrives carrying `r.acceptedBy === sid`. If a peer wins, the row's `acceptedBy` is someone else and `ingest()` for this doctor never runs the `offer.accepted` branch → no sound. ✓
- For the requester, `offer.accepted` is already triggered exclusively from the realtime row transition (driven by the same `accepted_by` flip on the server row). Adding `sound: "confirm"` to the requester branch is therefore also server-confirmed by construction.
- I'll grep the codebase during implementation to confirm zero `offer.accepted` emissions with `source: "local"`. If any are found they get removed.

### 5. Push payload sound classification (`src/lib/push.server.ts`)

- Remove `offer.new` from `BRANDED_CHIME_KINDS` so backgrounded doctors get the **device-default** notification sound and the OS's default vibration pattern.
- Keep `HIGH_PRIORITY_KINDS = { offer.new, shift.cancelled }`. Priority and sound are orthogonal in FCM — we still want low-latency delivery for incoming offers; we just don't want a custom chime.
- `offer.accepted` is not in either set today — it continues to ship with the device default sound. ✓
- `shift.cancelled` keeps the branded chime (out of scope).

### 6. Dedup guarantees — explicit cross-channel matrix

After the changes, each event guarantees exactly one sound, one notification surface, and one vibration (where applicable) per `(kind, entityId, version)`:

```text
                       │ in-app sound │ toast │ haptic │ OS notification
─ Doctor, new request ─────────────────────────────────────────────────
foreground (any combo  │
  local / RT / push)   │   alert ×1  │   —   │ buzz×1 │  suppressed*
background             │      —      │   —   │   —    │  default sound + vibe
─ Doctor, acceptance (server-confirmed only) ──────────────────────────
foreground             │   confirm×1 │   —   │   —    │  suppressed*
background             │      —      │   —   │   —    │ (no push sent today)
─ Requester, acceptance ───────────────────────────────────────────────
foreground             │   confirm×1 │  ×1   │   —    │  suppressed*
background             │      —      │   —   │   —    │  default sound
```

\* iOS suppresses the system banner in foreground by default; on Android the system may briefly show one, but the engine already owns the single in-app outcome and the push's `pushNotificationReceived` listener funnels the payload into `ingest()` under the same ledger key — no double sound, no double toast.

### 7. Verification (after implementation)

1. `tsgo` clean.
2. `rg "offer\.accepted"` to confirm zero `source: "local"` emissions for accept.
3. `rg "new Audio\(|\.play\("` to confirm the only `.play()` call sites are inside `src/lib/sound.ts`.
4. Trace `dispatch.ts` and `RequesterHome.tsx` once more to verify the realtime branches are the sole acceptance entry points.
5. Read `src/lib/push-registration.ts` to re-confirm foreground push still routes through `ingest()`.
6. Update `.lovable/memory/constraints/notification-contract.md` to note that in-app sound is now part of the contract (alert for `offer.new`, confirm for `offer.accepted`, no other events; no user toggle) and that the acceptance sound is server-confirmation gated.

### Out of scope (untouched)

Lifecycle (start/pause/resume/end), payment, cancellation, ratings, reminders, verification, RLS, realtime channels, push outbox/drain, `shift.cancelled` branded chime, toast copy, settings UI.

## Files touched

- `src/assets/sounds/alert.wav` — new (generated locally, <30 KB)
- `src/assets/sounds/confirm.wav` — new (generated locally, <30 KB)
- `src/lib/sound.ts` — new
- `src/lib/feedback.ts` — planner `sound` field + `ingest()` playback hook + updated header comment
- `src/lib/push.server.ts` — drop `offer.new` from `BRANDED_CHIME_KINDS`
- `.lovable/memory/constraints/notification-contract.md` — note the in-app sound rule and server-confirmation gate
