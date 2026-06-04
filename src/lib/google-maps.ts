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
};

export type PlaceDetails = {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
};

// Lagos bias keeps results relevant to FlashLocum's launch market.
const BIAS_CENTER = { lat: 6.5244, lng: 3.3792 };

let sessionToken: google.maps.places.AutocompleteSessionToken | null = null;

async function ensurePlaces() {
  const g = await loadMapsApi();
  const lib = (await g.maps.importLibrary("places")) as google.maps.PlacesLibrary;
  if (!sessionToken) sessionToken = new lib.AutocompleteSessionToken();
  return { g, lib };
}

export async function fetchHospitalSuggestions(
  input: string,
  signal?: AbortSignal,
): Promise<PlaceSuggestion[]> {
  if (!input.trim()) return [];
  const { g, lib } = await ensurePlaces();
  if (signal?.aborted) return [];

  const { suggestions } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
    input,
    sessionToken: sessionToken!,
    includedPrimaryTypes: ["hospital", "doctor", "health"],
    locationBias: new g.maps.Circle({
      center: BIAS_CENTER,
      radius: 80_000,
    }),
  });

  if (signal?.aborted) return [];

  return suggestions
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({
      placeId: p.placeId,
      primary: p.mainText?.toString() ?? p.text.toString(),
      secondary: p.secondaryText?.toString() ?? "",
    }));
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
