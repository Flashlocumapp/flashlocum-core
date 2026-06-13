import { createFileRoute } from "@tanstack/react-router";
import { AdminStub } from "@/components/AdminStub";

export const Route = createFileRoute("/_admin/admin/requesters")({
  ssr: false,
  component: () => (
    <AdminStub
      title="Requester Analytics"
      description="Demand-side health and behavior."
      bullets={[
        "Request volume by hospital and location",
        "Repeat-request rate, cancellation rate, time-to-fill",
        "Top requesters and churn watchlist",
      ]}
    />
  ),
});
