import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { claimFirstAdmin } from "@/lib/profile-remote";
import { pushToast } from "@/lib/notifications";

export const Route = createFileRoute("/admin/unauthorized")({
  ssr: false,
  component: AdminUnauthorized,
});

function AdminUnauthorized() {
  const navigate = useNavigate();
  const [claiming, setClaiming] = useState(false);

  const handleClaim = async () => {
    setClaiming(true);
    try {
      const ok = await claimFirstAdmin();
      if (ok) {
        pushToast({ tone: "presence", title: "You are now an admin." });
        navigate({ to: "/admin", replace: true });
      } else {
        pushToast({ tone: "warn", title: "An admin already exists." });
      }
    } catch (e) {
      pushToast({ tone: "warn", title: (e as Error).message });
    } finally {
      setClaiming(false);
    }
  };

  return (
    <main className="min-h-screen bg-background safe-top safe-bottom">
      <div className="mx-auto max-w-md px-6 pt-16 text-center">
        <h1 className="text-[22px] font-semibold tracking-tight">Admin access required</h1>
        <p className="mt-2 text-[14px] text-muted-foreground">
          Your account does not have admin privileges. If no admin exists yet, you can claim the
          first-admin role below.
        </p>
        <button
          onClick={handleClaim}
          disabled={claiming}
          className="mt-6 h-12 w-full rounded-2xl bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-60"
        >
          {claiming ? "Claiming…" : "Claim first-admin role"}
        </button>
        <button
          onClick={() => navigate({ to: "/home" })}
          className="mt-3 h-12 w-full rounded-2xl bg-secondary text-[14px] font-medium"
        >
          Back to app
        </button>
      </div>
    </main>
  );
}
