# Native Google Map — blank on Android emulator

## Root-cause audit

`@capacitor/google-maps@8.0.1` (installed) declares this `GoogleMapConfig` for native (only these fields are honoured by Android/iOS — anything else comes from `extends google.maps.MapOptions` and is **web-only**):

- `width`, `height`, `x`, `y`
- `center` (required), `zoom` (required)
- `androidLiteMode`, `devicePixelRatio`
- `styles`
- `mapId` / `androidMapId` / `iOSMapId`
- `maxZoom` (and `minZoom` from MapOptions — accepted in practice)

Our current `GoogleMap.create({ config })` in `GoogleMapBackground.native.tsx` passes several **JS-Maps-only** options that the Android SDK does not understand and which can trigger silent failures or, with the wrong combination, an init throw:

| Property we send | Status on native |
| --- | --- |
| `restriction: { latLngBounds, strictBounds }` | Web-only (camera bounds restriction must be done via `map.setCamera`/`enableTrafficLayer`-style APIs — not supported in v8 native; we'll enforce Lagos clamp in JS as we already do via `inLagos`) |
| `disableDefaultUI` | Web-only |
| `gestureHandling: "greedy"` | Web-only |
| `clickableIcons` | Web-only |
| `backgroundColor` | Web-only |
| `styles` | OK (supported on native since 4.3.0) |
| `minZoom` / `maxZoom` | OK |

Independently, the Android plugin **renders the GoogleMap behind the WebView at the host element's screen rect**. Every ancestor of the host (including the host itself) must be transparent or the map is invisible. Today the native component sets `<div className="absolute inset-0 overflow-hidden" style={{ background: "#aab2bd" }}>` as the host's parent, which is opaque and will cover the native map even if init succeeds. The app shell also paints `var(--color-background)`, which is opaque.

These two issues together fully explain a blank map even though `isNative()` correctly selects the native impl.

## Changes

All edits limited to `src/components/map/GoogleMapBackground.native.tsx` plus a tiny CSS hook.

### 1. Strip web-only options from `GoogleMap.create`

Pass only fields supported by the native `GoogleMapConfig`:

```ts
const map = await GoogleMap.create({
  id,
  element: hostRef.current!,
  apiKey: NATIVE_KEY,
  forceCreate: true, // recover cleanly across HMR / strict-mode double-mount
  config: {
    center: { lat: initial.lat, lng: initial.lng },
    zoom: 12,
    minZoom: 10,
    maxZoom: 18,
    styles: LIGHT_STYLE,
    devicePixelRatio: window.devicePixelRatio || 1,
  },
});
```

Lagos bounds clamping stays — already enforced in JS via `inLagos(...)` before every `setCamera` and before adding any marker, so removing `restriction` does not change behaviour.

### 2. Transparent host + WebView so the native map is visible

The native map is drawn behind the WebView at the host's rect. Three things must be transparent:

a. **The host div and its immediate wrapper** in `GoogleMapBackground.native.tsx`:

```tsx
<div className="absolute inset-0 overflow-hidden" style={{ background: "transparent" }}>
  <div
    ref={hostRef}
    className="absolute inset-0 h-full w-full capacitor-google-map"
    style={{ background: "transparent" }}
  />
  {/* keep the bottom gradient overlay */}
</div>
```

b. **A scoped CSS rule** so any ancestor up to `<body>` that the map peeks through is transparent only while a native map is mounted. Add to `src/styles.css`:

```css
/* Capacitor Google Maps renders the native view behind the WebView.
   When a native map is mounted, mark the chain transparent so it is visible. */
html.capacitor-native-map,
html.capacitor-native-map body,
html.capacitor-native-map #root {
  background: transparent !important;
}
.capacitor-google-map { background: transparent !important; }
```

c. **Toggle the `capacitor-native-map` class on `<html>`** in the native component's create/destroy effect, so the transparent chain only applies while the map exists and the web build is completely unaffected.

### 3. Full diagnostic logging around `GoogleMap.create`

Replace the existing `console.warn("[capacitor-maps] init failed", err)` with structured logs that survive the silent fallback:

```ts
console.info("[capacitor-maps] create:begin", {
  id, hasKey: !!NATIVE_KEY, keyLen: NATIVE_KEY?.length,
  center: initial, hostRect: hostRef.current?.getBoundingClientRect(),
});
try {
  const map = await GoogleMap.create({ ... });
  console.info("[capacitor-maps] create:ok", { id });
  // ...
} catch (err) {
  const e = err as { message?: string; code?: string; stack?: string };
  console.error("[capacitor-maps] create:failed", {
    id,
    message: e?.message ?? String(err),
    code: e?.code,
    stack: e?.stack,
    raw: err,
  });
  setFailed(true);
  setLastError(e?.message ?? String(err));
}
```

Surface `lastError` in the fallback `<div>` (small dev-only overlay gated by `import.meta.env.DEV || isNative()`) so a real device shows the actual exception instead of a blank tile — required by the brief ("include the complete exception and root cause rather than falling back silently").

### 4. Guard against zero-size host (a separate well-known blank-map cause)

Before calling `GoogleMap.create`, if `hostRef.current.getBoundingClientRect()` reports `width === 0 || height === 0`, log `[capacitor-maps] create:skipped zero-size host` and retry on the next animation frame. The plugin uses the rect at creation time as the native view's frame; a zero-size host yields an invisible map even when init succeeds.

## Verification (after switching to build mode)

1. `bun run build` must pass (web bundle unchanged — native file is lazy-loaded).
2. Reinstall the APK on the Pixel 5 Google APIs emulator and open Chrome remote-devtools on the WebView. Expected logs in order:
   - `[capacitor-maps] create:begin { hasKey: true, keyLen: 39, center: {...}, hostRect: { width: >0, height: >0 } }`
   - `[capacitor-maps] create:ok`
3. The map tiles render with the requester/doctor markers visible. If `create:failed` appears, the full error object now prints with `message` + `code` + `stack` for the next pass.

## Out of scope

- Web `GoogleMapBackground.web.tsx` — untouched.
- Business logic (marker pool, GPS subscription, Lagos clamp) — untouched.
- iOS verification — same fix applies but the brief is Android-only.
