/// <reference types="google.maps" />
// Shared map style. Used by the web (google.maps JS) implementation.
// The native @capacitor/google-maps plugin also accepts the same JSON
// shape via its `config.styles` field, so it is re-exported here for both.

export const LIGHT_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#aab2bd" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#11161d" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#e8ecf2" }, { weight: 2.5 }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ visibility: "off" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#0b1117" }] },
  { featureType: "administrative.locality", elementType: "labels.text.stroke", stylers: [{ color: "#e8ecf2" }, { weight: 3 }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#7fa07c" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#1f3a1f" }] },
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#9ea6b1" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#cfd4dc" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#cfd4dc" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#7e8aa3" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#4f5a72" }] },
  { featureType: "road", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#4f8aa8" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#0b2a38" }] },
  { featureType: "water", elementType: "labels.text.stroke", stylers: [{ color: "#bcd6e4" }, { weight: 2 }] },
];
