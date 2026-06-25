import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listDoctors,
  updateDoctorVerification,
  type ProfileRow,
} from "@/lib/profile-remote";
import { pushToast } from "@/lib/notifications";
import { supabase } from "@/integrations/supabase/client";
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
import { UserDetailDrawer } from "@/components/admin/UserDetailDrawer";

export const Route = createFileRoute("/_admin/admin/verification")({
  ssr: false,
  component: AdminVerificationPage,
});

type Filter =
  | "pending"
  | "action_required"
  | "approved"
  | "suspended"
  | "rejected"
  | "all";

// Profile rows extended with the new action-required metadata. types.ts
// will catch up after the next regeneration; until then we widen locally.
type DoctorRow = ProfileRow & {
  verification_action_reason?: string | null;
  verification_action_target?: string | null;
  verification_action_note?: string | null;
  verification_action_at?: string | null;
};

const ACTION_REASONS = [
  "Document unclear",
  "Missing document",
  "Wrong document uploaded",
  "Expired document",
  "Information mismatch",
  "Other",
] as const;

const ACTION_TARGETS = [
  { id: "", label: "Not specified" },
  { id: "selfie", label: "Selfie / profile photo" },
  { id: "license", label: "Medical license" },
  { id: "nysc", label: "NYSC certificate" },
  { id: "bank", label: "Bank account details" },
  { id: "mdcn", label: "MDCN number" },
];

function AdminVerificationPage() {
  const [doctors, setDoctors] = useState<DoctorRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("pending");
  const [actionFor, setActionFor] = useState<DoctorRow | null>(null);
  const [openUserId, setOpenUserId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const rows = await listDoctors();
      setDoctors(rows as DoctorRow[]);
    } catch (e) {
      pushToast({ tone: "warn", title: (e as Error).message || "Refresh failed." });
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = async (
    id: string,
    status: VerificationStatus,
    extras?: { reason?: string; target?: string; note?: string },
  ) => {
    setBusy(id + status);
    try {
      await updateDoctorVerification(id, status, extras);
      pushToast({
        tone: "presence",
        title:
          status === "action_required"
            ? "Doctor marked Action Required."
            : `Doctor ${status}.`,
      });
      await refresh();
    } catch (e) {
      pushToast({ tone: "warn", title: (e as Error).message || "Update failed." });
    } finally {
      setBusy(null);
    }
  };

  const counts = useMemo(() => {
    const c: Record<VerificationStatus, number> & { all: number } = {
      pending: 0,
      approved: 0,
      suspended: 0,
      rejected: 0,
      action_required: 0,
      all: doctors.length,
    };
    for (const d of doctors) {
      const s = d.verification_status as VerificationStatus;
      if (s in c) c[s]++;
    }
    return c;
  }, [doctors]);

  const visible = useMemo(() => {
    if (filter === "all") return doctors;
    return doctors.filter((d) => d.verification_status === filter);
  }, [doctors, filter]);

  const filters: { id: Filter; label: string }[] = [
    { id: "pending", label: `Pending (${counts.pending})` },
    { id: "action_required", label: `Action required (${counts.action_required})` },
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
                onAct={(id, status) => void act(id, status)}
                onActionRequired={() => setActionFor(d)}
                onOpenUser={() => setOpenUserId(d.id)}
              />
            ))}
          </div>
        )}
      </div>

      {actionFor && (
        <ActionRequiredSheet
          doctor={actionFor}
          submitting={busy === actionFor.id + "action_required"}
          onClose={() => setActionFor(null)}
          onSubmit={async (reason, target, note) => {
            await act(actionFor.id, "action_required", { reason, target, note });
            setActionFor(null);
          }}
        />
      )}

      <UserDetailDrawer
        userId={openUserId}
        onClose={() => setOpenUserId(null)}
      />
    </div>
  );
}

function VerificationCard({
  doctor,
  busy,
  onAct,
  onActionRequired,
  onOpenUser,
}: {
  doctor: DoctorRow;
  busy: string | null;
  onAct: (id: string, s: VerificationStatus) => void;
  onActionRequired: () => void;
  onOpenUser: () => void;
}) {
  const isBusy = (s: string) => busy === doctor.id + s;
  const anyBusy = busy?.startsWith(doctor.id) ?? false;
  const status = doctor.verification_status as VerificationStatus;
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
        <DoctorAvatar path={doctor.selfie_url} name={doctor.full_name} />
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
            <div className="col-span-2">
              Bank:{" "}
              <span className="text-foreground">
                {doctor.bank_name || "—"}
                {doctor.bank_account ? ` · ${doctor.bank_account}` : ""}
              </span>
            </div>
            {doctor.bank_account_name && (
              <div className="col-span-2">
                Account name:{" "}
                <span className="text-foreground">{doctor.bank_account_name}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {status === "action_required" && doctor.verification_action_reason && (
        <div
          className="mt-3 rounded-xl px-3 py-2 text-[11.5px] leading-snug"
          style={{
            background: "color-mix(in oklab, #b45309 12%, transparent)",
            color: "#92400e",
          }}
        >
          <div className="font-semibold">
            {doctor.verification_action_reason}
            {doctor.verification_action_target
              ? ` · ${targetLabel(doctor.verification_action_target)}`
              : ""}
          </div>
          {doctor.verification_action_note && (
            <div className="mt-0.5 opacity-90">{doctor.verification_action_note}</div>
          )}
        </div>
      )}

      <div className="mt-3 space-y-1.5">
        <DocRow label="Selfie / profile photo" path={doctor.selfie_url} />
        <DocRow label="Medical license" path={doctor.license_name} />
        <DocRow label="NYSC certificate" path={doctor.nysc_name} />
        {doctor.verification_receipt_url && (
          <ExternalDocRow
            label="Payment receipt"
            url={doctor.verification_receipt_url}
          />
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
        <button
          onClick={onActionRequired}
          disabled={anyBusy}
          className="h-9 rounded-full px-3.5 text-[12.5px] font-semibold disabled:opacity-60"
          style={{ background: "color-mix(in oklab, #b45309 15%, transparent)", color: "#92400e" }}
        >
          {isBusy("action_required") ? "Saving…" : "Action required"}
        </button>
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
        <button
          onClick={onOpenUser}
          className="h-9 rounded-full bg-secondary px-3.5 text-[12.5px] font-semibold"
        >
          History & details
        </button>
      </div>
    </div>
  );
}

function targetLabel(id: string): string {
  return ACTION_TARGETS.find((t) => t.id === id)?.label ?? id;
}

const DOCTORS_BUCKET = "doctors";
const SIGNED_URL_TTL = 60 * 30; // 30 min

function useSignedDoctorUrl(path: string | null | undefined): {
  url: string | null;
  loading: boolean;
  error: string | null;
} {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!path) {
      setUrl(null);
      setError(null);
      return;
    }
    if (/^https?:\/\//i.test(path)) {
      setUrl(path);
      return;
    }
    setLoading(true);
    void supabase.storage
      .from(DOCTORS_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data?.signedUrl) {
          setError(error?.message ?? "Unable to load file");
          setUrl(null);
        } else {
          setError(null);
          setUrl(data.signedUrl);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return { url, loading, error };
}

function DoctorAvatar({
  path,
  name,
}: {
  path: string | null | undefined;
  name: string | null | undefined;
}) {
  const { url } = useSignedDoctorUrl(path);
  return (
    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-secondary">
      {url ? (
        <img src={url} alt={name ?? "Doctor"} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[15px] font-semibold text-muted-foreground">
          {initials(name)}
        </div>
      )}
    </div>
  );
}

function isImagePath(path: string | null | undefined): boolean {
  if (!path) return false;
  return /\.(png|jpe?g|webp|gif|heic|heif|avif)(\?.*)?$/i.test(path);
}

function DocRow({
  label,
  path,
}: {
  label: string;
  path: string | null | undefined;
}) {
  const { url, loading, error } = useSignedDoctorUrl(path);
  const disabled = !url;
  const showThumb = isImagePath(path) && url;
  return (
    <div className="flex items-center gap-2 rounded-xl bg-secondary/60 px-3 py-2 text-[12px]">
      {showThumb ? (
        <a
          href={url ?? "#"}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 overflow-hidden rounded-md"
          style={{ width: 44, height: 44, background: "var(--color-secondary)" }}
        >
          <img
            src={url ?? ""}
            alt={label}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </a>
      ) : (
        <div
          className="shrink-0 rounded-md text-center text-[10px] font-semibold leading-[44px] text-muted-foreground"
          style={{ width: 44, height: 44, background: "var(--color-secondary)" }}
          aria-hidden
        >
          DOC
        </div>
      )}
      <div className="min-w-0 flex-1 truncate">
        <div className="font-medium">{label}</div>
        {!path && <div className="text-[11px] text-muted-foreground">not uploaded</div>}
        {error && <div className="text-[11px] text-destructive">{error}</div>}
      </div>
      {path && (
        <div className="flex shrink-0 items-center gap-1.5">
          <a
            href={url ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="h-7 rounded-full bg-background px-2.5 text-[11.5px] font-medium leading-7"
            style={{ pointerEvents: disabled ? "none" : "auto", opacity: disabled ? 0.6 : 1 }}
          >
            {loading ? "Loading…" : "View"}
          </a>
          <a
            href={url ?? "#"}
            download
            target="_blank"
            rel="noreferrer"
            className="h-7 rounded-full bg-background px-2.5 text-[11.5px] font-medium leading-7"
            style={{ pointerEvents: disabled ? "none" : "auto", opacity: disabled ? 0.6 : 1 }}
          >
            Download
          </a>
        </div>
      )}
    </div>
  );
}

function ExternalDocRow({ label, url }: { label: string; url: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-secondary/60 px-3 py-2 text-[12px]">
      <div className="min-w-0 truncate font-medium">{label}</div>
      <div className="flex shrink-0 items-center gap-1.5">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="h-7 rounded-full bg-background px-2.5 text-[11.5px] font-medium leading-7"
        >
          View
        </a>
        <a
          href={url}
          download
          target="_blank"
          rel="noreferrer"
          className="h-7 rounded-full bg-background px-2.5 text-[11.5px] font-medium leading-7"
        >
          Download
        </a>
      </div>
    </div>
  );
}

function ActionRequiredSheet({
  doctor,
  submitting,
  onClose,
  onSubmit,
}: {
  doctor: DoctorRow;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (reason: string, target: string, note: string) => Promise<void>;
}) {
  const [reason, setReason] = useState<string>(
    doctor.verification_action_reason || ACTION_REASONS[0],
  );
  const [target, setTarget] = useState<string>(
    doctor.verification_action_target || "",
  );
  const [note, setNote] = useState<string>(doctor.verification_action_note || "");

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[15px] font-semibold tracking-tight">
          Mark as Action Required
        </div>
        <div className="mt-0.5 text-[12px] text-muted-foreground">
          {doctor.full_name || "This doctor"} will be unable to accept shifts until the
          issue is resolved. A push notification will be sent.
        </div>

        <label className="mt-4 block text-[11.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Reason
        </label>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-1 h-10 w-full rounded-xl border border-border bg-background px-3 text-[13px]"
        >
          {ACTION_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>

        <label className="mt-4 block text-[11.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Which document / field
        </label>
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="mt-1 h-10 w-full rounded-xl border border-border bg-background px-3 text-[13px]"
        >
          {ACTION_TARGETS.map((t) => (
            <option key={t.id || "none"} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>

        <label className="mt-4 block text-[11.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Note (optional)
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Add a short note the doctor will see…"
          className="mt-1 w-full resize-none rounded-xl border border-border bg-background p-3 text-[13px]"
        />

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="h-9 rounded-full bg-secondary px-3.5 text-[12.5px] font-semibold"
          >
            Cancel
          </button>
          <button
            disabled={submitting || !reason.trim()}
            onClick={() => void onSubmit(reason, target, note)}
            className="h-9 rounded-full px-3.5 text-[12.5px] font-semibold text-white disabled:opacity-60"
            style={{ background: "#b45309" }}
          >
            {submitting ? "Saving…" : "Send to doctor"}
          </button>
        </div>
      </div>
    </div>
  );
}
