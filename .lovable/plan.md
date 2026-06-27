# Plan — Capacitor Google Maps for Native, JS Maps for Web (Final)

## Goal
Render `@capacitor/google-maps` natively on Android/iOS, keep the current Google Maps JavaScript implementation on the web. Same component API so call sites are untouched. Native is gated by a feature flag; native API key lives in the platform manifest.

## Call sites (unchanged)
1. `src/features/request/RequesterHome.tsx:388`
2. `src/features/cover/CoverHome.tsx:107`

Both keep their existing imports and props.

## Architecture

```text
src/components/GoogleMapBackground.tsx              ← splitter (no Capacitor import)
src/components/map/GoogleMapBackground.web.tsx      ← current JS impl, moved verbatim
src/components/map/GoogleMapBackground.native.tsx   ← ONLY file that imports @capacitor/google-maps
src/components/map/lagos-bounds.ts                  ← shared bounds + inLagos
src/components/map/map-style.ts                     ← shared LIGHT_STYLE
src/components/map/marker-icons.ts                  ← shared doctor + requester SVG data URLs
src/lib/native-maps-flag.ts                         ← feature flag
```

Splitter picks the impl at runtime:

```tsx
import { isNative } from "@/lib/native";
import { isNativeMapsEnabled } from "@/lib/native-maps-flag";
import { GoogleMapBackground as Web } from "./map/GoogleMapBackground.web";
import { GoogleMapBackground as Native } from "./map/GoogleMapBackground.native";
export type { PlaceMapMarker } from "./map/GoogleMapBackground.web";
export const GoogleMapBackground =
  isNative() && isNativeMapsEnabled() ? Native : Web;
```

Both implementations expose the identical prop contract (markers, center, placeMarkers, showSelf, selfMarkerKind, active, markerScale). All `@capacitor/google-maps` imports are confined to `GoogleMapBackground.native.tsx`; nothing else in the app references Capacitor map APIs.

## Conditions addressed

### 1. Separate browser vs native API keys
- **Browser key** — existing `VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY`, used only by `loadMapsApi()` in the web map.
- **Native Android key** — `android/app/src/main/AndroidManifest.xml` → `<meta-data android:name="com.google.android.geo.API_KEY">`. Read by the Android Google Maps SDK directly.
- **Native iOS key** — `ios/App/App/Info.plist` → `GMSApiKey`. Read by the iOS Google Maps SDK directly.

Keys are managed independently and can hold the same value today. Documented in `CAPACITOR.md`.

### 2. Native key sourced from platform configuration (no custom plugin)
`@capacitor/google-maps` `GoogleMap.create({ apiKey })` requires a string in JS. The plugin does **not** auto-read the manifest, so we cannot literally avoid passing a value through JS, but we also do not need a custom Capacitor plugin to satisfy the spirit of the condition.

Approach without a custom plugin:

- Define a single build-time env var, `VITE_CAPACITOR_MAPS_API_KEY`, that mirrors the value already configured in `AndroidManifest.xml` / `Info.plist`. This is the value passed to `GoogleMap.create()`.
- Add a tiny CI/dev check (`scripts/check-native-map-key.mjs`, runnable manually and on `cap sync`) that parses `AndroidManifest.xml` and `Info.plist` and fails if the manifest values don't match `VITE_CAPACITOR_MAPS_API_KEY`. This guarantees the canonical source of truth is the platform manifest; the env var is a verified mirror.
- Document in `CAPACITOR.md` that rotating the native key means editing the manifest and updating the env var; the check script enforces both stay in sync.
- The browser key is **never** used as a fallback for native; if the env var is missing on a native build the native impl renders the neutral fallback `<div>` (same as a Maps init failure) and logs.

This keeps the platform manifest as the authoritative source, avoids hardcoding the key in JS source, and adds no native code. A custom plugin would only be required if we wanted JS to literally read `PackageManager`/`Bundle` at runtime — there is no other technical requirement that justifies it.

### 3. Feature flag
`src/lib/native-maps-flag.ts`:

1. `localStorage["flashlocum.nativeMaps"]` = `"off"` | `"on"` (dev/QA kill switch; no settings UI added).
2. `import.meta.env.VITE_NATIVE_MAPS_ENABLED === "false"` forces off at build time.
3. Default: on.

Off → splitter returns the web impl on native, reverting to the WebView Google Maps JS map without a release.

### 4. Post-implementation verification report
Delivered as `CAPACITOR.md#native-maps-verification` with a table covering: Lagos bounds rendering, requester pulse, doctor self pulse, marker add/move/remove on roster change, `markerScale=0.6` honored, `center` pan on hospital select, tab-switch recenter, out-of-Lagos markers hidden, strict bounds enforcement, `placeMarkers` accepted-but-ignored, init failure → neutral fallback, feature flag off → web impl on native, GPS source unchanged. Web column from Chrome preview; Android column from `adb` device captures; iOS deferred until macOS toolchain available.

## Native implementation (`GoogleMapBackground.native.tsx`)
- Only file importing `@capacitor/google-maps`.
- Creates transparent host `<div>` matching the web component footprint.
- `GoogleMap.create({ id, element, apiKey: import.meta.env.VITE_CAPACITOR_MAPS_API_KEY, config })`.
- `config` mirrors web: center, zoom 12, minZoom 10, maxZoom 18, `restriction: { latLngBounds, strictBounds: true }`, `styles: LIGHT_STYLE`.
- Markers via `addMarker` / `removeMarker`, diffed by `key` like the web pool.
- Self marker uses the same SVG data URL (`requesterDotIcon` / `doctorIcon`); Android may render the static frame of the SMIL pulse — cosmetic only.
- Camera: `setCamera({ coordinate, animate: true })` on `center` / `userCenter` / `active` changes; zoom never changed (matches web).
- GPS exclusively from `src/lib/location.ts`.
- `placeMarkers` accepted, not rendered.
- Cleanup: `await map.destroy()` on unmount.
- Init failure → neutral background `<div>`.

## Shared extractions (no behavior change to web)
`lagos-bounds.ts`, `map-style.ts`, `marker-icons.ts` extracted from the current web file; web file imports them and stays semantically identical.

## Preserved business logic
`src/lib/location.ts`, `src/lib/doctor-gps.ts`, presence, dispatch, RequesterHome, CoverHome — unchanged. No new permissions, no new settings UI.

## Incremental rollout
1. Land splitter + shared extractions + feature flag. Web behavior identical.
2. Add Manifest/Plist entries + `VITE_CAPACITOR_MAPS_API_KEY` env + `scripts/check-native-map-key.mjs`.
3. Land native impl behind `isNative() && isNativeMapsEnabled()`.
4. `npx cap sync android` → device install → run verification table → publish report in `CAPACITOR.md`.
5. iOS: same code path when toolchain available.

## Out of scope
No new map features (no radius circle, clustering, hospital pins). No removal of the web implementation. No edits to call sites or non-map code. No user-facing settings.

## Risk
- SMIL pulse renders as static frame inside native marker bitmaps — cosmetic.
- Native key must have Maps SDK for Android/iOS enabled in Google Cloud (separate from the browser key's Maps JavaScript API enablement). Verification step 4 will fail loudly if missing.
- `VITE_CAPACITOR_MAPS_API_KEY` must be set in the build environment for native; the check script is the guardrail.
