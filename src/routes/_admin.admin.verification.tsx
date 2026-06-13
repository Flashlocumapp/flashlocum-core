import { createFileRoute } from "@tanstack/react-router";
import { AdminStub } from "@/components/AdminStub";

export const Route = createFileRoute("/_admin/admin/verification")({
  ssr: false,
  component: () => (
    <AdminStub
      title="Doctor Verification"
      description="Review submissions, validate credentials, and decide on approvals."
      bullets={[
        "Pending queue with submission age",
        "Selfie, MDCN, NYSC and receipt review side-by-side",
        "Approve / reject / suspend with audit-logged reasons",
      ]}
    />
  ),
});
