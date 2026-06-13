import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  CalendarClock,
  Wallet,
  Activity,
  Building2,
  AlertTriangle,
  LifeBuoy,
  HeartPulse,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const sections = [
  { title: "Overview", url: "/admin", icon: LayoutDashboard, group: "Operations" },
  { title: "User Management", url: "/admin/users", icon: Users, group: "Operations" },
  { title: "Doctor Verification", url: "/admin/verification", icon: ShieldCheck, group: "Operations" },
  { title: "Shift Monitoring", url: "/admin/shifts", icon: CalendarClock, group: "Operations" },
  { title: "Financial Analytics", url: "/admin/finance", icon: Wallet, group: "Business" },
  { title: "Doctor Flashboard", url: "/admin/flashboard", icon: Activity, group: "Business" },
  { title: "Requester Analytics", url: "/admin/requesters", icon: Building2, group: "Business" },
  { title: "Reliability & Risk", url: "/admin/risk", icon: AlertTriangle, group: "Trust & Safety" },
  { title: "Support Tools", url: "/admin/support", icon: LifeBuoy, group: "Trust & Safety" },
  { title: "System Health", url: "/admin/system", icon: HeartPulse, group: "Platform" },
] as const;

const GROUP_ORDER = ["Operations", "Business", "Trust & Safety", "Platform"] as const;

export function AdminSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isActive = (url: string) =>
    url === "/admin" ? pathname === "/admin" : pathname.startsWith(url);

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <div className="px-4 pt-4 pb-2">
          <div className="text-[15px] font-semibold tracking-tight">FlashLocum</div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Admin</div>
        </div>
        {GROUP_ORDER.map((group) => (
          <SidebarGroup key={group}>
            <SidebarGroupLabel>{group}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {sections.filter((s) => s.group === group).map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)}>
                      <Link to={item.url} className="flex items-center gap-2">
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
