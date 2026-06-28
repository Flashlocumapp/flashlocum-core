/// <reference types="google.maps" />
// Shared Google Maps JS API loader + Places helpers.
// Uses the Lovable-provisioned browser key for the Maps JS API.

const BROWSER_KEY = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as
  string | undefined;
const TRACKING_ID = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID as
  string | undefined;

let loaderPromise: Promise<typeof google> | null = null;

export function hasMapsKey(): boolean {
  return !!BROWSER_KEY;
}

export function loadMapsApi(): Promise<typeof google> {
  if (typeof window === "undefined") return Promise.reject(new Error("no-window"));
  const w = window as unknown as { google?: typeof google };
  if (w.google?.maps) return Promise.resolve(w.google);
  if (loaderPromise) return loaderPromise;
  if (!BROWSER_KEY) return Promise.reject(new Error("missing-google-maps-key"));

  loaderPromise = new Promise<typeof google>((resolve, reject) => {
    const cbName = `__flashlocum_gmaps_cb_${Date.now()}`;
    (window as unknown as Record<string, unknown>)[cbName] = () => {
      resolve((window as unknown as { google: typeof google }).google);
      delete (window as unknown as Record<string, unknown>)[cbName];
    };
    const params = new URLSearchParams({
      key: BROWSER_KEY,
      loading: "async",
      libraries: "places",
      callback: cbName,
    });
    if (TRACKING_ID) params.set("channel", TRACKING_ID);
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      loaderPromise = null;
      reject(new Error("maps-script-failed"));
    };
    document.head.appendChild(script);
  });
  return loaderPromise;
}

export type PlaceSuggestion = {
  placeId: string;
  primary: string;
  secondary: string;
  lat?: number;
  lng?: number;
};

export type PlaceDetails = {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
};

// Lagos State bounds — FlashLocum is restricted to Lagos at launch.
// Tightened to the actual state extent (was previously too wide and let
// Ogun State coordinates slip through). Any pin, search result, or
// selection outside this box is rejected.
export const LAGOS_BOUNDS = {
  sw: { lat: 6.393, lng: 2.703 },
  ne: { lat: 6.702, lng: 3.692 },
} as const;

export function isInLagos(lat?: number | null, lng?: number | null): boolean {
  if (lat == null || lng == null) return false;
  return (
    lat >= LAGOS_BOUNDS.sw.lat &&
    lat <= LAGOS_BOUNDS.ne.lat &&
    lng >= LAGOS_BOUNDS.sw.lng &&
    lng <= LAGOS_BOUNDS.ne.lng
  );
}

type AddressComponent = { longText?: string; shortText?: string; types?: string[] };
function isLagosAdminArea(components: AddressComponent[] | null | undefined): boolean {
  if (!components || components.length === 0) return true; // fall back to bounds-only check
  for (const c of components) {
    if (c.types?.includes("administrative_area_level_1")) {
      const txt = `${c.longText ?? ""} ${c.shortText ?? ""}`.toLowerCase();
      return /\blagos\b/.test(txt);
    }
  }
  return true; // no admin_area_level_1 returned — don't over-reject
}

function looksLikeLagosText(secondary: string): boolean {
  return /\blagos\b/i.test(secondary);
}

let sessionToken: google.maps.places.AutocompleteSessionToken | null = null;

async function ensurePlaces() {
  const g = await loadMapsApi();
  const lib = (await g.maps.importLibrary("places")) as google.maps.PlacesLibrary;
  if (!sessionToken) sessionToken = new lib.AutocompleteSessionToken();
  return { g, lib };
}

export async function fetchHospitalSuggestions(
  input: string,
  origin?: google.maps.LatLngLiteral | null,
  signal?: AbortSignal,
): Promise<PlaceSuggestion[]> {
  const q = input.trim();
  if (!q) return [];
  const { g, lib } = await ensurePlaces();
  if (signal?.aborted) return [];
  void origin;

  const byId = new Map<string, PlaceSuggestion>();

  const addSuggestion = (suggestion: PlaceSuggestion) => {
    const current = byId.get(suggestion.placeId);
    byId.set(suggestion.placeId, { ...current, ...suggestion });
  };

  const locationRestriction: google.maps.LatLngBoundsLiteral = {
    south: LAGOS_BOUNDS.sw.lat,
    west: LAGOS_BOUNDS.sw.lng,
    north: LAGOS_BOUNDS.ne.lat,
    east: LAGOS_BOUNDS.ne.lng,
  };

  try {
    const { places } = await lib.Place.searchByText({
      textQuery: q,
      fields: ["id", "displayName", "formattedAddress", "location", "addressComponents"],
      locationRestriction,
      maxResultCount: 10,
      region: "NG",
      language: "en",
      rankPreference: "RELEVANCE",
    });

    places.forEach((place) => {
      const id = place.id;
      const loc = place.location;
      if (!id || !loc) return;
      const lat = loc.lat();
      const lng = loc.lng();
      if (!isInLagos(lat, lng)) return;
      // Deterministic admin-area filter on top of bounds: reject any place
      // whose `administrative_area_level_1` is not Lagos State (e.g. Ogun
      // border towns whose coords sneak inside the rectangle).
      const components = (place.addressComponents ?? null) as AddressComponent[] | null;
      if (!isLagosAdminArea(components)) return;
      addSuggestion({
        placeId: id,
        primary: place.displayName ?? q,
        secondary: place.formattedAddress ?? "",
        lat,
        lng,
      });
    });
  } catch {
    // Autocomplete below still gives the user selectable live Google Places results.
  }

  // Autocomplete predictions are intentionally NOT used as a fallback here.
  // See note above on locationRestriction reliability.
  void g;
  void looksLikeLagosText;

  if (signal?.aborted) return [];
  return Array.from(byId.values()).slice(0, 8);
}

export async function fetchPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
  const { lib } = await ensurePlaces();
  const place = new lib.Place({ id: placeId });
  await place.fetchFields({
    fields: ["displayName", "formattedAddress", "location"],
  });
  // Reset the session token after a successful selection (billing best practice).
  sessionToken = null;
  const loc = place.location;
  if (!loc) return null;
  return {
    placeId,
    name: place.displayName ?? "",
    address: place.formattedAddress ?? "",
    lat: loc.lat(),
    lng: loc.lng(),
  };
}
