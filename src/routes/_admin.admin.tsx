import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchAdminOverview,
  type AdminOverviewStats,
} from "@/lib/profile-remote";
import { pushToast } from "@/lib/notifications";
import {
  AdminPageHeader,
  RefreshButton,
  StatCard,
} from "@/lib/admin-ui";

export const Route = createFileRoute("/_admin/admin")({
  ssr: false,
  component: AdminOverview,
});

function AdminOverview() {
  const [stats, setStats] = useState<AdminOverviewStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const s = await fetchAdminOverview();
      setStats(s);
    } catch (e) {
      pushToast({ tone: "warn", title: (e as Error).message || "Refresh failed." });
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Realtime pulse: coalesce WAL bursts and refetch aggregate stats.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const trigger = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void refresh();
      }, 3000);
    };
    const ch = supabase
      .channel("admin-overview-pulse")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, trigger)
      .on("postgres_changes", { event: "*", schema: "public", table: "doctor_presence" }, trigger)
      .on("postgres_changes", { event: "*", schema: "public", table: "coverage_requests" }, trigger)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(ch);
    };
  }, [refresh]);

  const groups = useMemo(
    () => [
      {
        title: "Users",
        cards: [
          { label: "Total Users", value: stats?.total_users },
          { label: "Request Coverage", value: stats?.request_users },
          { label: "Cover & Earn", value: stats?.cover_users },
        ],
      },
      {
        title: "Doctors",
        cards: [
          { label: "Verified", value: stats?.verified_doctors, tone: "presence" as const },
          { label: "Pending", value: stats?.pending_doctors, tone: "warn" as const },
          { label: "Rejected", value: stats?.rejected_doctors, tone: "danger" as const },
          { label: "Suspended", value: stats?.suspended_doctors, tone: "warn" as const },
          { label: "Online Now", value: stats?.online_doctors, tone: "presence" as const, live: true },
        ],
      },
      {
        title: "Coverage",
        cards: [
          { label: "In Progress", value: stats?.coverage_in_progress, tone: "presence" as const, live: true },
          { label: "Upcoming", value: stats?.coverage_upcoming },
          { label: "Completed", value: stats?.coverage_completed },
          { label: "Cancelled", value: stats?.coverage_cancelled, tone: "danger" as const },
        ],
      },
      {
        title: "Activity",
        cards: [
          { label: "Active Today", value: stats?.active_today, tone: "presence" as const },
          { label: "Active This Week", value: stats?.active_week },
        ],
      },
    ],
    [stats],
  );

  return (
    <div className="p-6 lg:p-8">
      <AdminPageHeader
        title="Dashboard Overview"
        subtitle="Operational pulse across FlashLocum — refreshes live."
        right={<RefreshButton onClick={() => void refresh()} busy={refreshing} />}
      />

      <div className="mt-6 space-y-7">
        {groups.map((g) => (
          <section key={g.title}>
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {g.title}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {g.cards.map((c) => (
                <StatCard
                  key={c.label}
                  label={c.label}
                  value={c.value}
                  tone={(c as { tone?: "presence" | "warn" | "danger" }).tone}
                  live={(c as { live?: boolean }).live}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
