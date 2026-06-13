import { createFileRoute } from "@tanstack/react-router";
import { AdminStub } from "@/components/AdminStub";

export const Route = createFileRoute("/_admin/admin/support")({
  ssr: false,
  component: () => (
    <AdminStub
      title="Support Tools"
      description="One pane of glass for resolving user issues."
      bullets={[
        "Universal search across users, shifts, and payments",
        "Send targeted push notification to any user",
        "Internal notes timeline on user and shift records",
      ]}
    />
  ),
});
