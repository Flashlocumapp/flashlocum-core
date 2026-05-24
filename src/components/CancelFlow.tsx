import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { DismissSheet } from "@/components/DismissSheet";

const DEFAULT_REASONS = [
  "Coverage no longer needed",
  "Timing changed",
  "Doctor sourced elsewhere",
  "Duplicate request",
  "Emergency resolved",
  "Other",
];

type Step = "confirm" | "reason";

/**
 * Shared two-step cancellation flow:
 *  1. "Are you sure?" — primary keeps current operational state,
 *     dismiss (outside / X / swipe) also keeps current state.
 *  2. "Reason for cancellation" — only this step actually cancels.
 */
export function CancelFlow({
  open,
  onDismiss,
  onCancelled,
  confirmTitle = "Are you sure?",
  confirmBody = "We're still connecting to available doctors nearby.",
  primaryLabel = "Wait for Doctor",
  secondaryLabel = "Cancel Request",
}: {
  open: boolean;
  onDismiss: () => void;
  onCancelled: (reason: string) => void;
  confirmTitle?: string;
  confirmBody?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
}) {
  const [step, setStep] = useState<Step>("confirm");
  const [reason, setReason] = useState<string | null>(null);

  const close = () => {
    setStep("confirm");
    setReason(null);
    onDismiss();
  };

  return (
    <AnimatePresence onExitComplete={() => { setStep("confirm"); setReason(null); }}>
      {open && (
        <DismissSheet open={open} onDismiss={close}>
          <AnimatePresence mode="wait">
            {step === "confirm" ? (
              <motion.div
                key="confirm"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
              >
                <h3 className="text-[17px] font-semibold tracking-tight">{confirmTitle}</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
                  {confirmBody}
                </p>
                <div className="mt-5 flex flex-col gap-2">
                  <button
                    onClick={close}
                    className="h-12 w-full rounded-full bg-primary text-[14px] font-semibold text-primary-foreground active:opacity-90"
                  >
                    {primaryLabel}
                  </button>
                  <button
                    onClick={() => setStep("reason")}
                    className="h-12 w-full rounded-full bg-secondary/70 text-[14px] font-medium text-foreground/80 active:opacity-90"
                  >
                    {secondaryLabel}
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="reason"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
              >
                <h3 className="text-[17px] font-semibold tracking-tight">
                  Reason for cancellation
                </h3>
                <ul className="mt-4 space-y-1.5">
                  {CANCEL_REASONS.map((r) => {
                    const active = r === reason;
                    return (
                      <li key={r}>
                        <button
                          onClick={() => setReason(r)}
                          className="flex w-full items-center justify-between rounded-xl px-3.5 py-3 text-left text-[13.5px] transition-colors"
                          style={{
                            background: active ? "var(--color-secondary)" : "transparent",
                            color: active
                              ? "var(--color-foreground)"
                              : "color-mix(in oklab, var(--color-foreground) 75%, transparent)",
                          }}
                        >
                          <span>{r}</span>
                          {active && (
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ background: "var(--color-presence)" }}
                            />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <button
                  onClick={() => {
                    if (!reason) return;
                    onCancelled(reason);
                    setStep("confirm");
                    setReason(null);
                  }}
                  disabled={!reason}
                  className="mt-5 h-12 w-full rounded-full bg-primary text-[14px] font-semibold text-primary-foreground disabled:opacity-40 active:opacity-90"
                >
                  Confirm Cancellation
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </DismissSheet>
      )}
    </AnimatePresence>
  );
}
