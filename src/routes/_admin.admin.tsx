import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_admin/admin")({
  ssr: false,
  component: () => <Outlet />,
});
