import { motion } from "framer-motion";

function fmtNaira(n: number) {
  return "₦" + n.toLocaleString("en-NG");
}

/**
 * Doctor-facing "Payment received" confirmation — mirrors the requester's
 * Settlement Confirmed page. Full-screen with a green check, summary card
 * (Facility · Coverage · Total · Fee · Net), and a Continue action. The
 * rating overlay sits on top of this view.
 */
export function PaymentSummaryOverlay({
  open,
  hospital,
  coverage,
  total,
  feePct,
  onAcknowledge,
}: {
  open: boolean;
  hospital: string;
  coverage?: string;
  total: number;
  feePct: number;
  onAcknowledge: () => void;
}) {
  if (!open) return null;
  const fee = Math.round((total * feePct) / 100);
  const net = total - fee;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="fixed inset-0 z-[70] flex flex-col bg-background safe-top"
    >
      <div className="flex h-12 w-full items-center justify-between px-4">
        <button
          onClick={onAcknowledge}
          aria-label="Close"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-elevated"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          FLASHLOCUM
        </span>
        <span className="h-9 w-9" />
      </div>

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 pt-2">
        <div
          className="mt-2 flex h-12 w-12 items-center justify-center rounded-full"
          style={{ background: "color-mix(in oklab, var(--color-presence) 18%, transparent)" }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 12.5l4 4 10-10"
              stroke="var(--color-presence)"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h1 className="mt-4 text-[24px] font-semibold tracking-tight">Payment received</h1>
        <p className="mt-1 text-[13.5px] text-muted-foreground">
          {hospital} confirmed payment for this coverage.
        </p>

        <div className="mt-6 rounded-2xl bg-surface-elevated p-5">
          <Row label="Facility" value={hospital} />
          {coverage && <Row label="Coverage" value={coverage} />}
          <Row label="Total Payment" value={fmtNaira(total)} />
          <Row label={`FlashLocum Fee (${feePct}%)`} value={"−" + fmtNaira(fee)} muted />
          <Row label="Amount To Doctor" value={fmtNaira(net)} strong />
        </div>

        <p className="mt-3 text-[12px] text-muted-foreground">
          Funds are remitted to your registered account by 10PM today.
        </p>

        <div className="mt-auto space-y-2 pb-8">
          <button
            onClick={onAcknowledge}
            className="h-13 w-full rounded-full bg-primary py-4 text-[14.5px] font-semibold text-primary-foreground active:opacity-90"
          >
            Continue
          </button>
        </div>
      </div>
    </motion.section>
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
    <div className="flex items-center justify-between border-b border-border/50 py-2 last:border-0">
      <span
        className="text-[12.5px]"
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
            ? "text-[15px] font-semibold tabular-nums"
            : "text-[13.5px] font-medium tabular-nums"
        }
      >
        {value}
      </span>
    </div>
  );
}
