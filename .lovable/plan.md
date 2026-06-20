# Audit 11 — Pre-Approval Behavioural Confirmations

Explicit confirmations against each requirement. No code. No infrastructure framing.

---

## 1. Stale Request Elimination — Confirmed

- Doctors will not see stale, cancelled, or out-of-scope requests after reload, reconnect, tab switch, app resume, or sign-in as a different identity.
- Once a request is cancelled, edited out of a doctor's eligibility, or withdrawn by the requester, it cannot reappear on that doctor's Incoming Coverage feed under any condition.
- A previously-cached row that survives identity change or session rehydration is treated as a defect, not as acceptable UX.

## 2. Realtime Presence Sync — Confirmed

- A doctor toggling online/offline (or being taken offline by the server) sees their own state reflect correctly everywhere they are signed in, without any refresh.
- Requesters see doctors appear and disappear automatically, without any refresh.
- Other doctors viewing presence-derived surfaces see the same change automatically, without any refresh.
- There is no dependency on polling, manual refresh, or page reload to make presence correct.
- Presence is server-authoritative: an app death (kill, crash, network loss) produces an offline transition that propagates the same way an explicit toggle-off does. "Ghost online" pins are a defect.

## 3. Edit / Cancel Propagation (Pre-Acceptance) — Confirmed

When a requester edits or cancels a request before acceptance:

- The request is removed from every eligible doctor's Incoming Coverage automatically, with no refresh.
- This holds for repeated edit/cancel cycles on the same request — every cycle propagates cleanly.
- A doctor cannot continue to see, tap, or accept a request that has been cancelled or edited out of their eligibility. If that ever happens, it is a defect to fix at the source, not a tolerated race.
- If an edited request becomes eligible again (or is re-published), it appears on all newly-eligible doctors' screens automatically, with no refresh.
- None of this depends on reload, refresh, navigation, or polling.

## 4. No Manual Refresh Dependency (Global) — Confirmed

No user — doctor, requester, or admin — will ever need to refresh, reload, navigate, or tap any "Refresh / Sync" control to see:

- new requests
- removed or cancelled requests
- edits to a request
- accept / start / pause / resume / end / payment / rating events
- doctor online/offline status changes
- their own self-initiated state changes

The "Refresh Location" button is removed. No equivalent control exists or will be added.

---

## Final Clarification — Confirmed Verbatim

> **After implementing Audit 11, all request lifecycle changes and presence changes propagate in realtime across all connected clients without relying on polling, reload, or manual refresh under any condition.**

The two sources of truth a client may render from are the server snapshot issued on subscription activation / identity rehydration, and the realtime event committed by the server. Anything else — polling, sticky fallbacks, surviving caches across identity change, optimistic state not reconciled by the next authoritative event — is treated as a defect and fixed at the source.

The anchor principle remains:

> **State change is reflected upon server commit via realtime subscription, or it is a defect.**

All previously approved sections of Audit 11 (lifecycle event → UI map for all 10+ events, exact in-app toast copy, push payloads, one-channel-per-event rule, presence simplification, cross-device consistency matrix, identity-switch cache invalidation, "what must never appear" list) remain unchanged.

**Awaiting approval to proceed to implementation.**
