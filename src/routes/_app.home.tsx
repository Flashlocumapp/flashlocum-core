import { createFileRoute } from "@tanstack/react-router";

// The Home UI (map, search sheet, dispatch overlays) is mounted ONCE in
// AppShell (`src/routes/_app.tsx`) as a persistent layer that is toggled by
// CSS `display`. Routing into `/home` simply reveals that layer; routing
// away hides it. This keeps the Google Map instance, markers, camera
// position, GPS subscription, and all in-flight state alive across tab
// switches, instead of unmounting and re-creating the map every time the
// user touches Coverage or Account and comes back.
//
// This route therefore renders nothing of its own.
export const Route = createFileRoute("/_app/home")({
  component: () => null,
});
