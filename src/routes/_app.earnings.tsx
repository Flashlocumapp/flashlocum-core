import { createFileRoute } from "@tanstack/react-router";

// EarningsScreen is mounted as a persistent layer inside AppShell
// (`src/routes/_app.tsx`).
export const Route = createFileRoute("/_app/earnings")({
  component: () => null,
});
