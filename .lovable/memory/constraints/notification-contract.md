---
name: Notification & feedback contract
description: Which events route through the central feedback engine, which are operational toasts, and the foreground/background rules
type: constraint
---

## Contract events (lifecycle, payment, rating, reminder, request, shift, verification)

Always route through `src/lib/feedback.ts` `ingest()`. The engine:

- Dedups by `ledgerKey` across realtime + local emissions (6 s window).
- Renders the single canonical toast via `pushToast({ key: ledgerKey })`
  so the global `pushToast` 4 s dedup ledger also catches any stray
  direct calls with the same key.
- Owns haptic policy. Only `offer.new` emits a haptic.
- Owns in-app sound policy. Exactly two events play a sound, foreground-only,
  via `src/lib/sound.ts`: `offer.new` → soft `alert` chime (doctor),
  `offer.accepted` → softer `confirm` tone (both audiences). No user toggle.
  The acceptance sound is server-confirmation gated: callers MUST NOT emit
  `offer.accepted` with `source: "local"` — it fires only from the realtime
  row echo / foreground push that carries the `accepted_by` row flip.
  Push payload `BRANDED_CHIME_KINDS` is reserved for `shift.cancelled`;
  `offer.new` background push uses the device-default sound + vibration.

Direct `pushToast` calls for contract events are forbidden. Add them via
`ingest()` so dedup and haptics stay correct.

## Operational toasts (allowed direct `pushToast`)

- Form validation: "Coverage requests are limited to 14 days maximum.",
  "You already have the maximum number of confirmed shifts.",
  map rejection, location load errors, rating save errors.
- Lifecycle RPC errors: "Couldn't start/pause/end this shift".
- All `_admin.*` toasts (admin tooling is out of contract).

## Global delivery rules

- `<ToastHost />` is mounted once in `src/routes/__root.tsx` and uses
  `position: fixed` so toasts appear on every route (auth, onboarding,
  admin, app shells alike).
- Foreground rule: if `document.visibilityState === "visible"`, the
  service-worker re-ingests pushes into the engine and suppresses the
  system notification — foreground = toast only.
- Payment complete: doctor gets toast + push; requester gets toast only
  (requester initiated the payment).
