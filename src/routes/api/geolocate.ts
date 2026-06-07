import { createFileRoute } from "@tanstack/react-router";

// IP-based geolocation fallback. Called from the client only when the
// browser's navigator.geolocation API fails, is denied, or times out — so
// the requester "you are here" dot can still appear at a reasonable point
// instead of being pinned to the Lagos fallback center.
export const Route = createFileRoute("/api/geolocate")({
  server: {
    handlers: {
      POST: async () => {
        const lovableKey = process.env.LOVABLE_API_KEY;
        const mapsKey = process.env.GOOGLE_MAPS_API_KEY;
        if (!lovableKey || !mapsKey) {
          return new Response(
            JSON.stringify({ error: "maps_connector_unconfigured" }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          );
        }
        try {
          const res = await fetch(
            "https://connector-gateway.lovable.dev/google_maps/geolocation/v1/geolocate",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${lovableKey}`,
                "X-Connection-Api-Key": mapsKey,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ considerIp: true }),
            },
          );
          if (!res.ok) {
            return new Response(
              JSON.stringify({ error: "upstream", status: res.status }),
              { status: 502, headers: { "Content-Type": "application/json" } },
            );
          }
          const data = (await res.json()) as {
            location?: { lat: number; lng: number };
            accuracy?: number;
          };
          if (!data.location) {
            return new Response(JSON.stringify({ error: "no_location" }), {
              status: 502,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(
            JSON.stringify({
              lat: data.location.lat,
              lng: data.location.lng,
              accuracy: data.accuracy ?? 50_000,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        } catch (e) {
          return new Response(
            JSON.stringify({ error: "exception", message: String(e) }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
