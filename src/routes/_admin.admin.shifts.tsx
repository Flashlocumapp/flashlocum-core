import { createFileRoute } from "@tanstack/react-router";
import { AdminStub } from "@/components/AdminStub";

export const Route = createFileRoute("/_admin/admin/shifts")({
  ssr: false,
  component: () => (
    <AdminStub
      title="Shift Monitoring"
      description="Live and historical view of every coverage request."
      bullets={[
        "Realtime feed of searching / accepted / active shifts",
        "Filter by status, hospital, doctor, date range",
        "Drill-in: timeline, parties, payment, cancellation reasons",
      ]}
    />
  ),
});
