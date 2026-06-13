import { createFileRoute } from "@tanstack/react-router";
import { AdminStub } from "@/components/AdminStub";

export const Route = createFileRoute("/_admin/admin/system")({
  ssr: false,
  component: () => (
    <AdminStub
      title="System Health"
      description="Platform vitals at a glance."
      bullets={[
        "Email queue depth and dead-letter counts",
        "Push delivery success rate",
        "Database slow queries and edge function errors",
      ]}
    />
  ),
});
