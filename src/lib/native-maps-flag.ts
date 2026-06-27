// Feature flag for the native Capacitor Google Maps implementation.
//
// Off → splitter returns the web (google.maps JS) impl even on native shells,
// reverting to the WebView map without a release. No user-facing settings.
//
// Resolution order:
//   1. localStorage["flashlocum.nativeMaps"] === "off" | "on"  (dev/QA)
//   2. import.meta.env.VITE_NATIVE_MAPS_ENABLED === "false"   (build kill switch)
//   3. default: on

const LS_KEY = "flashlocum.nativeMaps";

export function isNativeMapsEnabled(): boolean {
  try {
    if (typeof localStorage !== "undefined") {
      const v = localStorage.getItem(LS_KEY);
      if (v === "off") return false;
      if (v === "on") return true;
    }
  } catch {
    // localStorage may throw in private mode — ignore and fall through.
  }
  const envFlag = import.meta.env.VITE_NATIVE_MAPS_ENABLED;
  if (envFlag === "false") return false;
  return true;
}
