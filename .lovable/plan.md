## Goal

Remove the native Capacitor Google Maps SDK path entirely. Android/iOS will render the same google.maps JS map inside the WebView that the web build uses, restoring pre-migration behavior. All unrelated work stays untouched.

## Changes

1. **Collapse the splitter** — `src/components/GoogleMapBackground.tsx`
   - Replace the platform-splitting wrapper with a thin re-export of the web implementation:
     ```ts
     export { GoogleMapBackground, type PlaceMapMarker } from "./map/GoogleMapBackground.web";
     ```
   - Drops `isNative()` / `isNativeMapsEnabled()` / `lazy(...)` / `Suspense` so the native module is never reachable from the bundle graph.

2. **Delete native-only files**
   - `src/components/map/GoogleMapBackground.native.tsx`
   - `src/lib/native-maps-flag.ts`
   - `scripts/check-native-map-key.mjs`

3. **Remove the Capacitor maps dependency**
   - `bun remove @capacitor/google-maps`
   - Verify it's gone from `package.json` and lockfile.

4. **Strip native-map env wiring**
   - Remove `VITE_CAPACITOR_MAPS_API_KEY` and `VITE_NATIVE_MAPS_ENABLED` references from `.env` if present.
   - Remove any `scripts/check-native-map-key.mjs` invocation from `package.json` scripts.

5. **Remove native-map CSS hooks** — `src/styles.css`
   - Delete the `html.capacitor-native-map` transparency chain and `.capacitor-google-map` rules added for the native path. Web map styling is unaffected.

6. **Docs** — `CAPACITOR.md`
   - Remove the "native-maps-verification" section and any references to the native plugin / feature flag. Note that maps render via the WebView using the browser Google Maps JS SDK.

7. **Leave untouched**
   - `src/components/map/GoogleMapBackground.web.tsx`
   - `src/components/map/lagos-bounds.ts`, `map-style.ts`, `marker-icons.ts` (still used by the web impl)
   - `android/app/src/main/AndroidManifest.xml` — the `com.google.android.geo.API_KEY` meta-data is harmless when no native plugin reads it; removing it is optional and outside this revert.
   - All other Capacitor config, splash, push, audio, billing, admin, etc. work.

## Verification

- `bun run build` succeeds with no `@capacitor/google-maps` import in the graph.
- `rg "capacitor/google-maps|native-maps-flag|GoogleMapBackground.native"` returns no hits.
- Web preview map still renders (unchanged code path).
- Next `npx cap sync` + Android run: map renders via WebView exactly as it did before the native migration.
