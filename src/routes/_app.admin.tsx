import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useIsAdmin } from "@/lib/use-admin";
import { useAuth } from "@/lib/use-auth";
import type { VerificationStatus } from "@/lib/use-profile";

export const Route = createFileRoute("/_app/admin")({
  component: AdminScreen,
});

type AdminProfile = {
  id: string;
  full_name: string | null;
  role: string | null;
  phone: string | null;
  mdcn: string | null;
  bank_name: string | null;
  bank_account: string | null;
  verification_status: VerificationStatus;
  created_at: string;
};

const ACTIONS: { label: string; status: VerificationStatus }[] = [
  { label: "Approve", status: "approved" },
  { label: "Suspend", status: "suspended" },
  { label: "Reject", status: "rejected" },
  { label: "Re-enable", status: "approved" },
];

function AdminScreen() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: adminLoading } = useIsAdmin();
  const [rows, setRows] = useState<AdminProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, role, phone, mdcn, bank_name, bank_account, verification_status, created_at")
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    setRows((data as AdminProfile[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (authLoading || adminLoading) return;
    if (!user) {
      navigate({ to: "/role" });
      return;
    }
    if (!isAdmin) return;
    load();
  }, [authLoading, adminLoading, isAdmin, user, navigate]);

  const setStatus = async (id: string, status: VerificationStatus) => {
    setBusyId(id);
    const { error } = await supabase
      .from("profiles")
      .update({ verification_status: status })
      .eq("id", id);
    setBusyId(null);
    if (error) {
      setError(error.message);
      return;
    }
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, verification_status: status } : r)));
  };

  if (authLoading || adminLoading) {
    return <div className="h-full w-full bg-background" />;
  }

  if (!isAdmin) {
    return (
      <section className="relative h-full w-full overflow-y-auto bg-background">
        <header className="safe-top px-5 pt-4">
          <div className="mx-auto max-w-md">
            <h1 className="text-[26px] font-semibold tracking-tight">Admin</h1>
          </div>
        </header>
        <div className="mx-auto mt-6 max-w-md px-5">
          <div
            className="rounded-2xl p-4 text-[13.5px]"
            style={{ background: "var(--color-surface-elevated)" }}
          >
            You do not have admin access. To bootstrap an admin, run the SQL at
            the bottom of <code className="font-mono">supabase-setup.sql</code> with your email.
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="relative h-full w-full overflow-y-auto bg-background">
      <header className="safe-top px-5 pt-4">
        <div className="mx-auto flex max-w-md items-center justify-between">
          <h1 className="text-[26px] font-semibold tracking-tight">Admin</h1>
          <button
            onClick={load}
            className="rounded-full bg-secondary px-3 py-1.5 text-[12px] font-medium active:bg-accent"
          >
            Refresh
          </button>
        </div>
      </header>

      <div className="mx-auto mt-5 max-w-md px-5 pb-10">
        {error && (
          <p className="mb-3 text-[12.5px] text-destructive">{error}</p>
        )}
        {loading ? (
          <p className="text-[13px] text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No users yet.</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li
                key={r.id}
                className="rounded-2xl p-4"
                style={{ background: "var(--color-surface-elevated)" }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-semibold tracking-tight">
                      {r.full_name || "—"}
                    </div>
                    <div className="truncate text-[12px] text-muted-foreground">
                      {(r.role ?? "—")} · {r.phone ?? "no phone"}
                    </div>
                  </div>
                  <StatusBadge status={r.verification_status} />
                </div>
                <div className="mt-2 text-[12px] text-muted-foreground">
                  MDCN: {r.mdcn || "—"} · Bank: {r.bank_name || "—"} {r.bank_account || ""}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {ACTIONS.map((a) => (
                    <button
                      key={a.label}
                      disabled={busyId === r.id}
                      onClick={() => setStatus(r.id, a.status)}
                      className="rounded-full bg-background px-3 py-1.5 text-[12px] font-medium active:bg-accent disabled:opacity-50"
                      style={{ boxShadow: "inset 0 0 0 1px var(--color-hairline)" }}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: VerificationStatus }) {
  const label =
    status === "approved"
      ? "Approved"
      : status === "suspended"
        ? "Suspended"
        : status === "rejected"
          ? "Rejected"
          : "Pending";
  return (
    <span
      className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium"
      style={{
        background: "color-mix(in oklab, var(--color-foreground) 8%, transparent)",
        color: "var(--color-foreground)",
      }}
    >
      {label}
    </span>
  );
}
