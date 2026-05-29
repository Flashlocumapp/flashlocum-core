import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { DismissSheet } from "@/components/DismissSheet";
import { RatingPill } from "@/components/RatingPill";
import { RatingOverlay } from "@/components/RatingOverlay";
import { recordRating } from "@/lib/ratings";
import { getRole, type Role } from "@/lib/role";
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
  const [role, setLocalRole] = useState<Role | null>(null);
  useEffect(() => setLocalRole(getRole()), []);
  const { incoming, accepted, pendingRating } = useDispatch();
  const net = useNetwork();
  const [summaryDone, setSummaryDone] = useState(false);

  // Reset summary acknowledgement whenever a new pendingRating arrives.
  useEffect(() => {
    if (pendingRating) setSummaryDone(false);
  }, [pendingRating?.requestId]);

  if (role !== "cover") return null;
  if (!incoming && !accepted && !pendingRating) return null;

  const pendingReq = pendingRating ? net.requests[pendingRating.requestId] : null;

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
        {!incoming && !accepted && pendingRating && pendingReq && !summaryDone && (
          <DismissSheet
            key={"summary-" + pendingRating.requestId}
            open
            onDismiss={() => setSummaryDone(true)}
            zIndex={58}
          >
            <PaymentSummary
              hospital={pendingRating.hospital}
              total={pendingReq.settledAmount ?? pendingReq.amount}
              onDone={() => setSummaryDone(true)}
            />
          </DismissSheet>
        )}
      </AnimatePresence>
      <RatingOverlay
        open={!!pendingRating && !incoming && !accepted && summaryDone}
        doctor={pendingRating?.hospital ?? ""}
        onDismiss={dismissPendingRating}
        onSubmit={(rating) => {
          if (rating > 0 && pendingRating) {
            recordRating(pendingRating.hospitalId, rating);
            recordHistoryRating(pendingRating.requestId, rating);
          }
          dismissPendingRating();
        }}
      />

    </div>
  );
}

/* ---------------- Payment Summary (doctor side) ---------------- */

function PaymentSummary({
  hospital,
  total,
  onDone,
}: {
  hospital: string;
  total: number;
  onDone: () => void;
}) {
  const FEE_PCT = 15;
  const fee = Math.round((total * FEE_PCT) / 100);
  const net = Math.max(0, total - fee);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="text-[11px] font-medium uppercase tracking-[0.16em]" style={{ color: "var(--color-presence)" }}>
        Coverage Completed
      </div>
      <div className="mt-2 text-[20px] font-semibold tracking-tight">{hospital}</div>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        Settlement received · here&apos;s your breakdown.
      </p>

      <div className="mt-4 rounded-2xl bg-secondary/60 px-4 py-3">
        <Row label="Total Amount Paid" value={nairaK(total)} />
        <div className="my-2 h-px bg-foreground/[0.06]" />
        <Row label={`FlashLocum Service Fee (${FEE_PCT}%)`} value={"−" + nairaK(fee)} muted />
        <div className="my-2 h-px bg-foreground/[0.06]" />
        <Row label="Final Amount to Doctor" value={nairaK(net)} strong />
      </div>

      <p className="mt-3 text-[12px] text-muted-foreground">
        Settlement will be remitted to your account by 10PM today.
      </p>

      <button
        onClick={onDone}
        className="mt-5 h-12 w-full rounded-full bg-primary text-[14px] font-semibold text-primary-foreground active:opacity-90"
      >
        Done
      </button>
    </motion.div>
  );
}

function IncomingBody({ item }: { item: Coverage }) {
  const fee = feeOf(item);
  const net = netOf(item);
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="relative h-2 w-2 rounded-full"
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
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            New request
          </span>
        </div>
        <RatingPill entityId={hospitalEntityId(item.hospital)} role="requester" inline />
      </div>

      <div className="mt-3 text-[20px] font-semibold leading-tight tracking-tight">
        {item.hospital}
      </div>
      <div className="text-[13px] text-muted-foreground">{item.area}</div>

      <div className="mt-4 text-[13.5px] leading-relaxed text-foreground/80">
        {fmtOpMeta(item.coverage, item.day, item.start, item.end, item.durationHrs, item.amount)}
      </div>

      <div className="mt-4 rounded-2xl bg-secondary/60 px-4 py-3">
        <Row label="Amount" value={nairaK(item.amount)} />
        <div className="my-2 h-px bg-foreground/[0.06]" />
        <Row label={`FlashLocum fee · ${item.feePct}%`} value={"−" + nairaK(fee)} muted />
        <div className="my-2 h-px bg-foreground/[0.06]" />
        <Row label="You receive" value={nairaK(net)} strong />
      </div>

      {item.note && (
        <p className="mt-3 text-[12.5px] text-muted-foreground">
          Note · {item.note}
        </p>
      )}

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

function Row({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
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
  return (
    <div>
      <div className="flex items-center justify-between">
        <div
          className="text-[11px] font-medium uppercase tracking-[0.16em]"
          style={{ color: "var(--color-presence)" }}
        >
          Coverage confirmed
        </div>
        <RatingPill entityId={hospitalEntityId(item.hospital)} role="requester" inline />
      </div>
      <div className="mt-2 text-[20px] font-semibold tracking-tight">
        {item.hospital}
      </div>
      <div className="text-[13px] text-muted-foreground">{item.area}</div>

      <div className="mt-4 text-[13.5px] leading-relaxed text-foreground/80">
        {fmtOpMeta(item.coverage, item.day, item.start, item.end, item.durationHrs, item.amount)}
      </div>

      {item.note && (
        <p className="mt-3 text-[12.5px] text-muted-foreground">
          Note · {item.note}
        </p>
      )}

      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={() => cancelUpcoming(item.id)}
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
    </div>
  );
}
