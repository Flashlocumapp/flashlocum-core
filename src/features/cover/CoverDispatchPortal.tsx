import { AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { DismissSheet } from "@/components/DismissSheet";
import { CancelFlow, type CancelReasonResult } from "@/components/CancelFlow";
import { DOCTOR_REASONS } from "@/lib/cancellation-reasons";
import { RatingPill } from "@/components/RatingPill";
import { ReliabilityPill } from "@/components/ReliabilityPill";
import { RatingOverlay } from "@/components/RatingOverlay";
import { PaymentSummaryOverlay } from "@/components/PaymentSummaryOverlay";
import { EnvironmentBadge } from "@/components/EnvironmentBadge";
import { submitShiftRating } from "@/lib/trust";
import { pushToast } from "@/lib/notifications";
import { fromLocal, ingest } from "@/lib/feedback";
import { getRole, subscribeRoleChange, type Role } from "@/lib/role";
import { fmtOpMeta } from "@/lib/format";
import { useNetwork } from "@/lib/network";


import {
  acceptIncoming,
  cancelUpcoming,
  declineIncoming,
  dismissAccepted,
  dismissPendingRating,
  feeOf,
  hospitalEntityId,
  nairaK,
  netOf,
  recordHistoryRating,
  useDispatch,
  type Coverage,
} from "@/features/cover/dispatch";

export function CoverDispatchPortal() {
  const [role, setLocalRole] = useState<Role | null>(() => getRole());
  useEffect(() => subscribeRoleChange(() => setLocalRole(getRole())), []);
  if (role !== "cover") return null;
  return <CoverDispatchOverlays />;
}

function CoverDispatchOverlays() {
  const { incoming, accepted, pendingRating } = useDispatch();
  const [ratingDismissed, setRatingDismissed] = useState<string | null>(null);
  // Pull operational timestamps directly from the live request row so the
  // Payment received card reflects the exact start / end / billed values
  // backed by shift_segments → coverage_requests.
  const netState = useNetwork();
  const reqRow = pendingRating
    ? netState.requests[pendingRating.requestId]
    : undefined;
  const billedMinutes =
    typeof reqRow?.accumulatedMs === "number"
      ? Math.round(reqRow.accumulatedMs / 60000)
      : null;
  const actualMinutes = billedMinutes;
  const endedAtMs =
    reqRow?.paidAt ??
    reqRow?.updatedAt ??
    (reqRow?.paymentDueAt ? Date.parse(reqRow.paymentDueAt) - 15 * 60 * 1000 : null);
  // Prefer firstStartedAt (monotonic, server-owned). For legacy rows that
  // pre-date `first_started_at`, derive a best-effort start from the known
  // end time minus accumulated worked minutes so the row never blanks.
  const startedAtMs =
    reqRow?.firstStartedAt ??
    reqRow?.startedAt ??
    (endedAtMs && billedMinutes ? endedAtMs - billedMinutes * 60_000 : null);

  if (!incoming && !accepted && !pendingRating) return null;

  const showSummary = !!pendingRating && !incoming && !accepted;
  const showRating = showSummary && ratingDismissed !== pendingRating!.requestId;

  return (
    <div className="absolute inset-0 z-50">
      <AnimatePresence>
        {incoming && (
          <DismissSheet
            key={"incoming-" + incoming.id}
            open
            onDismiss={declineIncoming}
            zIndex={60}
          >
            <IncomingBody item={incoming} />
          </DismissSheet>
        )}
        {!incoming && accepted && (
          <DismissSheet
            key={"accepted-" + accepted.id}
            open
            onDismiss={dismissAccepted}
            zIndex={55}
          >
            <AcceptedBody item={accepted} />
          </DismissSheet>
        )}
      </AnimatePresence>

      <PaymentSummaryOverlay
        open={showSummary}
        hospital={pendingRating?.hospital ?? ""}
        coverage={pendingRating?.coverage}
        total={pendingRating?.total ?? 0}
        feePct={pendingRating?.feePct ?? 15}
        startedAtMs={startedAtMs}
        endedAtMs={endedAtMs}
        actualMinutes={actualMinutes}
        billedMinutes={billedMinutes}
        onAcknowledge={() => {
          dismissPendingRating();
          setRatingDismissed(null);
        }}
      />

      <RatingOverlay
        open={showRating}
        doctor={pendingRating?.hospital ?? ""}
        onDismiss={() => {
          if (pendingRating) setRatingDismissed(pendingRating.requestId);
        }}
        onSubmit={(rating, feedback) => {
          if (rating > 0 && pendingRating) {
            const requestId = pendingRating.requestId;
            void (async () => {
              const res = await submitShiftRating(requestId, rating, feedback || null);
              if (!res.ok && res.error !== "already_rated") {
                pushToast({ tone: "warn", title: res.message || "Couldn't save rating." });
                return;
              }
              const { markRated } = await import("@/lib/rated-shifts");
              markRated(requestId);
              // Audit-10: positive confirmation toast.
              ingest(
                fromLocal({
                  kind: "rating.submitted",
                  entityId: requestId,
                  audience: "doctor",
                }),
              );
            })();
            recordHistoryRating(pendingRating.requestId, rating);
          }
          if (pendingRating) setRatingDismissed(pendingRating.requestId);
        }}
      />
    </div>
  );
}

function IncomingBody({ item }: { item: Coverage }) {
  const fee = feeOf(item);
  const net = netOf(item);
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="relative h-2 w-2 rounded-full" style={{ background: "var(--color-presence)" }}>
            <span
              className="absolute inset-0 rounded-full"
              style={{ background: "var(--color-presence)", opacity: 0.5, animation: "presence-pulse 1.6s ease-out infinite" }}
            />
          </span>
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            New request
          </span>
        </div>
        <div className="inline-flex items-center gap-2">
          <RatingPill entityId={hospitalEntityId(item.hospital)} role="requester" inline />
          <ReliabilityPill entityId={hospitalEntityId(item.hospital)} inline />
          <EnvironmentBadge environment={item.environment ?? "normal"} size="sm" />
        </div>

      </div>

      <div className="mt-3 text-[20px] font-semibold leading-tight tracking-tight">{item.hospital}</div>
      <div className="text-[13px] text-muted-foreground">{item.area}</div>

      <div className="mt-4 text-[13.5px] leading-relaxed text-foreground/80">
        {fmtOpMeta(item.coverage, item.day, item.start, item.end, item.durationHrs, item.amount)}
        {item.days > 1 && (
          <span className="ml-2 inline-flex h-4 items-center rounded-full bg-secondary/80 px-1.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-foreground/75">
            Day {Math.min(item.dayIndex, item.days)} of {item.days}
          </span>
        )}
      </div>

      <div className="mt-4 rounded-2xl bg-secondary/60 px-4 py-3">
        <Row label="Amount" value={nairaK(item.amount)} />
        <div className="my-2 h-px bg-foreground/[0.06]" />
        <Row label={`FlashLocum fee · ${item.feePct}%`} value={"−" + nairaK(fee)} muted />
        <div className="my-2 h-px bg-foreground/[0.06]" />
        <Row label="You receive" value={nairaK(net)} strong />
      </div>

      {item.note && <p className="mt-3 text-[12.5px] text-muted-foreground">Note · {item.note}</p>}

      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={declineIncoming}
          className="h-12 flex-1 rounded-full bg-secondary text-[14px] font-medium text-foreground/75 active:opacity-90"
        >
          Decline
        </button>
        <button
          onClick={acceptIncoming}
          className="h-12 flex-[1.4] rounded-full bg-primary text-[14.5px] font-semibold text-primary-foreground active:opacity-90"
        >
          Accept
        </button>
      </div>
    </div>
  );
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <span
        className="text-[12px] tracking-tight"
        style={{
          color: muted
            ? "color-mix(in oklab, var(--color-foreground) 50%, transparent)"
            : "color-mix(in oklab, var(--color-foreground) 60%, transparent)",
        }}
      >
        {label}
      </span>
      <span
        className={
          strong
            ? "text-[18px] font-semibold tracking-tight tabular-nums"
            : "text-[14px] font-medium tabular-nums"
        }
      >
        {value}
      </span>
    </div>
  );
}

function AcceptedBody({ item }: { item: Coverage }) {
  const [cancelOpen, setCancelOpen] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-medium uppercase tracking-[0.16em]" style={{ color: "var(--color-presence)" }}>
          Coverage confirmed
        </div>
        <div className="inline-flex items-center gap-2">
          <RatingPill entityId={hospitalEntityId(item.hospital)} role="requester" inline />
          <ReliabilityPill entityId={hospitalEntityId(item.hospital)} inline />
        </div>

      </div>
      <div className="mt-2 text-[20px] font-semibold tracking-tight">{item.hospital}</div>
      <div className="text-[13px] text-muted-foreground">{item.area}</div>

      <div className="mt-4 text-[13.5px] leading-relaxed text-foreground/80">
        {fmtOpMeta(item.coverage, item.day, item.start, item.end, item.durationHrs, item.amount)}
        {item.days > 1 && (
          <span className="ml-2 inline-flex h-4 items-center rounded-full bg-secondary/80 px-1.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-foreground/75">
            Day {Math.min(item.dayIndex, item.days)} of {item.days}
          </span>
        )}
      </div>

      {item.note && <p className="mt-3 text-[12.5px] text-muted-foreground">Note · {item.note}</p>}

      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={() => setCancelOpen(true)}
          className="h-12 flex-1 rounded-full bg-secondary text-[13.5px] font-medium text-foreground/75 active:opacity-90"
        >
          Cancel Shift
        </button>
        <a
          href={`tel:${item.phone}`}
          className="flex h-12 flex-1 items-center justify-center rounded-full bg-primary text-[14px] font-semibold text-primary-foreground active:opacity-90"
        >
          Call
        </a>
      </div>

      <CancelFlow
        open={cancelOpen}
        onDismiss={() => setCancelOpen(false)}
        confirmTitle="Cancel this shift?"
        confirmBody="Frequent cancellations affect your reliability score. The requester will be notified immediately."
        primaryLabel="Keep Shift"
        secondaryLabel="Cancel Shift"
        reasons={DOCTOR_REASONS}
        onCancelled={(result) => {
          setCancelOpen(false);
          if (result) cancelUpcoming(item.id, { code: result.code, text: result.text });
        }}
      />
    </div>
  );
}

