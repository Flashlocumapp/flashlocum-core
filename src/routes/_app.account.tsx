import { createFileRoute } from "@tanstack/react-router";

// AccountScreen is mounted as a persistent layer inside AppShell
// (`src/routes/_app.tsx`).
export const Route = createFileRoute("/_app/account")({
  component: () => null,
});
