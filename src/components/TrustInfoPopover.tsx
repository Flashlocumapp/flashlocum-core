import { useEffect, useRef, useState } from "react";

/**
 * TrustInfoPopover — small info (i) button that opens a calm explanation
 * of the Ratings and Reliability trust metrics. Always opens downward.
 */
export function TrustInfoPopover({
  showRatings = true,
  showReliability = true,
  align = "center",
  direction = "down",
  className = "",
}: {
  showRatings?: boolean;
  showReliability?: boolean;
  align?: "start" | "center" | "end";
  direction?: "up" | "down";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const alignClass =
    align === "start" ? "left-0" : align === "end" ? "right-0" : "left-1/2 -translate-x-1/2";

  return (
    <div ref={ref} className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label="About trust metrics"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full transition-opacity active:opacity-70"
        style={{
          background: "color-mix(in oklab, var(--color-foreground) 8%, transparent)",
          color: "color-mix(in oklab, var(--color-foreground) 70%, transparent)",
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M12 8.5h.01M11 12h1v4.5h1"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          className={`absolute ${direction === "up" ? "bottom-full mb-2" : "top-full mt-2"} z-50 w-64 rounded-2xl px-3.5 py-3 text-left ${alignClass}`}
          style={{
            background: "var(--color-surface-elevated)",
            border: "1px solid color-mix(in oklab, var(--color-foreground) 10%, transparent)",
            boxShadow: "0 12px 32px -12px rgba(0,0,0,0.22)",
          }}
        >
          {showRatings && (
            <div>
              <div className="flex items-center gap-1.5 text-[11.5px] font-semibold tracking-tight text-foreground">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="var(--color-trust)" aria-hidden>
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                Ratings
              </div>
              <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
                Average feedback from completed shifts. Shows overall quality of experience.
              </p>
            </div>
          )}
          {showRatings && showReliability && (
            <div
              className="my-2 h-px"
              style={{ background: "color-mix(in oklab, var(--color-foreground) 10%, transparent)" }}
            />
          )}
          {showReliability && (
            <div>
              <div className="flex items-center gap-1.5 text-[11.5px] font-semibold tracking-tight text-foreground">
                <span
                  aria-hidden
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "9999px",
                    background: "var(--color-trust)",
                    display: "inline-block",
                  }}
                />
                Reliability
              </div>
              <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
                How often accepted shifts are successfully completed. Shows how dependable this doctor/hospital is.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
