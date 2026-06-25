import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { sheetEnter, fadeFast } from "@/lib/motion";

export function RatingOverlay({
  open,
  doctor,
  onDismiss,
  onSubmit,
}: {
  open: boolean;
  doctor: string;
  onDismiss: () => void;
  onSubmit: (rating: number, feedback: string) => void;
}) {
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState("");

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-end"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={fadeFast}
        >
          <div className="absolute inset-0 bg-foreground/30" onClick={onDismiss} aria-hidden />
          <motion.div
            initial={{ y: 28, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 28, opacity: 0 }}
            transition={sheetEnter}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.35 }}
            dragMomentum={false}
            onDragEnd={(_, info) => {
              if (info.velocity.y > 280 || info.offset.y > 90) onDismiss();
            }}
            className="relative z-10 w-full rounded-t-3xl pt-2"
            style={{
              background: "var(--color-surface-elevated)",
              paddingBottom: "max(env(safe-area-inset-bottom), 16px)",
            }}
          >
            <div className="flex w-full justify-center pt-1.5 pb-1">
              <span className="h-1.5 w-10 rounded-full bg-muted-foreground/30" />
            </div>
            <button
              onClick={onDismiss}
              aria-label="Close"
              className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-foreground/55 active:bg-secondary"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>

            <div className="px-6 pb-7 pt-3">
              <h3 className="text-[17px] font-semibold tracking-tight">
                How was the experience with {doctor.split(" ").slice(0, 2).join(" ")}?
              </h3>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                Share your feedback and help us improve.
              </p>


              <div className="mt-5 flex items-center justify-between px-2">
                {[1, 2, 3, 4, 5].map((n) => {
                  const active = n <= rating;
                  return (
                    <button
                      key={n}
                      onClick={() => setRating(n)}
                      aria-label={`${n} star${n > 1 ? "s" : ""}`}
                      className="p-1 transition-transform active:scale-90"
                    >
                      <Star filled={active} />
                    </button>
                  );
                })}
              </div>

              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Add a note (optional)"
                rows={2}
                className="mt-4 w-full resize-none rounded-2xl bg-secondary/60 px-3 py-2.5 text-[13.5px] outline-none placeholder:text-muted-foreground/55"
              />

              <button
                onClick={() => onSubmit(rating, feedback)}
                className="mt-4 h-12 w-full rounded-full bg-primary text-[14px] font-semibold text-primary-foreground active:opacity-90"
              >
                {rating > 0 ? "Submit" : "Skip"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Star({ filled }: { filled: boolean }) {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z"
        fill={filled ? "var(--color-presence)" : "transparent"}
        stroke={filled ? "var(--color-presence)" : "color-mix(in oklab, var(--color-foreground) 35%, transparent)"}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
