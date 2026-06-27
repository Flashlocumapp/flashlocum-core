// Shared Lagos bounds + helpers. Used by both the web (google.maps JS) and
// native (@capacitor/google-maps) implementations of GoogleMapBackground.
//
// FlashLocum operates only inside Lagos State at launch — the map is hard-
// restricted to this rectangle and any out-of-bounds marker is dropped.

export type Coords = { lat: number; lng: number };

export const LAGOS_BOUNDS_LITERAL = {
  south: 6.35,
  west: 2.70,
  north: 6.80,
  east: 4.40,
} as const;

export const FALLBACK_CENTER: Coords = { lat: 6.5244, lng: 3.3792 };

export function inLagos(c: Coords): boolean {
  return (
    c.lat >= LAGOS_BOUNDS_LITERAL.south &&
    c.lat <= LAGOS_BOUNDS_LITERAL.north &&
    c.lng >= LAGOS_BOUNDS_LITERAL.west &&
    c.lng <= LAGOS_BOUNDS_LITERAL.east
  );
}
