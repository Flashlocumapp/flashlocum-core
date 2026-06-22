import { AnimatePresence, motion } from "framer-motion";
import { useLatestToast } from "@/lib/notifications";

/**
 * ToastHost — single calm slot for ambient operational toasts.
 * Floats above content, beneath bottom tabs.
 */
export function ToastHost() {
  const toast = useLatestToast();
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.id}
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 12, opacity: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 30 }}
          className="pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-4"
          style={{ bottom: "calc(var(--tab-bar-h, 64px) + 16px)" }}
        >
          <div
            className="pointer-events-auto max-w-[88%] rounded-2xl px-4 py-3 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.22)]"
            style={{ background: "var(--color-surface-elevated)" }}
          >
            <div className="flex items-start gap-2.5">
              <span
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                style={{
                  background:
                    toast.tone === "warn"
                      ? "color-mix(in oklab, var(--color-foreground) 40%, transparent)"
                      : "var(--color-presence)",
                }}
              />
              <div className="min-w-0">
                <div className="text-[13px] font-medium leading-snug tracking-tight">
                  {toast.title}
                </div>
                {toast.body && (
                  <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
                    {toast.body}
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
