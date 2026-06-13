import { createFileRoute } from "@tanstack/react-router";
import { AdminStub } from "@/components/AdminStub";

export const Route = createFileRoute("/_admin/admin/flashboard")({
  ssr: false,
  component: () => (
    <AdminStub
      title="Doctor Flashboard"
      description="Operational pulse on the supply side."
      bullets={[
        "Who is online right now, by region",
        "Acceptance rate, average response time, completion rate",
        "Rating distribution and outliers",
      ]}
    />
  ),
});
