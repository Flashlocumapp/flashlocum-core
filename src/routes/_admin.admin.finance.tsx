import { createFileRoute } from "@tanstack/react-router";
import { AdminStub } from "@/components/AdminStub";

export const Route = createFileRoute("/_admin/admin/finance")({
  ssr: false,
  component: () => (
    <AdminStub
      title="Financial Analytics"
      description="Revenue, payouts, platform fees, and Monnify reconciliation."
      bullets={[
        "Daily / weekly / monthly revenue and fee trends",
        "Settlement ledger with paid / remitted / failed states",
        "Per-doctor and per-hospital lifetime value",
      ]}
    />
  ),
});
