import { createFileRoute } from "@tanstack/react-router";
import { AdminStub } from "@/components/AdminStub";

export const Route = createFileRoute("/_admin/admin/risk")({
  ssr: false,
  component: () => (
    <AdminStub
      title="Reliability & Risk Monitoring"
      description="Early signal on trust-and-safety issues."
      bullets={[
        "Cancellation spikes (doctor and requester)",
        "No-show detection and disputed shifts",
        "Suspicious sign-up patterns and duplicate MDCN flags",
      ]}
    />
  ),
});
