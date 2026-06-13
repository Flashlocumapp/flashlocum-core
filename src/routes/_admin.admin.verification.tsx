import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listDoctors,
  updateDoctorVerification,
  type ProfileRow,
} from "@/lib/profile-remote";
import { pushToast } from "@/lib/notifications";
import {
  AdminPageHeader,
  Chip,
  Empty,
  RefreshButton,
  fmt,
  initials,
  statusTone,
  type VerificationStatus,
} from "@/lib/admin-ui";

export const Route = createFileRoute("/_admin/admin/verification")({
  ssr: false,
  component: AdminVerificationPage,
});

type Filter = "pending" | "approved" | "suspended" | "rejected" | "all";

function AdminVerificationPage() {
  const [doctors, setDoctors] = useState<ProfileRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("pending");

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const rows = await listDoctors();
      setDoctors(rows);
    } catch (e) {
      pushToast({ tone: "warn", title: (e as Error).message || "Refresh failed." });
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  const counts = useMemo(() => {
    const c = { pending: 0, approved: 0, suspended: 0, rejected: 0, all: doctors.length };
    for (const d of doctors) c[d.verification_status]++;
    return c;
  }, [doctors]);

  const visible = useMemo(() => {
    if (filter === "all") return doctors;
    return doctors.filter((d) => d.verification_status === filter);
  }, [doctors, filter]);

  const filters: { id: Filter; label: string }[] = [
    { id: "pending", label: `Pending (${counts.pending})` },
    { id: "approved", label: `Approved (${counts.approved})` },
    { id: "suspended", label: `Suspended (${counts.suspended})` },
    { id: "rejected", label: `Rejected (${counts.rejected})` },
    { id: "all", label: `All (${counts.all})` },
  ];

  return (
    <div className="p-6 lg:p-8">
      <AdminPageHeader
        title="Doctor Verification"
        subtitle="Review onboarding submissions and manage approval state."
        right={<RefreshButton onClick={() => void refresh()} busy={refreshing} />}
      />

      <div className="mt-5 flex flex-wrap gap-1.5">
        {filters.map((f) => {
          const active = f.id === filter;
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`h-9 rounded-full px-3.5 text-[12px] font-medium transition ${
                active ? "bg-primary text-primary-foreground" : "bg-secondary"
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        {visible.length === 0 ? (
          <Empty>No doctors in this bucket.</Empty>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {visible.map((d) => (
              <VerificationCard
                key={d.id}
                doctor={d}
                busy={busy}
                onAct={act}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function VerificationCard({
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
  const status = doctor.verification_status;
  const tone = statusTone(status);
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
            <img
              src={doctor.selfie_url}
              alt={doctor.full_name ?? "Doctor"}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[15px] font-semibold text-muted-foreground">
              {initials(doctor.full_name)}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 truncate text-[15px] font-semibold tracking-tight">
              {doctor.full_name || "Unnamed doctor"}
            </div>
            <Chip color={tone.color}>{tone.label}</Chip>
          </div>
          <div className="text-[12.5px] text-muted-foreground">
            {doctor.phone || "no phone"}
          </div>
          <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11.5px] text-muted-foreground">
            <div>
              MDCN: <span className="text-foreground">{doctor.mdcn || "—"}</span>
            </div>
            <div>
              Location:{" "}
              <span className="text-foreground">{doctor.location || "—"}</span>
            </div>
            <div className="col-span-2">
              Submitted:{" "}
              <span className="text-foreground">{fmt(doctor.onboarded_cover_at)}</span>
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
