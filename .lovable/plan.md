# Location Functionality Audit — Findings & Remediation

## Audit Findings (current state)

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Single location service | ❌ FAIL | Three independent geolocation owners: `src/lib/doctor-gps.ts`, `src/features/request/RequesterHome.tsx` (lines 240-256), `src/components/GoogleMapBackground.tsx` (lines 180-234) |
| 2 | Centralized permission requests | ❌ FAIL | Each of the three call sites calls `navigator.geolocation.getCurrentPosition` directly; the browser prompt can fire from any of them independently |
| 3 | No direct browser geo calls outside the location layer | ❌ FAIL | `RequesterHome.tsx` and `GoogleMapBackground.tsx` both reach into `navigator.geolocation` directly. Only `doctor-gps.ts` is the "intended" layer |
| 4 | Online/offline NOT dependent on fresh GPS | ✅ PASS | `setDoctorOnline` (`network.ts:688`) and `handleToggleOnline` (`CoverHome.tsx:72-91`) flip `online` synchronously; GPS refresh is a separate, fire-and-forget call that writes `lat/lng=null` on failure |
| 5 | Maps consume location, do not own it | ❌ FAIL | `GoogleMapBackground` runs its own `watchPosition` + dual `getCurrentPosition` strategy, with its own module-level `cachedUserCenter` cache and accuracy filter |
| 6 | Switchable to Capacitor Geolocation with minimal UI changes | ⚠️ PARTIAL | Possible but requires editing **three** files in lockstep, plus duplicating the accuracy filter logic. No abstraction seam exists |
| 7 | No feature assumes continuous tracking | ❌ FAIL | `GoogleMapBackground` uses `watchPosition` for the requester "you are here" dot — that is continuous tracking by definition. Doctor side is correctly event-driven |
| 8 | Request creation, doctor availability, shift acceptance work from centralized state | ❌ FAIL for requester | Request creation reads from a local `searchOrigin` populated by an ad-hoc `getCurrentPosition` in `RequesterHome`. Doctor availability/acceptance correctly route through `doctor-gps` → `presence-remote` |

**Net result:** 2 of 8 pass. The doctor side is reasonably centralized; the requester side and the map have parallel, uncoordinated GPS stacks.

## Root Cause

There is no `LocationService` abstraction. `doctor-gps.ts` is named for one consumer (the doctor presence write), so the requester form and the map each grew their own geolocation code instead of reusing it. The accuracy/drift filter is duplicated in `GoogleMapBackground` and partially in `doctor-gps`.

## Remediation Plan

### 1. New file: `src/lib/location.ts` (the single service)

Owns every geolocation read in the app. API:

```ts
type Coords = { lat: number; lng: number; accuracy: number };
type PermissionState = "unknown" | "granted" | "denied" | "unavailable";

getLastKnown(): Coords | null               // module cache, sync
requestOnce(opts?): Promise<Coords | null>  // one-shot; cached on success
subscribe(cb): Unsubscribe                  // pushes accepted samples
ensurePermission(): Promise<PermissionState>
getPermissionState(): PermissionState
```

Internals:
- Single `getCurrentPosition` / `watchPosition` orchestration (no watch by default; only when at least one subscriber asks for live updates).
- The accuracy + drift filter currently in `GoogleMapBackground.acceptSample` moves here verbatim — one implementation, one cache, one source of truth.
- One transport seam: a private `readPosition()` that today calls `navigator.geolocation`. To switch to Capacitor Geolocation later, only this one function changes (dynamic import of `@capacitor/geolocation` when `isNative()`).

### 2. Refactor the three call sites to consume the service

- **`src/components/GoogleMapBackground.tsx`** — delete the entire geolocation `useEffect` (lines 177-234), `acceptSample`, and the module-level `cachedUserCenter`/`cachedAccuracy`. Replace with:
  ```ts
  useEffect(() => location.subscribe(setUserCenterState), []);
  useEffect(() => { location.requestOnce(); }, []);
  ```
  Map becomes a pure consumer.
- **`src/features/request/RequesterHome.tsx`** — replace the `useEffect` at lines 240-256 with `location.requestOnce().then(c => c && setSearchOrigin(c))`. Request creation now reads from the same centralized state the map uses.
- **`src/lib/doctor-gps.ts`** — keep the file as the **presence writer** but delete its direct `navigator.geolocation` usage. It calls `location.requestOnce()` and forwards the result to `upsertMyPresence`. Event-driven cadence (mount, online toggle, 20-min foreground tick) is unchanged.

### 3. Continuous-tracking removal

`GoogleMapBackground`'s `watchPosition` is dropped. The map gets a single `requestOnce` plus whatever samples the doctor-side 20-minute tick pushes through the subscriber channel. Requesters get one fix per Home mount — sufficient for the "you are here" dot and `searchOrigin`, and consistent with the project's stated "FlashLocum is not a real-time tracking platform" constraint in `doctor-gps.ts`.

### 4. Permission centralization

`ensurePermission()` is the only path that may trigger the browser prompt. Call sites read `getPermissionState()` for UI ("Location off — tap to enable") instead of inferring from a failed `getCurrentPosition`.

### 5. Capacitor switch path (documented, not implemented now)

After this refactor, swapping to `@capacitor/geolocation` is a single edit to `readPosition()` in `location.ts` (≈10 lines), plus adding `NSLocationWhenInUseUsageDescription` / `ACCESS_FINE_LOCATION` to the native shells per `CAPACITOR.md`. No UI file changes.

## Files Touched

- **New:** `src/lib/location.ts`
- **Edit:** `src/components/GoogleMapBackground.tsx` (remove its geo stack)
- **Edit:** `src/features/request/RequesterHome.tsx` (use service for `searchOrigin`)
- **Edit:** `src/lib/doctor-gps.ts` (delegate position read to service; keep presence-write role)

## Out of Scope

- No change to presence schema, RLS, or `upsertMyPresence` signature.
- No change to online/offline semantics — already correctly decoupled from GPS.
- No Capacitor Geolocation install in this pass (path is unblocked but deferred).

## Verification After Build

1. Grep confirms `navigator.geolocation` appears **only** in `src/lib/location.ts`.
2. Doctor toggles Online → presence row updates `online=true` even if permission denied (lat/lng null).
3. Requester Home renders map dot and pre-fills `searchOrigin` from a single GPS prompt, not two.
4. Switching tabs and returning does not re-prompt for permission and does not flash a default map center.
