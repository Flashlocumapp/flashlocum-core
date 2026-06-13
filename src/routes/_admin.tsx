import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { ensureAuthReady } from "@/lib/auth-ready";
import { checkIsAdmin } from "@/lib/admin.functions";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AdminSidebar } from "@/components/AdminSidebar";

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
      if (err && typeof err === "object" && "isRedirect" in (err as object)) throw err;
      throw redirect({ to: "/admin/unauthorized", replace: true });
    }
  },
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AdminSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-12 flex items-center border-b px-3 gap-2 bg-background/80 backdrop-blur">
            <SidebarTrigger />
            <div className="text-[12.5px] text-muted-foreground">FlashLocum Admin Console</div>
          </header>
          <main className="flex-1 min-w-0">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
