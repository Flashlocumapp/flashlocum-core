import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchAdminOverview,
  fetchAdminUsers,
  listDoctors,
  updateDoctorVerification,
  type AdminOverviewStats,
  type AdminUserRow,
  type ProfileRow,
  type VerificationStatus,
} from "@/lib/profile-remote";
import { pushToast } from "@/lib/notifications";

export const Route = createFileRoute("/_admin/admin")({
  ssr: false,
  component: AdminScreen,
});

type Tab = "overview" | "users" | "pending" | "doctors";

function AdminScreen() {
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState>("checking");
  const [tab, setTab] = useState<Tab>("overview");

  const [stats, setStats] = useState<AdminOverviewStats | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [doctors, setDoctors] = useState<ProfileRow[]>([]);

  const [busy, setBusy] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [s, u, d] = await Promise.all([
        fetchAdminOverview(),
        fetchAdminUsers(),
        listDoctors(),
      ]);
      setStats(s);
      setUsers(u);
      setDoctors(d);
    } catch (e) {
      console.warn(e);
      pushToast({ tone: "warn", title: (e as Error).message || "Refresh failed." });
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const auth = await ensureAuthReady();
      if (!auth.session) {
        setState("unauth");
        return;
      }
      const admin = await isCurrentUserAdmin();
      if (!admin) {
        setState("not-admin");
        return;
      }
      setState("ready");
      await refresh();
    })();
  }, [refresh]);

  useEffect(() => {
    if (state !== "ready") return;
    const ch = supabase
      .channel("admin-dashboard-stream")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "doctor_presence" }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "coverage_requests" }, () => void refresh())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [state, refresh]);

  const act = async (id: string, status: VerificationStatus) => {
    setBusy(id + status);
    try {
      await updateDoctorVerification(id, status);
      pushToast({ tone: "presence", title: `Doctor ${status}.` });
      await refresh();
    } catch (e) {
      pushToast({ tone: "warn", title: (e as Error).message || "Update failed." });
    } finally {
      setBusy(null);
    }
  };

  const handleClaim = async () => {
    setClaiming(true);
    try {
      const ok = await claimFirstAdmin();
      if (ok) {
        pushToast({ tone: "presence", title: "You are now an admin." });
        setState("ready");
        await refresh();
      } else {
        pushToast({ tone: "warn", title: "An admin already exists." });
      }
    } catch (e) {
      pushToast({ tone: "warn", title: (e as Error).message });
    } finally {
      setClaiming(false);
    }
  };

  if (state === "checking") return <div className="min-h-screen bg-background" />;
  if (state === "unauth") {
    return (
      <main className="min-h-screen bg-background safe-top safe-bottom">
        <div className="mx-auto max-w-md px-6 pt-16 text-center">
          <h1 className="text-[22px] font-semibold tracking-tight">Sign in required</h1>
          <p className="mt-2 text-[14px] text-muted-foreground">
            Please sign in to access the admin console.
          </p>
          <button
            onClick={() => navigate({ to: "/role" })}
            className="mt-6 h-12 w-full rounded-2xl bg-primary text-[15px] font-semibold text-primary-foreground"
          >
            Go to sign in
          </button>
        </div>
      </main>
    );
  }
  if (state === "not-admin") {
    return (
      <main className="min-h-screen bg-background safe-top safe-bottom">
        <div className="mx-auto max-w-md px-6 pt-16 text-center">
          <h1 className="text-[22px] font-semibold tracking-tight">Admin access</h1>
          <p className="mt-2 text-[14px] text-muted-foreground">
            Your account does not have admin privileges. If no admin exists yet,
            you can claim the first-admin role below.
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

  return (
    <main className="min-h-screen bg-background safe-top safe-bottom">
      <div className="mx-auto max-w-2xl px-5 pt-6 pb-12">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[24px] font-semibold tracking-tight">Admin console</h1>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              Operational overview of FlashLocum.
            </p>
          </div>
          <button
            onClick={refresh}
            disabled={refreshing}
            className="h-9 rounded-full bg-secondary px-3 text-[12.5px] font-medium disabled:opacity-60"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <TabBar tab={tab} setTab={setTab} pending={stats?.pending_doctors ?? 0} />

        {tab === "overview" && <OverviewSection stats={stats} />}
        {tab === "users" && <UsersSection users={users} />}
        {tab === "pending" && (
          <PendingSection
            doctors={doctors.filter((d) => d.verification_status === "pending")}
            busy={busy}
            onAct={act}
          />
        )}
        {tab === "doctors" && (
          <DoctorsSection doctors={doctors} busy={busy} onAct={act} />
        )}
      </div>
    </main>
  );
}

/* ------------ Tab bar ------------ */

function TabBar({
  tab,
  setTab,
  pending,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  pending: number;
}) {
  const items: { id: Tab; label: string; badge?: number }[] = [
    { id: "overview", label: "Overview" },
    { id: "users", label: "Users" },
    { id: "pending", label: "Pending", badge: pending },
    { id: "doctors", label: "Doctors" },
  ];
  return (
    <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
      {items.map((it) => {
        const active = it.id === tab;
        return (
          <button
            key={it.id}
            onClick={() => setTab(it.id)}
            className={`shrink-0 h-9 rounded-full px-3.5 text-[12.5px] font-semibold transition-colors ${
              active ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"
            }`}
          >
            {it.label}
            {it.badge ? (
              <span
                className="ml-1.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10.5px] font-bold"
                style={{
                  background: active ? "rgba(255,255,255,0.22)" : "var(--color-background)",
                }}
              >
                {it.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* ------------ Overview ------------ */

function OverviewSection({ stats }: { stats: AdminOverviewStats | null }) {
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
          { label: "In Progress", value: stats?.coverage_in_progress, tone: "presence" as const },
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
    <div className="mt-5 space-y-5">
      {groups.map((g) => (
        <div key={g.title}>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {g.title}
          </div>
          <div className="grid grid-cols-2 gap-2.5">
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
        </div>
      ))}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
  live,
}: {
  label: string;
  value: number | undefined;
  tone?: "presence" | "warn" | "danger";
  live?: boolean;
}) {
  const color =
    tone === "presence"
      ? "var(--color-presence)"
      : tone === "danger"
        ? "#b91c1c"
        : tone === "warn"
          ? "#c2410c"
          : "var(--color-foreground)";
  return (
    <div
      className="rounded-2xl p-3.5"
      style={{
        background: "var(--color-surface-elevated)",
        boxShadow: "0 6px 20px -10px rgba(0,0,0,0.10)",
      }}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
        {live && (
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--color-presence)", boxShadow: "0 0 0 3px color-mix(in oklab, var(--color-presence) 22%, transparent)" }}
          />
        )}
      </div>
      <div className="mt-1.5 text-[24px] font-semibold tracking-tight" style={{ color }}>
        {value ?? "—"}
      </div>
    </div>
  );
}

/* ------------ Users registry ------------ */

function UsersSection({ users }: { users: AdminUserRow[] }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return users;
    return users.filter((u) =>
      [u.full_name, u.email, u.phone, u.role, u.location]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(s)),
    );
  }, [users, q]);

  return (
    <div className="mt-5">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search name, email, phone, role…"
        className="h-11 w-full rounded-2xl bg-secondary px-4 text-[14px] outline-none"
      />
      <div className="mt-2 text-[12px] text-muted-foreground">
        {filtered.length} of {users.length} users
      </div>
      <div className="mt-3 space-y-2.5">
        {filtered.length === 0 ? (
          <Empty>No users match this search.</Empty>
        ) : (
          filtered.map((u) => <UserCard key={u.id} user={u} />)
        )}
      </div>
    </div>
  );
}

function UserCard({ user }: { user: AdminUserRow }) {
  const surfaces: string[] = [];
  if (user.onboarded_request_at) surfaces.push("Request");
  if (user.onboarded_cover_at) surfaces.push("Cover");
  const tone = statusTone(user.verification_status);
  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: "var(--color-surface-elevated)",
        boxShadow: "0 6px 20px -10px rgba(0,0,0,0.10)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold tracking-tight">
            {user.full_name || "Unnamed user"}
          </div>
          <div className="truncate text-[12.5px] text-muted-foreground">
            {user.email || "no email"} · {user.phone || "no phone"}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <Chip>{surfaces.length ? surfaces.join(" · ") : user.role || "no role"}</Chip>
            <Chip>{user.location || "no location"}</Chip>
            {user.onboarded_cover_at && (
              <Chip color={tone.color}>{tone.label}</Chip>
            )}
          </div>
          <div className="mt-2 text-[11.5px] text-muted-foreground">
            Joined {fmt(user.created_at)} · Last seen {fmtRelative(user.last_seen_at)}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------ Pending Verification queue ------------ */

function PendingSection({
  doctors,
  busy,
  onAct,
}: {
  doctors: ProfileRow[];
  busy: string | null;
  onAct: (id: string, s: VerificationStatus) => void;
}) {
  if (doctors.length === 0) {
    return (
      <div className="mt-5">
        <Empty>No doctors are waiting for verification.</Empty>
      </div>
    );
  }
  return (
    <div className="mt-5 space-y-3">
      {doctors.map((d) => (
        <PendingCard key={d.id} doctor={d} busy={busy} onAct={onAct} />
      ))}
    </div>
  );
}

function PendingCard({
  doctor,
  busy,
  onAct,
}: {
  doctor: ProfileRow;
  busy: string | null;
  onAct: (id: string, s: VerificationStatus) => void;
}) {
  const isBusy = (s: string) => busy === doctor.id + s;
  const anyBusy = busy?.startsWith(doctor.id) ?? false;
  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: "var(--color-surface-elevated)",
        boxShadow: "0 6px 20px -10px rgba(0,0,0,0.12)",
      }}
    >
      <div className="flex items-start gap-3">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-secondary">
          {doctor.selfie_url ? (
            <img src={doctor.selfie_url} alt={doctor.full_name ?? "Doctor"} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[15px] font-semibold text-muted-foreground">
              {initials(doctor.full_name)}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold tracking-tight">
            {doctor.full_name || "Unnamed doctor"}
          </div>
          <div className="text-[12.5px] text-muted-foreground">
            {doctor.phone || "no phone"}
          </div>
          <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11.5px] text-muted-foreground">
            <div>MDCN: <span className="text-foreground">{doctor.mdcn || "—"}</span></div>
            <div>Location: <span className="text-foreground">{doctor.location || "—"}</span></div>
            <div className="col-span-2">
              Submitted:{" "}
              <span className="text-foreground">
                {fmt(doctor.onboarded_cover_at)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {doctor.selfie_url && (
          <a
            href={doctor.selfie_url}
            target="_blank"
            rel="noreferrer"
            className="h-8 rounded-full bg-secondary px-3 text-[11.5px] font-medium leading-8"
          >
            View selfie
          </a>
        )}
        {doctor.verification_receipt_url ? (
          <a
            href={doctor.verification_receipt_url}
            target="_blank"
            rel="noreferrer"
            className="h-8 rounded-full bg-secondary px-3 text-[11.5px] font-medium leading-8"
          >
            View receipt
          </a>
        ) : (
          <span className="h-8 rounded-full bg-secondary px-3 text-[11.5px] font-medium leading-8 text-muted-foreground">
            No receipt uploaded
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => onAct(doctor.id, "approved")}
          disabled={anyBusy}
          className="h-9 rounded-full bg-primary px-3.5 text-[12.5px] font-semibold text-primary-foreground disabled:opacity-60"
        >
          {isBusy("approved") ? "Approving…" : "Approve"}
        </button>
        <button
          onClick={() => onAct(doctor.id, "rejected")}
          disabled={anyBusy}
          className="h-9 rounded-full bg-secondary px-3.5 text-[12.5px] font-semibold disabled:opacity-60"
          style={{ color: "#b91c1c" }}
        >
          {isBusy("rejected") ? "Rejecting…" : "Reject"}
        </button>
        <button
          onClick={() => onAct(doctor.id, "suspended")}
          disabled={anyBusy}
          className="h-9 rounded-full bg-secondary px-3.5 text-[12.5px] font-semibold disabled:opacity-60"
        >
          {isBusy("suspended") ? "Suspending…" : "Suspend"}
        </button>
      </div>
    </div>
  );
}

/* ------------ Doctors list (existing functionality) ------------ */

function DoctorsSection({
  doctors,
  busy,
  onAct,
}: {
  doctors: ProfileRow[];
  busy: string | null;
  onAct: (id: string, s: VerificationStatus) => void;
}) {
  if (doctors.length === 0) {
    return (
      <div className="mt-5">
        <Empty>No doctor accounts found yet.</Empty>
      </div>
    );
  }
  return (
    <div className="mt-5 space-y-3">
      {doctors.map((d) => (
        <DoctorCard key={d.id} doctor={d} busy={busy} onAct={onAct} />
      ))}
    </div>
  );
}

function DoctorCard({
  doctor,
  busy,
  onAct,
}: {
  doctor: ProfileRow;
  busy: string | null;
  onAct: (id: string, s: VerificationStatus) => void;
}) {
  const tone = statusTone(doctor.verification_status);
  const isBusy = (s: string) => busy === doctor.id + s;
  const anyBusy = busy?.startsWith(doctor.id) ?? false;
  const status = doctor.verification_status;
  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: "var(--color-surface-elevated)",
        boxShadow: "0 6px 20px -10px rgba(0,0,0,0.10)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold tracking-tight">
            {doctor.full_name || "Unnamed doctor"}
          </div>
          <div className="text-[12.5px] text-muted-foreground">
            {doctor.mdcn || "—"} · {doctor.phone || "no phone"}
          </div>
          <div className="mt-0.5 text-[11.5px] text-muted-foreground">
            Onboarded: {fmt(doctor.onboarded_cover_at)}
          </div>
        </div>
        <span
          className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider"
          style={{
            color: tone.color,
            background: "color-mix(in oklab, currentColor 12%, transparent)",
          }}
        >
          {tone.label}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {status !== "approved" && (
          <button
            onClick={() => onAct(doctor.id, "approved")}
            disabled={anyBusy}
            className="h-9 rounded-full bg-primary px-3.5 text-[12.5px] font-semibold text-primary-foreground disabled:opacity-60"
          >
            {isBusy("approved")
              ? "Approving…"
              : status === "suspended" || status === "rejected"
                ? "Reactivate"
                : "Approve"}
          </button>
        )}
        {status !== "suspended" && (
          <button
            onClick={() => onAct(doctor.id, "suspended")}
            disabled={anyBusy}
            className="h-9 rounded-full bg-secondary px-3.5 text-[12.5px] font-semibold disabled:opacity-60"
          >
            {isBusy("suspended") ? "Suspending…" : "Suspend"}
          </button>
        )}
        {status !== "rejected" && (
          <button
            onClick={() => onAct(doctor.id, "rejected")}
            disabled={anyBusy}
            className="h-9 rounded-full bg-secondary px-3.5 text-[12.5px] font-semibold disabled:opacity-60"
            style={{ color: "#b91c1c" }}
          >
            {isBusy("rejected") ? "Rejecting…" : "Reject"}
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------ Bits ------------ */

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-secondary p-5 text-center text-[13.5px] text-muted-foreground">
      {children}
    </div>
  );
}

function Chip({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      className="inline-flex h-5 items-center rounded-full px-2 text-[10.5px] font-semibold uppercase tracking-wider"
      style={{
        color: color ?? "var(--color-muted-foreground)",
        background: "color-mix(in oklab, currentColor 12%, transparent)",
      }}
    >
      {children}
    </span>
  );
}

function statusTone(s: VerificationStatus) {
  switch (s) {
    case "approved":
      return { label: "Approved", color: "var(--color-presence)" };
    case "suspended":
      return { label: "Suspended", color: "#c2410c" };
    case "rejected":
      return { label: "Rejected", color: "#b91c1c" };
    default:
      return { label: "Pending", color: "var(--color-muted-foreground)" };
  }
}

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

function fmt(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString();
  } catch {
    return "—";
  }
}

function fmtRelative(d: string | null | undefined): string {
  if (!d) return "never";
  const ms = Date.now() - new Date(d).getTime();
  if (Number.isNaN(ms) || ms < 0) return "—";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(d).toLocaleDateString();
}
