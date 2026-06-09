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
