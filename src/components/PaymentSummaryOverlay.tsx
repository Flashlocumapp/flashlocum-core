import { motion } from "framer-motion";

function fmtNaira(n: number) {
  return "₦" + n.toLocaleString("en-NG");
}

/**
 * Doctor-facing payment summary, shown immediately after the requester
 * confirms payment. Displays Total · FlashLocum Fee · Amount To Doctor.
 * Acknowledging closes the sheet; the rating overlay is shown after.
 */
export function PaymentSummaryOverlay({
  open,
  hospital,
  total,
  feePct,
  onAcknowledge,
}: {
  open: boolean;
  hospital: string;
  total: number;
  feePct: number;
  onAcknowledge: () => void;
}) {
  if (!open) return null;
  const fee = Math.round((total * feePct) / 100);
  const net = total - fee;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/55 px-4 pb-6 safe-bottom"
    >
      <motion.div
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 280, damping: 32 }}
        className="w-full max-w-md rounded-3xl bg-card p-5"
        style={{ boxShadow: "0 -20px 60px -20px rgba(0,0,0,0.45)" }}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/20" />
        <div
          className="text-[11px] font-medium uppercase tracking-[0.16em]"
          style={{ color: "var(--color-presence)" }}
        >
          Payment received
        </div>
        <h2 className="mt-1.5 text-[22px] font-semibold tracking-tight">
          Payment summary
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {hospital} confirmed payment for this coverage.
        </p>

        <div
          className="mt-5 overflow-hidden rounded-2xl"
          style={{ background: "var(--color-surface-elevated)" }}
        >
          <Row label="Total Payment" value={fmtNaira(total)} />
          <Row label={`FlashLocum Fee (${feePct}%)`} value={"−" + fmtNaira(fee)} muted />
          <Row label="Amount To Doctor" value={fmtNaira(net)} strong />
        </div>

        <p className="mt-3 text-[12px] text-muted-foreground">
          Funds are remitted to your registered account by 10PM today.
        </p>

        <button
          onClick={onAcknowledge}
          className="mt-5 h-13 w-full rounded-2xl bg-primary py-3.5 text-[15px] font-semibold text-primary-foreground active:opacity-90"
        >
          Continue
        </button>
      </motion.div>
    </motion.div>
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
    <div
      className="flex items-baseline justify-between px-4 py-3.5"
      style={{
        borderTop: "1px solid color-mix(in oklab, var(--color-foreground) 5%, transparent)",
      }}
    >
      <span
        className="text-[13px]"
        style={{
          color: muted
            ? "color-mix(in oklab, var(--color-foreground) 55%, transparent)"
            : "color-mix(in oklab, var(--color-foreground) 70%, transparent)",
        }}
      >
        {label}
      </span>
      <span
        className={
          strong
            ? "text-[20px] font-semibold tabular-nums tracking-tight"
            : "text-[15px] font-medium tabular-nums"
        }
      >
        {value}
      </span>
    </div>
  );
}
