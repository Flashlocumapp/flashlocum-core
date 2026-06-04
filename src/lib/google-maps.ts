/// <reference types="google.maps" />
// Shared Google Maps JS API loader + Places helpers.
// Uses the Lovable-provisioned browser key for the Maps JS API.

const BROWSER_KEY = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as
  | string
  | undefined;
const TRACKING_ID = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID as
  | string
  | undefined;

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

// Lagos bounds — restricts results to Lagos State, Nigeria.
const LAGOS_BOUNDS: google.maps.LatLngBoundsLiteral = {
  south: 6.36,
  west: 3.05,
  north: 6.72,
  east: 3.60,
};
const BIAS_CENTER = { lat: 6.5244, lng: 3.3792 };

// Medical-only place types we accept from Google.
const MEDICAL_TYPES = new Set([
  "hospital",
  "medical_lab",
  "doctor",
  "dental_clinic",
  "dentist",
  "physiotherapist",
  "wellness_center",
  "pharmacy",
  "drugstore",
  "health",
]);
// Words that imply a medical facility when types are missing/loose.
const MEDICAL_KEYWORDS = /\b(hospital|clinic|medical|health|healthcare|diagnostic|maternity|pharmacy|surgery|specialist|cardio|ortho|dental|eye|optic|physio)\b/i;

function isMedicalPlace(name: string, address: string, types?: string[] | null) {
  if (types && types.some((t) => MEDICAL_TYPES.has(t))) return true;
  return MEDICAL_KEYWORDS.test(name) || MEDICAL_KEYWORDS.test(address);
}

function isInLagos(lat: number, lng: number) {
  return (
    lat >= LAGOS_BOUNDS.south &&
    lat <= LAGOS_BOUNDS.north &&
    lng >= LAGOS_BOUNDS.west &&
    lng <= LAGOS_BOUNDS.east
  );
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
  _origin?: google.maps.LatLngLiteral | null,
  signal?: AbortSignal,
): Promise<PlaceSuggestion[]> {
  const q = input.trim();
  if (!q) return [];
  const { g, lib } = await ensurePlaces();
  if (signal?.aborted) return [];

  const locationRestriction: google.maps.LatLngBoundsLiteral = LAGOS_BOUNDS;

  const byId = new Map<string, PlaceSuggestion>();
  const addSuggestion = (suggestion: PlaceSuggestion) => {
    const current = byId.get(suggestion.placeId);
    byId.set(suggestion.placeId, { ...current, ...suggestion });
  };

  // Primary: text search biased to medical facilities in Lagos.
  try {
    const { places } = await lib.Place.searchByText({
      textQuery: MEDICAL_KEYWORDS.test(q) ? q : `${q} hospital clinic`,
      fields: ["id", "displayName", "formattedAddress", "location", "types"],
      includedType: "hospital",
      useStrictTypeFiltering: false,
      locationRestriction,
      maxResultCount: 12,
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
      const name = place.displayName ?? q;
      const address = place.formattedAddress ?? "";
      if (!isMedicalPlace(name, address, place.types as string[] | undefined)) return;
      addSuggestion({
        placeId: id,
        primary: name,
        secondary: address,
        lat,
        lng,
      });
    });
  } catch {
    // Autocomplete fallback below.
  }

  // Secondary: autocomplete restricted to health-related primary types.
  try {
    const { suggestions } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input: q,
      sessionToken: sessionToken!,
      includedPrimaryTypes: ["hospital", "doctor", "dental_clinic", "pharmacy", "health"],
      includedRegionCodes: ["ng"],
      region: "NG",
      language: "en",
      locationRestriction: new g.maps.LatLngBounds(
        { lat: LAGOS_BOUNDS.south, lng: LAGOS_BOUNDS.west },
        { lat: LAGOS_BOUNDS.north, lng: LAGOS_BOUNDS.east },
      ),
    });

    suggestions
      .map((s) => s.placePrediction)
      .filter((p): p is NonNullable<typeof p> => !!p)
      .forEach((p) => {
        const primary = p.mainText?.toString() ?? p.text.toString();
        const secondary = p.secondaryText?.toString() ?? "";
        if (!isMedicalPlace(primary, secondary)) return;
        addSuggestion({
          placeId: p.placeId,
          primary,
          secondary,
        });
      });
  } catch {
    // Keep text-search results if autocomplete is unavailable.
  }

  if (signal?.aborted) return [];
  return Array.from(byId.values()).slice(0, 10);
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
