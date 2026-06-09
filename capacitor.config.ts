import type { CapacitorConfig } from "@capacitor/cli";

/**
 * FlashLocum — Capacitor configuration
 *
 * This app uses TanStack Start (SSR + server functions on Cloudflare Workers).
 * A Capacitor WebView cannot run that server runtime locally, so the native
 * shells load the deployed production URL directly. All server functions,
 * Supabase auth flows, Monnify webhooks, and Google Maps calls continue to
 * work exactly as they do in the browser.
 *
 * Deep links resolve via:
 *   • iOS:     Universal Links on app.flashlocum.com (apple-app-site-association)
 *   • Android: App Links on app.flashlocum.com (assetlinks.json) + custom scheme
 *
 * Local development: comment out `server.url` and run `npm run build` +
 * `npx cap sync` to load the static bundle from the device instead of the
 * deployed site.
 */
const config: CapacitorConfig = {
  appId: "com.flashlocum.app",
  appName: "FlashLocum",
  webDir: "dist",
  bundledWebRuntime: false,
  server: {
    // Native shells load the published Lovable site so SSR + server functions work.
    url: "https://app.flashlocum.com",
    androidScheme: "https",
    cleartext: false,
    // Allow Lovable preview + Supabase + Google APIs the WebView may navigate to.
    allowNavigation: [
      "app.flashlocum.com",
      "flashlocum-core.lovable.app",
      "*.lovable.app",
      "*.supabase.co",
      "*.googleapis.com",
      "maps.googleapis.com",
      "accounts.google.com",
      "checkout.monnify.com",
      "sandbox.monnify.com",
    ],
  },
  ios: {
    contentInset: "always",
    limitsNavigationsToAppBoundDomains: false,
    backgroundColor: "#2a2a30",
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    backgroundColor: "#2a2a30",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: "#2a2a30",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#2a2a30",
      overlaysWebView: false,
    },
    App: {
      // Custom URL scheme for OAuth callbacks / deep links not on the universal link domain.
      // Pair this with iOS Info.plist CFBundleURLSchemes and Android intent-filter.
    },
  },
};

export default config;
