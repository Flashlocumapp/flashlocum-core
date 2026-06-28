import { motion, type PanInfo } from "framer-motion";
import { type ReactNode } from "react";

/**
 * DismissSheet — calm native-mobile bottom sheet.
 *
 * Dismissable by:
 *  • tapping outside (backdrop)
 *  • tapping the X close affordance
 *  • swiping the sheet downward
 *
 * Dismiss is non-destructive: the caller decides what dismiss means
 * (continue searching, return to previous state, etc.) via `onDismiss`.
 */
export function DismissSheet({
  open,
  onDismiss,
  children,
  showClose = true,
  zIndex = 40,
}: {
  open: boolean;
  onDismiss: () => void;
  children: ReactNode;
  showClose?: boolean;
  zIndex?: number;
}) {
  if (!open) return null;

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.velocity.y > 280 || info.offset.y > 90) onDismiss();
  };

  return (
    <motion.div
      className="absolute inset-0 flex items-end"
      style={{ zIndex }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-foreground/30" onClick={onDismiss} aria-hidden />
      <motion.div
        initial={{ y: 28, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 28, opacity: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 32 }}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.35 }}
        dragMomentum={false}
        onDragEnd={handleDragEnd}
        className="relative z-10 w-full rounded-t-3xl pt-2"
        style={{ background: "var(--color-surface-elevated)" }}
      >
        <div className="flex w-full items-center justify-center pt-1.5 pb-1">
          <span className="h-1.5 w-10 rounded-full bg-muted-foreground/30" />
        </div>
        {showClose && (
          <button
            onClick={onDismiss}
            aria-label="Close"
            className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-foreground/55 active:bg-secondary"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
        <div className="px-6 pb-7 pt-3">{children}</div>
      </motion.div>
    </motion.div>
  );
}
