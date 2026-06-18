import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { adminListShifts, type AdminShiftRow } from "@/lib/admin.functions";
import { pushToast } from "@/lib/notifications";
import {
  AdminPageHeader,
  Chip,
  Empty,
  RefreshButton,
  fmt,
  fmtNaira,
  fmtRelative,
} from "@/lib/admin-ui";

export const Route = createFileRoute("/_admin/admin/shifts")({
  ssr: false,
  component: AdminShiftsPage,
});

type Status =
  | "all"
  | "searching"
  | "accepted"
  | "active"
  | "paused"
  | "completed"
  | "cancelled";

function statusColor(s: string): string {
  switch (s) {
    case "active":
    case "accepted":
      return "var(--color-presence)";
    case "searching":
      return "#2563eb";
    case "paused":
      return "#c2410c";
    case "completed":
      return "var(--color-muted-foreground)";
    case "cancelled":
      return "#b91c1c";
    default:
      return "var(--color-muted-foreground)";
  }
}

function AdminShiftsPage() {
  const list = useServerFn(adminListShifts);
  const [shifts, setShifts] = useState<AdminShiftRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<Status>("all");
  const [q, setQ] = useState("");

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const rows = await list({ data: { status } });
      setShifts(rows);
    } catch (e) {
      pushToast({ tone: "warn", title: (e as Error).message || "Refresh failed." });
    } finally {
      setRefreshing(false);
    }
  }, [list, status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Realtime: bump on any coverage_requests change, coalesced.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ch = supabase
      .channel("admin-shifts-stream")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "coverage_requests" },
        () => {
          if (timer) return;
          timer = setTimeout(() => {
            timer = null;
            void refresh();
          }, 5000);
        },
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(ch);
    };
  }, [refresh]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return shifts;
    return shifts.filter((r) =>
      [
        r.hospital,
        r.area,
        r.requester_name,
        r.requester_email,
        r.doctor_name,
        r.doctor_phone,
        r.coverage_type,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(s)),
    );
  }, [shifts, q]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      all: shifts.length,
      searching: 0,
      accepted: 0,
      active: 0,
      paused: 0,
      completed: 0,
      cancelled: 0,
    };
    for (const r of shifts) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [shifts]);

  const filters: { id: Status; label: string }[] = [
    { id: "all", label: `All (${counts.all})` },
    { id: "searching", label: `Searching (${counts.searching})` },
    { id: "accepted", label: `Accepted (${counts.accepted})` },
    { id: "active", label: `Active (${counts.active})` },
    { id: "paused", label: `Paused (${counts.paused})` },
    { id: "completed", label: `Completed (${counts.completed})` },
    { id: "cancelled", label: `Cancelled (${counts.cancelled})` },
  ];

  return (
    <div className="p-6 lg:p-8">
      <AdminPageHeader
        title="Shift Monitoring"
        subtitle={`${filtered.length} of ${shifts.length} shifts — live`}
        right={<RefreshButton onClick={() => void refresh()} busy={refreshing} />}
      />

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search hospital, area, requester, doctor…"
          className="h-10 flex-1 min-w-[260px] rounded-xl bg-secondary px-4 text-[13.5px] outline-none"
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {filters.map((f) => {
          const active = f.id === status;
          return (
            <button
              key={f.id}
              onClick={() => setStatus(f.id)}
              className={`h-9 rounded-full px-3 text-[12px] font-medium transition ${
                active ? "bg-primary text-primary-foreground" : "bg-secondary"
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <div
        className="mt-5 overflow-hidden rounded-2xl border"
        style={{ background: "var(--color-surface-elevated)" }}
      >
        {filtered.length === 0 ? (
          <div className="p-6">
            <Empty>No shifts match these filters.</Empty>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-secondary/60 text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Hospital</th>
                  <th className="px-4 py-2.5 font-medium">Schedule</th>
                  <th className="px-4 py-2.5 font-medium">Requester</th>
                  <th className="px-4 py-2.5 font-medium">Doctor</th>
                  <th className="px-4 py-2.5 font-medium">Amount</th>
                  <th className="px-4 py-2.5 font-medium">Payment</th>
                  <th className="px-4 py-2.5 font-medium">Ratings</th>
                  <th className="px-4 py-2.5 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t hover:bg-secondary/30 align-top cursor-pointer"
                    onClick={() => setOpenRow(r)}
                  >
                    <td className="px-4 py-2.5">
                      <Chip color={statusColor(r.status)}>{r.status}</Chip>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium tracking-tight">{r.hospital}</div>
                      <div className="text-[11.5px] text-muted-foreground">
                        {r.area} · {r.coverage_type}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      <div>{r.day}</div>
                      <div className="text-[11.5px]">
                        {r.start_time}–{r.end_time} · {r.duration_hrs}h
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      <div className="text-foreground">{r.requester_name || "—"}</div>
                      <div className="text-[11.5px] truncate max-w-[200px]">
                        {r.requester_email || ""}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      <div className="text-foreground">{r.doctor_name || "—"}</div>
                      <div className="text-[11.5px]">{r.doctor_phone || ""}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      {(() => {
                        if (r.paid_at) {
                          const v = r.settled_amount ?? r.total_billed_amount ?? 0;
                          return (
                            <>
                              <div>{fmtNaira(v)}</div>
                              <div className="text-[11px] text-muted-foreground">Paid</div>
                            </>
                          );
                        }
                        if (r.total_billed_amount != null) {
                          return (
                            <>
                              <div>{fmtNaira(r.total_billed_amount)}</div>
                              <div className="text-[11px] text-muted-foreground">Due</div>
                            </>
                          );
                        }
                        return (
                          <>
                            <div>{fmtNaira(r.amount)}</div>
                            <div className="text-[11px] text-muted-foreground">Est.</div>
                          </>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {r.payment_status || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      <div>{fmtRelative(r.updated_at)}</div>
                      <div className="text-[11px]">{fmt(r.created_at)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
