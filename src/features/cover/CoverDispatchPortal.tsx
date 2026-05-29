import { AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { DismissSheet } from "@/components/DismissSheet";
import { RatingPill } from "@/components/RatingPill";
import { RatingOverlay } from "@/components/RatingOverlay";
import { recordRating } from "@/lib/ratings";
import { getRole, type Role } from "@/lib/role";
import { fmtOpMeta } from "@/lib/format";
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
  useDispatch,
  type Coverage,
} from "@/features/cover/dispatch";

export function CoverDispatchPortal() {
  const [role, setLocalRole] = useState<Role | null>(null);
  useEffect(() => setLocalRole(getRole()), []);
  const { incoming, accepted, pendingRating } = useDispatch();

  if (role !== "cover") return null;
  if (!incoming && !accepted && !pendingRating) return null;

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
      <RatingOverlay
        open={!!pendingRating && !incoming && !accepted}
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
