// Splitter — selects the platform-appropriate GoogleMapBackground impl.
//
// Web (and SSR): always renders the google.maps JS implementation in
//   ./map/GoogleMapBackground.web.tsx. Behavior identical to the pre-split
//   component — call sites are unchanged.
//
// Native (Capacitor) with the native-maps feature flag ON: lazy-loads
//   ./map/GoogleMapBackground.native.tsx, the ONLY file that imports
//   @capacitor/google-maps. The lazy import keeps the native plugin out of
//   the web/SSR bundle entirely.

import { lazy, Suspense, useMemo } from "react";
import type { ComponentType } from "react";
import { isNative } from "@/lib/native";
import { isNativeMapsEnabled } from "@/lib/native-maps-flag";
import {
  GoogleMapBackground as WebGoogleMapBackground,
  type PlaceMapMarker,
} from "./map/GoogleMapBackground.web";

export type { PlaceMapMarker };

type Props = React.ComponentProps<typeof WebGoogleMapBackground>;

// Lazy native shell — only the first render on a native platform pulls
// in the @capacitor/google-maps module.
const LazyNative = lazy(async () => {
  const mod = await import("./map/GoogleMapBackground.native");
  return { default: mod.GoogleMapBackground as ComponentType<Props> };
});

export function GoogleMapBackground(props: Props) {
  const useNative = useMemo(() => isNative() && isNativeMapsEnabled(), []);
  if (!useNative) {
    return <WebGoogleMapBackground {...props} />;
  }
  return (
    <Suspense
      fallback={
        <div
          className="absolute inset-0"
          style={{ background: "var(--color-map)" }}
          aria-hidden
        />
      }
    >
      <LazyNative {...props} />
    </Suspense>
  );
}
