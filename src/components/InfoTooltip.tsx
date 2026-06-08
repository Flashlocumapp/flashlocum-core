import { useState, useRef, useEffect } from "react";

/**
 * InfoTooltip — small "i" icon that reveals a brief explanation on tap.
 * Auto-hides after 4 s or on outside tap. Positioned above the trigger.
 */
export function InfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("click", handleClick);
    const timer = setTimeout(() => setOpen(false), 4000);
    return () => {
      document.removeEventListener("click", handleClick);
      clearTimeout(timer);
    };
  }, [open]);

  return (
    <div className="relative inline-flex shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center justify-center rounded-full"
        style={{
          width: 14,
          height: 14,
          color: "color-mix(in oklab, var(--color-foreground) 45%, transparent)",
          border: "1px solid color-mix(in oklab, var(--color-foreground) 20%, transparent)",
        }}
        aria-label="More info"
      >
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <path d="M12 16v-4M12 8h.01" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 rounded-xl px-3 py-2 text-[11px] leading-snug shadow-lg"
          style={{
            background: "var(--color-surface-elevated)",
            border: "1px solid color-mix(in oklab, var(--color-foreground) 10%, transparent)",
            color: "var(--color-foreground)",
            maxWidth: 220,
            width: "max-content",
          }}
        >
          {text}
          {/* caret */}
          <span
            className="absolute left-1/2 top-full -translate-x-1/2"
            style={{
              width: 0,
              height: 0,
              borderLeft: "5px solid transparent",
              borderRight: "5px solid transparent",
              borderTop: "5px solid var(--color-surface-elevated)",
            }}
          />
        </div>
      )}
    </div>
  );
}
