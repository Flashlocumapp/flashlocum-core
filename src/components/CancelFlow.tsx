import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { DismissSheet } from "@/components/DismissSheet";
import type { CancellationReason } from "@/lib/cancellation-reasons";

const DEFAULT_REASONS: CancellationReason[] = [
  { code: "no_longer_needed", label: "Coverage no longer needed" },
  { code: "schedule_changed", label: "Timing changed" },
  { code: "found_alternative", label: "Doctor sourced elsewhere" },
  { code: "wrong_details", label: "Duplicate request" },
  { code: "other", label: "Other" },
];

type Step = "confirm" | "reason";

export type CancelReasonResult = { code: string; label: string; text?: string };

/**
 * Shared two-step cancellation flow:
 *  1. "Are you sure?" — primary keeps current operational state,
 *     dismiss (outside / X / swipe) also keeps current state.
 *  2. "Reason for cancellation" — only this step actually cancels.
 *     If the selected reason is `other`, a free-text explanation is required.
 */
export function CancelFlow({
  open,
  onDismiss,
  onCancelled,
  confirmTitle = "Are you sure?",
  confirmBody = "We're still connecting to available doctors nearby.",
  primaryLabel = "Wait for Doctor",
  secondaryLabel = "Cancel Request",
  reasons = DEFAULT_REASONS,
  reasonTitle = "Reason for cancellation",
  skipReason = false,
}: {
  open: boolean;
  onDismiss: () => void;
  onCancelled: (result?: CancelReasonResult) => void;
  confirmTitle?: string;
  confirmBody?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  reasons?: readonly CancellationReason[];
  reasonTitle?: string;
  skipReason?: boolean;
}) {
  const [step, setStep] = useState<Step>("confirm");
  const [selected, setSelected] = useState<CancellationReason | null>(null);
  const [text, setText] = useState("");

  const reset = () => {
    setStep("confirm");
    setSelected(null);
    setText("");
  };

  const close = () => {
    reset();
    onDismiss();
  };

  const needsText = selected?.code === "other";
  const canSubmit = !!selected && (!needsText || text.trim().length > 0);

  return (
    <AnimatePresence onExitComplete={reset}>
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
                    onClick={() => {
                      if (skipReason) {
                        onCancelled();
                        reset();
                      } else {
                        setStep("reason");
                      }
                    }}
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
                <h3 className="text-[17px] font-semibold tracking-tight">{reasonTitle}</h3>
                <ul className="mt-4 space-y-1.5">
                  {reasons.map((r) => {
                    const active = r.code === selected?.code;
                    return (
                      <li key={r.code}>
                        <button
                          onClick={() => setSelected(r)}
                          className="flex w-full items-center justify-between rounded-xl px-3.5 py-3 text-left text-[13.5px] transition-colors"
                          style={{
                            background: active ? "var(--color-secondary)" : "transparent",
                            color: active
                              ? "var(--color-foreground)"
                              : "color-mix(in oklab, var(--color-foreground) 75%, transparent)",
                          }}
                        >
                          <span>{r.label}</span>
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

                {needsText && (
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Briefly explain (required)"
                    rows={3}
                    maxLength={500}
                    className="mt-3 w-full resize-none rounded-xl border border-border/60 bg-background px-3.5 py-2.5 text-[13.5px] leading-relaxed text-foreground outline-none focus:border-foreground/40"
                  />
                )}

                <button
                  onClick={() => {
                    if (!selected || !canSubmit) return;
                    onCancelled({
                      code: selected.code,
                      label: selected.label,
                      text: needsText ? text.trim() : undefined,
                    });
                    reset();
                  }}
                  disabled={!canSubmit}
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
