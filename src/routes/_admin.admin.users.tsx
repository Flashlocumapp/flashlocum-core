import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchAdminUsers,
  type AdminUserRow,
} from "@/lib/profile-remote";
import { pushToast } from "@/lib/notifications";
import {
  AdminPageHeader,
  Chip,
  Empty,
  RefreshButton,
  fmt,
  fmtRelative,
  statusTone,
} from "@/lib/admin-ui";

export const Route = createFileRoute("/_admin/admin/users")({
  ssr: false,
  component: AdminUsersPage,
});

type RoleFilter = "all" | "request" | "cover" | "both" | "none";

function surfaceOf(u: AdminUserRow): RoleFilter {
  const r = !!u.onboarded_request_at;
  const c = !!u.onboarded_cover_at;
  if (r && c) return "both";
  if (r) return "request";
  if (c) return "cover";
  return "none";
}

function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const rows = await fetchAdminUsers();
      setUsers(rows);
    } catch (e) {
      pushToast({ tone: "warn", title: (e as Error).message || "Refresh failed." });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== "all" && surfaceOf(u) !== roleFilter) return false;
      if (!s) return true;
      return [u.full_name, u.email, u.phone, u.role, u.location]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(s));
    });
  }, [users, q, roleFilter]);

  const filters: { id: RoleFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "request", label: "Requester" },
    { id: "cover", label: "Doctor" },
    { id: "both", label: "Both" },
    { id: "none", label: "Unfinished" },
  ];

  return (
    <div className="p-6 lg:p-8">
      <AdminPageHeader
        title="User Management"
        subtitle={`${filtered.length} of ${users.length} users`}
        right={<RefreshButton onClick={() => void refresh()} busy={busy} />}
      />

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, email, phone, role, location…"
          className="h-10 flex-1 min-w-[260px] rounded-xl bg-secondary px-4 text-[13.5px] outline-none"
        />
        <div className="flex gap-1.5">
          {filters.map((f) => {
            const active = f.id === roleFilter;
            return (
              <button
                key={f.id}
                onClick={() => setRoleFilter(f.id)}
                className={`h-9 rounded-full px-3 text-[12px] font-medium transition ${
                  active ? "bg-primary text-primary-foreground" : "bg-secondary"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        className="mt-5 overflow-hidden rounded-2xl border"
        style={{ background: "var(--color-surface-elevated)" }}
      >
        {filtered.length === 0 ? (
          <div className="p-6">
            <Empty>No users match these filters.</Empty>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-secondary/60 text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">User</th>
                  <th className="px-4 py-2.5 font-medium">Contact</th>
                  <th className="px-4 py-2.5 font-medium">Surfaces</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Location</th>
                  <th className="px-4 py-2.5 font-medium">Joined</th>
                  <th className="px-4 py-2.5 font-medium">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => {
                  const surf = surfaceOf(u);
                  const surfLabel =
                    surf === "both"
                      ? "Request · Cover"
                      : surf === "request"
                        ? "Request"
                        : surf === "cover"
                          ? "Cover"
                          : "—";
                  const tone = statusTone(u.verification_status);
                  const showStatus = !!u.onboarded_cover_at;
                  return (
                    <tr key={u.id} className="border-t hover:bg-secondary/30">
                      <td className="px-4 py-2.5">
                        <div className="font-medium tracking-tight">
                          {u.full_name || "Unnamed"}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        <div className="truncate max-w-[220px]">{u.email || "—"}</div>
                        <div className="text-[11.5px]">{u.phone || "—"}</div>
                      </td>
                      <td className="px-4 py-2.5">{surfLabel}</td>
                      <td className="px-4 py-2.5">
                        {showStatus ? <Chip color={tone.color}>{tone.label}</Chip> : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {u.location || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {fmt(u.created_at)}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {fmtRelative(u.last_seen_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
