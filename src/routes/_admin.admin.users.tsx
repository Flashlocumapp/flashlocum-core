import { createFileRoute } from "@tanstack/react-router";
import { AdminStub } from "@/components/AdminStub";

export const Route = createFileRoute("/_admin/admin/users")({
  ssr: false,
  component: () => (
    <AdminStub
      title="User Management"
      description="Search, filter, and act on every account across the platform."
      bullets={[
        "Server-side paginated search by name, email, phone, MDCN",
        "Role / verification / location filters",
        "Account actions: suspend, restore, force sign-out",
      ]}
    />
  ),
});
