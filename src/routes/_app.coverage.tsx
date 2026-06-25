import { createFileRoute } from "@tanstack/react-router";

// CoverageScreen is mounted as a persistent layer inside AppShell
// (`src/routes/_app.tsx`). Routing into `/coverage` reveals that layer;
// routing away hides it. State, scroll, filters, and image decode survive
// tab switches. This route therefore renders nothing of its own.
export const Route = createFileRoute("/_app/coverage")({
  component: () => null,
});
