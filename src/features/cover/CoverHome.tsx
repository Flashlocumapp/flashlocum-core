import { useEffect, useState } from "react";
import { GoogleMapBackground } from "@/components/GoogleMapBackground";
import { RatingPill } from "@/components/RatingPill";
import { ReliabilityPill } from "@/components/ReliabilityPill";
import { TrustInfoPopover } from "@/components/TrustInfoPopover";

import { fmtOpMeta } from "@/lib/format";

import {
  doctorEntityId,
  hospitalEntityId,
  setOnline,
  useDispatch,
  type Coverage,
} from "@/features/cover/dispatch";
import { getSessionId } from "@/lib/network";
import { useRating } from "@/lib/ratings";
import { useReliability } from "@/lib/reliability";
import { useVerificationStatus } from "@/lib/verification";
import { pushToast } from "@/lib/notifications";
import { useMyProfile } from "@/lib/profile-remote";
import { uploadDoctorSelfie, uploadDoctorDocument } from "@/lib/doctor-uploads";
import {
  refreshDoctorLocation,
  startDoctorLocationRefresh,
  stopDoctorLocationRefresh,
} from "@/lib/doctor-gps";


/**
 * CoverHome — doctor home tab.
 * Fullscreen map · top Online/Offline pill · lower floating tiles.
 */
export function CoverHome({ active = true }: { active?: boolean }) {
  const { online, upcoming } = useDispatch();
  const verification = useVerificationStatus();
  const approved = verification === "approved";

  // Pick the focus coverage: any active one, else the next upcoming.
  const focus =
    upcoming.find((c) => c.active) ??
    upcoming[0] ??
    null;
  const isActive = !!focus?.active;

  // Shared doctor rating — same source used in every requester view.
  const myRating = useRating(doctorEntityId(getSessionId()));
  const myReliability = useReliability(doctorEntityId(getSessionId()));

  // Hard-revoke online state if verification is lost (suspension, rejection).
  useEffect(() => {
    if (active && !approved && online) setOnline(false);
  }, [active, approved, online]);

  const handleToggleOnline = () => {
    if (!approved) {
      pushToast({
        tone: "warn",
        title:
          verification === "suspended"
            ? "Your account is suspended."
            : verification === "rejected"
              ? "Your account was not approved."
              : "Verification pending — admin approval required.",
        body: "You'll be able to go online once an admin approves your account.",
      });
      return;
    }
    setOnline(!online);
  };

  return (
    <section className="relative h-full w-full overflow-hidden">
      <GoogleMapBackground
        active={active}
        showSelf={online && approved}
        selfMarkerKind="doctor"
        markers={[]}
      />

      {/* top primary Online/Offline pill */}
      <header className="absolute inset-x-0 top-0 z-30">
        <div className="mx-auto flex max-w-md flex-col items-center gap-2 px-4 pt-3">
          <OnlinePill
            online={online && approved}
            disabled={!approved}
            onToggle={handleToggleOnline}
          />
          {verification && !approved && <VerificationBanner status={verification} />}
          {verification === "action_required" && <ActionRequiredCard />}
        </div>
      </header>

      {/* Adaptive bottom sheet — content-fit; Score & Acceptance always visible.
          No mount-time entry animation: this surface must feel already-present
          on every tab return so navigation reads as instant, not staged. */}
      <section className="absolute inset-x-0 bottom-0 z-20">
        <div className="mx-auto flex max-w-md flex-col gap-2.5 px-4 pb-4">
          <CoverageTile coverage={approved ? focus : null} active={isActive && approved} />
          <div className="grid grid-cols-2 gap-2.5">
            <ScoreTile score={myRating.score} />
            <ReliabilityTile display={myReliability.display} />
          </div>
        </div>
      </section>
    </section>
  );
}

function VerificationBanner({ status }: { status: string }) {
  const label =
    status === "suspended"
      ? "Account suspended"
      : status === "rejected"
        ? "Verification rejected"
        : status === "action_required"
          ? "Action required"
          : "Verification pending";
  const body =
    status === "suspended"
      ? "Contact support to restore access."
      : status === "rejected"
        ? "Contact support for next steps."
        : status === "action_required"
          ? "Additional information is required to complete your verification."
          : "An admin must approve your account before you can go online.";
  return (
    <div
      className="w-full max-w-xs rounded-2xl px-3.5 py-2.5 text-center"
      style={{
        background: "var(--color-surface-elevated)",
        boxShadow: "0 6px 20px -10px rgba(0,0,0,0.18)",
      }}
    >
      <div className="text-[12px] font-semibold tracking-tight">{label}</div>
      <div className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{body}</div>
    </div>
  );
}

type ActionTarget = "selfie" | "license" | "nysc" | "" | "bank" | "mdcn";

function targetLabel(t: string | null | undefined): string {
  switch (t) {
    case "selfie":
      return "Selfie / profile photo";
    case "license":
      return "Medical license";
    case "nysc":
      return "NYSC certificate";
    case "bank":
      return "Bank account details";
    case "mdcn":
      return "MDCN number";
    default:
      return "Verification details";
  }
}

function ActionRequiredCard() {
  const { profile, refresh } = useMyProfile();
  const [busy, setBusy] = useState<string | null>(null);
  const target = (profile as unknown as { verification_action_target?: string | null } | null)
    ?.verification_action_target as ActionTarget | null | undefined;
  const reason = (profile as unknown as { verification_action_reason?: string | null } | null)
    ?.verification_action_reason;
  const note = (profile as unknown as { verification_action_note?: string | null } | null)
    ?.verification_action_note;

  const allowSelfie = !target || target === "selfie";
  const allowLicense = !target || target === "license";
  const allowNysc = !target || target === "nysc";

  const handleFile = async (kind: "license" | "nysc", file: File | null) => {
    if (!file) return;
    setBusy(kind);
    try {
      await uploadDoctorDocument(kind, file);
      pushToast({ tone: "presence", title: "Re-uploaded. Verification is back in review." });
      await refresh();
    } catch (e) {
      pushToast({ tone: "warn", title: (e as Error).message || "Upload failed." });
    } finally {
      setBusy(null);
    }
  };

  const handleSelfie = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.capture = "user";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setBusy("selfie");
      try {
        const reader = new FileReader();
        const dataUrl: string = await new Promise((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        await uploadDoctorSelfie(dataUrl);
        pushToast({ tone: "presence", title: "Selfie re-uploaded. Back in review." });
        await refresh();
      } catch (e) {
        pushToast({ tone: "warn", title: (e as Error).message || "Upload failed." });
      } finally {
        setBusy(null);
      }
    };
    input.click();
  };

  return (
    <div
      className="w-full max-w-xs rounded-2xl px-3.5 py-3 text-left"
      style={{
        background: "var(--color-surface-elevated)",
        boxShadow: "0 6px 20px -10px rgba(0,0,0,0.18)",
      }}
    >
      <div
        className="text-[11px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: "#b45309" }}
      >
        {targetLabel(target)}
      </div>
      {reason && (
        <div className="mt-1 text-[12.5px] font-semibold leading-snug">{reason}</div>
      )}
      {note && (
        <div className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{note}</div>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {allowSelfie && (
          <button
            onClick={() => void handleSelfie()}
            disabled={!!busy}
            className="h-8 rounded-full bg-secondary px-3 text-[11.5px] font-semibold disabled:opacity-60"
          >
            {busy === "selfie" ? "Uploading…" : "Re-upload selfie"}
          </button>
        )}
        {allowLicense && (
          <label
            className={`h-8 inline-flex items-center rounded-full bg-secondary px-3 text-[11.5px] font-semibold ${busy ? "opacity-60" : "cursor-pointer"}`}
          >
            {busy === "license" ? "Uploading…" : "Re-upload license"}
            <input
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              disabled={!!busy}
              onChange={(e) => void handleFile("license", e.target.files?.[0] ?? null)}
            />
          </label>
        )}
        {allowNysc && (
          <label
            className={`h-8 inline-flex items-center rounded-full bg-secondary px-3 text-[11.5px] font-semibold ${busy ? "opacity-60" : "cursor-pointer"}`}
          >
            {busy === "nysc" ? "Uploading…" : "Re-upload NYSC"}
            <input
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              disabled={!!busy}
              onChange={(e) => void handleFile("nysc", e.target.files?.[0] ?? null)}
            />
          </label>
        )}
      </div>
    </div>
  );
}


/* ------------------ Online toggle ------------------ */

function OnlinePill({
  online,
  onToggle,
  disabled,
}: {
  online: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-2.5 rounded-full px-5 py-2.5 shadow-[0_4px_18px_-4px_rgba(0,0,0,0.18)] active:scale-[0.98] transition-transform"
      style={{
        background: online
          ? "var(--color-presence)"
          : "var(--color-surface-elevated)",
        color: online ? "white" : "var(--color-foreground)",
        border: online
          ? "none"
          : "1px solid color-mix(in oklab, var(--color-foreground) 10%, transparent)",
        opacity: disabled ? 0.55 : 1,
      }}
      aria-disabled={disabled || undefined}
    >
      <span
        className="relative h-2.5 w-2.5 rounded-full"
        style={{
          background: online
            ? "white"
            : "color-mix(in oklab, var(--color-foreground) 35%, transparent)",
        }}
      >
        {online && (
          <span
            className="absolute inset-0 rounded-full"
            style={{
              background: "white",
              opacity: 0.6,
              animation: "presence-pulse 1.8s ease-out infinite",
            }}
          />
        )}
      </span>
      <span className="text-[13.5px] font-semibold tracking-tight">
        {disabled ? "Locked" : online ? "Online" : "Offline"}
      </span>
    </button>
  );
}

/* ------------------ Coverage tile ------------------ */

function CoverageTile({
  coverage,
  active,
}: {
  coverage: Coverage | null;
  active: boolean;
}) {
  if (!coverage) {
    return (
      <div
        className="rounded-2xl px-4 py-3.5"
        style={{
          background: "var(--color-surface-elevated)",
          boxShadow: "0 6px 20px -10px rgba(0,0,0,0.14)",
        }}
      >
        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Coverage
        </div>
        <div className="mt-2 text-[14px] font-medium tracking-tight">
          No coverage yet
        </div>
        <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">
          Stay online to start receiving dispatch requests.
        </p>
      </div>
    );
  }

  const op = active
    ? "Ensure requester ends the shift before leaving the building."
    : "Ensure requester starts the shift once you arrive.";

  return (
    <div
      className="rounded-2xl px-4 py-3.5"
      style={{
        background: "var(--color-surface-elevated)",
        boxShadow: "0 6px 20px -10px rgba(0,0,0,0.14)",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {active ? "Active coverage" : "Next coverage"}
        </div>
        {active ? (
          <span
            className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.14em]"
            style={{ color: "var(--color-presence)" }}
          >
            <span
              className="relative h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--color-presence)" }}
            >
              <span
                className="absolute inset-0 rounded-full"
                style={{
                  background: "var(--color-presence)",
                  opacity: 0.5,
                  animation: "presence-pulse 1.6s ease-out infinite",
                }}
              />
            </span>
            Live
          </span>
        ) : (
          <span className="inline-flex items-center gap-2">
            <RatingPill entityId={hospitalEntityId(coverage.hospital)} role="requester" inline />
            <ReliabilityPill entityId={hospitalEntityId(coverage.hospital)} inline />
          </span>
        )}

      </div>

      <div className="mt-1.5 text-[15.5px] font-semibold leading-tight tracking-tight">
        {coverage.hospital}
      </div>
      <div className="text-[12.5px] text-muted-foreground">{coverage.area}</div>

      <div className="mt-2 text-[12.5px] leading-snug text-foreground/80">
        {fmtOpMeta(coverage.coverage, coverage.day, coverage.start, coverage.end, coverage.durationHrs, coverage.amount)}
      </div>

      <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground">
        {op}
      </p>

      {coverage.note && (
        <p className="mt-1 text-[11.5px] leading-snug text-foreground/70">
          {coverage.note}
        </p>
      )}
    </div>
  );
}

/* ------------------ Stats ------------------ */

function ScoreTile({ score }: { score: number }) {
  return (
    <div
      className="rounded-2xl px-3.5 py-2.5"
      style={{
        background: "var(--color-surface-elevated)",
        boxShadow: "0 6px 20px -10px rgba(0,0,0,0.14)",
      }}
    >
      <div className="flex items-center gap-1.5">
        <div className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Ratings
        </div>
        <TrustInfoPopover align="start" direction="up" showRatings showReliability={false} ratingsText="Based on your last 20 shifts. Updated every 20 shifts. Minimum 3.5 stars." />
      </div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className="text-[18px] font-semibold tabular-nums tracking-tight">
          {score.toFixed(1)}
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-foreground/55">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      </div>
    </div>
  );
}

function ReliabilityTile({ display }: { display: string }) {
  return (
    <div
      className="rounded-2xl px-3.5 py-2.5"
      style={{
        background: "var(--color-surface-elevated)",
        boxShadow: "0 6px 20px -10px rgba(0,0,0,0.14)",
      }}
    >
      <div className="flex items-center gap-1.5">
        <div className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Reliability
        </div>
        <TrustInfoPopover align="end" direction="up" showRatings={false} showReliability reliabilityText="Based on your last 20 shifts. Max 3 cancellations per 20 shifts. Minimum 85%." />
      </div>
      <div className="mt-0.5 text-[18px] font-semibold tabular-nums tracking-tight">
        {display}
      </div>
    </div>
  );
}
