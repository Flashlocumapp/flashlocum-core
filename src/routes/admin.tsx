import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  claimFirstAdmin,
  isCurrentUserAdmin,
  listDoctors,
  updateDoctorVerification,
  type ProfileRow,
  type VerificationStatus,
} from "@/lib/profile-remote";
import { pushToast } from "@/lib/notifications";

export const Route = createFileRoute("/admin")({
  component: AdminScreen,
});

type LoadState = "checking" | "unauth" | "not-admin" | "ready";

function AdminScreen() {
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState>("checking");
  const [doctors, setDoctors] = useState<ProfileRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);

  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const list = await listDoctors();
      setDoctors(list);
    } catch (e) {
      console.warn(e);
      pushToast({ tone: "warn", title: (e as Error).message || "Refresh failed." });
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
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
    const channel = supabase
      .channel("admin-doctor-verification")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        () => {
          void refresh();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh, state]);

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

  if (state === "checking") {
    return <div className="min-h-screen bg-background" />;
  }
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
      <div className="mx-auto max-w-md px-5 pt-6 pb-12">
        <div className="flex items-center justify-between">
          <h1 className="text-[24px] font-semibold tracking-tight">Doctor verification</h1>
          <button
            onClick={refresh}
            disabled={refreshing}
            className="h-9 rounded-full bg-secondary px-3 text-[12.5px] font-medium disabled:opacity-60"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Approve, reject, suspend, or reactivate registered doctors.
        </p>

        <div className="mt-5 space-y-3">
          {doctors.length === 0 ? (
            <div className="rounded-2xl bg-secondary p-5 text-center text-[13.5px] text-muted-foreground">
              No doctor accounts found yet.
            </div>
          ) : (
            doctors.map((d) => (
              <DoctorCard
                key={d.id}
                doctor={d}
                busy={busy}
                onApprove={() => act(d.id, "approved")}
                onReject={() => act(d.id, "rejected")}
                onSuspend={() => act(d.id, "suspended")}
              />
            ))
          )}
        </div>
      </div>
    </main>
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

function DoctorCard({
  doctor,
  busy,
  onApprove,
  onReject,
  onSuspend,
}: {
  doctor: ProfileRow;
  busy: string | null;
  onApprove: () => void;
  onReject: () => void;
  onSuspend: () => void;
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
        boxShadow: "0 6px 20px -10px rgba(0,0,0,0.14)",
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
            Onboarded:{" "}
            {doctor.onboarded_cover_at
              ? new Date(doctor.onboarded_cover_at).toLocaleString()
              : "—"}
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
            onClick={onApprove}
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
            onClick={onSuspend}
            disabled={anyBusy}
            className="h-9 rounded-full bg-secondary px-3.5 text-[12.5px] font-semibold disabled:opacity-60"
          >
            {isBusy("suspended") ? "Suspending…" : "Suspend"}
          </button>
        )}
        {status !== "rejected" && (
          <button
            onClick={onReject}
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
