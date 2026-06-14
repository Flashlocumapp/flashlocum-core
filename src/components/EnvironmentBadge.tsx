import { memo } from "react";

/**
 * Small chip surfacing the operating environment chosen at booking.
 * Visible across every doctor-facing surface so doctors know what
 * they're walking into before/during a shift. No pricing copy.
 */
export const EnvironmentBadge = memo(function EnvironmentBadge({
  environment,
  size = "sm",
  className,
}: {
  environment?: "normal" | "busy" | null;
  size?: "xs" | "sm";
  className?: string;
}) {
  if (!environment) return null;
  const busy = environment === "busy";
  const label = busy ? "Busy" : "Normal";
  const px = size === "xs" ? "px-1.5 py-0.5 text-[9.5px]" : "px-2 py-0.5 text-[10.5px]";
  const dot = busy ? "var(--color-destructive)" : "var(--color-presence)";
  const bg = busy
    ? "color-mix(in oklab, var(--color-destructive) 14%, transparent)"
    : "color-mix(in oklab, var(--color-presence) 14%, transparent)";
  const color = busy ? "var(--color-destructive)" : "var(--color-presence)";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium uppercase tracking-[0.1em] ${px} ${className ?? ""}`}
      style={{ background: bg, color }}
      aria-label={`${label} environment`}
    >
      <span className="h-1 w-1 rounded-full" style={{ background: dot }} />
      {label}
    </span>
  );
});
