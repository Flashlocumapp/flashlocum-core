// Capacitor native bridge — no-op in the browser, active in the iOS/Android shells.
//
// Imports are dynamic so the web bundle never pulls in native plugin code paths.
// Detection uses Capacitor.isNativePlatform() — the only safe way to branch
// because window.Capacitor is undefined in plain web builds.

let initialized = false;

export function isNative(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
  return !!w.Capacitor?.isNativePlatform?.();
}

export async function initNativeBridge(navigate: (path: string) => void) {
  if (initialized || !isNative()) return;
  initialized = true;

  try {
    const [{ App }, { StatusBar, Style }, { SplashScreen }] = await Promise.all([
      import("@capacitor/app"),
      import("@capacitor/status-bar"),
      import("@capacitor/splash-screen"),
    ]);

    // Status bar styling — match the splash charcoal.
    await StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
    await StatusBar.setBackgroundColor?.({ color: "#2a2a30" }).catch(() => {});

    // Hide splash once the WebView is interactive.
    await SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => {});

    // Universal Link / App Link / custom-scheme deep linking.
    // appUrlOpen fires when the OS hands a URL to the app.
    App.addListener("appUrlOpen", ({ url }) => {
      try {
        const parsed = new URL(url);
        // Strip the origin for in-app navigation. Supports both
        // https://app.flashlocum.com/path and flashlocum://path.
        const path = `${parsed.pathname}${parsed.search}${parsed.hash}` || "/";
        navigate(path);
      } catch {
        // Malformed URL — ignore.
      }
    });

    // Android hardware back button — let the router handle history.
    App.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack) {
        window.history.back();
      } else {
        App.exitApp().catch(() => {});
      }
    });
  } catch (err) {
    // Plugins missing on web — safe to ignore.
    console.warn("[capacitor] native bridge init skipped", err);
  }
}
