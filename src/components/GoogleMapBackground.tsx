// Re-export the web (google.maps JS) implementation for all platforms.
// On Capacitor (Android/iOS) the WebView renders the same JS map; there is
// no native Google Maps SDK path.

export {
  GoogleMapBackground,
  type PlaceMapMarker,
} from "./map/GoogleMapBackground.web";
