import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { adminListCancellations, type AdminCancellationRow } from "@/lib/admin.functions";
import { AdminPageHeader, RefreshButton, Empty } from "@/lib/admin-ui";
import { labelForCode } from "@/lib/cancellation-reasons";

export const Route = createFileRoute("/_admin/admin/cancellations")({
  ssr: false,
  component: CancellationsPage,
});

function fmtDate(s: string | null) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

function roleLabel(by: string | null) {
  if (by === "doctor") return "Doctor";
  if (by === "requester") return "Requester";
  return "—";
}

function CancellationsPage() {
  const fetchRows = useServerFn(adminListCancellations);
  const [roleFilter, setRoleFilter] = useState<"all" | "doctor" | "requester">("all");
  const [search, setSearch] = useState("");

  const q = useQuery({
    queryKey: ["admin", "cancellations"],
    queryFn: () => fetchRows({ data: { limit: 500 } }) as Promise<AdminCancellationRow[]>,
    staleTime: 30_000,
  });

  const rows = q.data ?? [];
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (roleFilter !== "all" && r.cancelled_by !== roleFilter) return false;
      if (!term) return true;
      return (
        r.shift_id.toLowerCase().includes(term) ||
        (r.actor_name ?? "").toLowerCase().includes(term) ||
        (r.hospital ?? "").toLowerCase().includes(term) ||
        (r.reason_text ?? "").toLowerCase().includes(term)
      );
    });
  }, [rows, roleFilter, search]);

  return (
    <div className="space-y-6 p-6">
      <AdminPageHeader
        title="Cancellations"
        subtitle="Every cancelled shift with reason and free-text explanation."
        right={<RefreshButton onClick={() => q.refetch()} busy={q.isFetching} />}
      />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="flex items-center gap-1 rounded-full border border-border/60 p-0.5">
          {(["all", "requester", "doctor"] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => setRoleFilter(opt)}
              className={`rounded-full px-3 py-1 text-[12.5px] capitalize transition ${
                roleFilter === opt
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt === "all" ? "All" : opt}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search shift ID, user, hospital, reason text…"
          className="h-9 flex-1 min-w-[240px] rounded-md border border-border/60 bg-background px-3 text-[13px] outline-none focus:border-foreground/40"
        />
        <span className="text-[12px] text-muted-foreground">
          {filtered.length} of {rows.length}
        </span>
      </div>

      {q.isLoading ? (
        <Empty>Loading cancellations…</Empty>
      ) : q.isError ? (
        <Empty>Failed to load: {(q.error as Error)?.message ?? "Unknown error"}</Empty>
      ) : filtered.length === 0 ? (
        <Empty>No cancelled shifts match the current filters.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border/60">
          <table className="w-full min-w-[960px] text-[13px]">
            <thead className="bg-muted/40 text-left text-[11.5px] uppercase tracking-[0.08em] text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Cancelled at</th>
                <th className="px-3 py-2">Shift ID</th>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Hospital</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2">Free-text explanation</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.shift_id} className="border-t border-border/40 align-top">
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                    {fmtDate(r.cancelled_at)}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11.5px]">{r.shift_id.slice(0, 8)}…</td>
                  <td className="px-3 py-2">{r.actor_name ?? "—"}</td>
                  <td className="px-3 py-2">{roleLabel(r.cancelled_by)}</td>
                  <td className="px-3 py-2">{r.hospital ?? "—"}</td>
                  <td className="px-3 py-2">{r.reason_code ? labelForCode(r.reason_code) : "—"}</td>
                  <td className="px-3 py-2 max-w-[320px] whitespace-pre-wrap text-muted-foreground">
                    {r.reason_text ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
