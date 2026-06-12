import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { ensureAuthReady } from "@/lib/auth-ready";
import { checkIsAdmin } from "@/lib/admin.functions";

export const Route = createFileRoute("/_admin")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const auth = await ensureAuthReady();
    if (!auth.session) {
      throw redirect({
        to: "/role",
        search: { redirect: location.href },
        replace: true,
      });
    }
    try {
      const res = await checkIsAdmin();
      if (!res?.isAdmin) {
        throw redirect({ to: "/admin/unauthorized", replace: true });
      }
    } catch (err) {
      // Re-throw router redirects; otherwise treat as unauthorized.
      if (err && typeof err === "object" && "isRedirect" in (err as object)) throw err;
      throw redirect({ to: "/admin/unauthorized", replace: true });
    }
  },
  component: () => <Outlet />,
});
