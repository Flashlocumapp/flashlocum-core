# Capacitor — iOS & Android Wrapping

This project is a TanStack Start app (SSR + server functions on Cloudflare Workers). The Capacitor shells load the **deployed production URL** in the WebView so every server-side feature (auth, server functions, Monnify checkout, webhooks) keeps working unchanged.

## One-time setup (on a Mac for iOS, any OS for Android)

```bash
# 1. Install platform projects
npx cap add ios
npx cap add android

# 2. Build the web bundle (used as fallback when server.url is offline)
npm run build

# 3. Copy web assets + config into the native projects
npx cap sync
```

## Day-to-day

```bash
npx cap sync          # after dep changes or capacitor.config.ts edits
npx cap open ios      # launches Xcode
npx cap open android  # launches Android Studio
```

The WebView points at `https://app.flashlocum.com` (see `capacitor.config.ts → server.url`). Push a Lovable deploy and the native app reflects it immediately — no resubmission needed for web-only changes.

## Deep linking

Routing is already wired in `src/lib/native.ts`:
- `appUrlOpen` parses incoming URLs and pushes them through TanStack Router.
- Android hardware back button uses browser history; exits on root.

### iOS — Universal Links
Host `apple-app-site-association` (no extension, `Content-Type: application/json`) at `https://app.flashlocum.com/.well-known/apple-app-site-association`:
```json
{
  "applinks": {
    "apps": [],
    "details": [{
      "appID": "TEAMID.com.flashlocum.app",
      "paths": ["*"]
    }]
  }
}
```
In Xcode → Signing & Capabilities → add **Associated Domains** → `applinks:app.flashlocum.com`.

### Android — App Links
Host `https://app.flashlocum.com/.well-known/assetlinks.json`:
```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.flashlocum.app",
    "sha256_cert_fingerprints": ["<release SHA-256>"]
  }
}]
```
Add an `<intent-filter>` with `android:autoVerify="true"` to `AndroidManifest.xml` for `https://app.flashlocum.com`.

### Custom scheme (OAuth fallback)
Add `flashlocum://` in `Info.plist` (`CFBundleURLSchemes`) and `AndroidManifest.xml`. The bridge already strips origin and navigates to the path.

## Browser-only dependencies — already verified safe

| Concern | Status |
| --- | --- |
| `localStorage` | Available in iOS/Android WebViews. |
| Supabase auth session | Uses `localStorage` — works in WebView. |
| Google Maps JS | Loads via HTTPS — `allowNavigation` whitelists `maps.googleapis.com`. |
| Geolocation | WebView prompts the OS; add `NSLocationWhenInUseUsageDescription` (iOS) and `ACCESS_FINE_LOCATION` (Android) when you start using it. |
| Service workers / PWA | Not registered — no conflicts with WebView caching. |
| Cookies / third-party | App uses Bearer tokens, not cookies — no `WKWebView` cookie issues. |
| `window.open` | Use `@capacitor/browser` (`Browser.open({ url })`) for external links to keep users in-app via SFSafariViewController / Chrome Custom Tab. |

## Safe-area insets

Already supported via `.safe-top` / `.safe-bottom` utilities and `viewport-fit=cover` in `__root.tsx`. iOS notch and Android gesture bar are handled automatically.

## Environment variables

The native shell does **not** ship `.env`. All `VITE_*` values are baked into the deployed site the WebView loads — no native-side config required.

## Releasing

1. Bump `version` in `package.json`, `ios/App/App.xcodeproj` (`MARKETING_VERSION`), and `android/app/build.gradle` (`versionName` / `versionCode`).
2. `npx cap sync`
3. Archive in Xcode → upload to App Store Connect.
4. `./gradlew bundleRelease` in `android/` → upload `.aab` to Play Console.

Lovable web deploys do **not** require store resubmission — only native code/icon/splash changes do.

---

## Native Google Maps (Capacitor)

The map surface uses two implementations behind a single component
(`src/components/GoogleMapBackground.tsx`):

- **Web** — `src/components/map/GoogleMapBackground.web.tsx`, the existing
  Google Maps JavaScript implementation. Used in the browser and SSR.
- **Native** — `src/components/map/GoogleMapBackground.native.tsx`, the
  ONLY file that imports `@capacitor/google-maps`. Lazy-loaded; never
  shipped to the web bundle.

The splitter selects native when `isNative() && isNativeMapsEnabled()`.

### Feature flag (`src/lib/native-maps-flag.ts`)

Resolution order:
1. `localStorage["flashlocum.nativeMaps"]` = `"off"` | `"on"` (dev/QA kill switch).
2. Build env `VITE_NATIVE_MAPS_ENABLED=false` forces off.
3. Default: on.

Flip to web on a running device:
```js
localStorage.setItem("flashlocum.nativeMaps", "off"); location.reload();
```

### API keys — separate browser and native keys

| Key | Where it lives | Used by |
|---|---|---|
| `VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY` | `.env` (Lovable connector) | Web map only (`loadMapsApi`) |
| Android native key | `android/app/src/main/AndroidManifest.xml` → `<meta-data android:name="com.google.android.geo.API_KEY" android:value="..."/>` inside `<application>` | Android Google Maps SDK |
| iOS native key | `ios/App/App/Info.plist` → `<key>GMSApiKey</key><string>...</string>` | iOS Google Maps SDK |
| `VITE_CAPACITOR_MAPS_API_KEY` | `.env` | Mirror passed to `GoogleMap.create({ apiKey })`; must equal the native manifest value |

Android Manifest snippet (inside `<application>`):

```xml
<meta-data
    android:name="com.google.android.geo.API_KEY"
    android:value="YOUR_NATIVE_ANDROID_KEY" />
```

iOS Info.plist snippet:

```xml
<key>GMSApiKey</key>
<string>YOUR_NATIVE_IOS_KEY</string>
```

Enable **Maps SDK for Android** / **Maps SDK for iOS** on the Google Cloud
project that owns the native keys — these are separate enablements from
the browser key's "Maps JavaScript API".

### Sync check

Run `node scripts/check-native-map-key.mjs` after editing any manifest or
`.env`. It parses both manifests and `.env`, and fails if the env mirror
diverges. Wire it into your `cap sync` step:

```sh
node scripts/check-native-map-key.mjs && npx cap sync android
```

The browser key is **never** used as a fallback for native. Missing /
mismatched key → native map renders the neutral fallback `<div>` and logs.

### Native Maps Verification

Fill in during step 4 of the rollout. Web column comes from Chrome
preview; Android column from an emulator/device build. iOS deferred until
macOS toolchain is available.

| # | Behavior | Web | Android | iOS |
|---|---|---|---|---|
| 1 | Map renders inside Lagos bounds | ☐ | ☐ | — |
| 2 | Requester "you are here" pulse marker | ☐ | ☐ | — |
| 3 | Doctor self stethoscope marker | ☐ | ☐ | — |
| 4 | Doctor markers add / move / remove on roster change | ☐ | ☐ | — |
| 5 | `markerScale=0.6` honored on Requester home | ☐ | ☐ | — |
| 6 | `center` prop pans camera on hospital select | ☐ | ☐ | — |
| 7 | Tab switch (`active` flip) recenters on user | ☐ | ☐ | — |
| 8 | Out-of-Lagos markers hidden | ☐ | ☐ | — |
| 9 | Strict bounds prevent panning outside Lagos | ☐ | ☐ | — |
| 10 | `placeMarkers` accepted but not rendered (parity) | ☐ | ☐ | — |
| 11 | Init failure → neutral fallback `<div>` (no crash) | ☐ | ☐ | — |
| 12 | Feature flag off on native → web impl renders | n/a | ☐ | — |
| 13 | GPS source unchanged (`src/lib/location.ts`) | ☐ | ☐ | — |

Attach `adb exec-out screencap -p > shotN.png` captures alongside each
Android row when running the report.
