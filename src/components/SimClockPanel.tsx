// Internal-only Time Fast-Forward control. Hidden from production UX.
// Mounted globally in the app shell. Operates the shared simulation clock
// in `src/lib/clock.ts` — every press synchronizes Cover & Earn and
// Request Coverage on this tab AND every other open tab.

import { useEffect, useState } from "react";
import { advanceSim, resetSim, useSimOffset } from "@/lib/clock";

const PRESETS: { label: string; delta: number }[] = [
  { label: "+15m", delta: 15 * 60_000 },
  { label: "+30m", delta: 30 * 60_000 },
  { label: "+1h", delta: 60 * 60_000 },
  { label: "+6h", delta: 6 * 60 * 60_000 },
  { label: "+12h", delta: 12 * 60 * 60_000 },
  { label: "+1d", delta: 24 * 60 * 60_000 },
];

function fmtOffset(ms: number): string {
  if (ms === 0) return "Real Time";
  const sign = ms > 0 ? "+" : "−";
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86_400_000);
  const h = Math.floor((abs % 86_400_000) / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  return sign + (parts.join(" ") || "0m");
}

export function SimClockPanel() {
  const offset = useSimOffset();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const active = offset !== 0;

  return (
    <div
      className="pointer-events-none fixed left-3 z-[60] flex flex-col items-start gap-2"
      style={{ bottom: "calc(var(--tab-bar-h, 64px) + 12px)" }}
    >
      {open && (
        <div
          className="pointer-events-auto w-[210px] rounded-2xl border p-3 text-foreground shadow-[0_10px_30px_-12px_rgba(0,0,0,0.35)]"
          style={{
            background: "var(--color-surface-elevated, #fff)",
            borderColor: "color-mix(in oklab, currentColor 10%, transparent)",
          }}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Simulation Time
            </span>
            <span
              className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em]"
              style={{
                background: "color-mix(in oklab, currentColor 8%, transparent)",
                color: "color-mix(in oklab, currentColor 65%, transparent)",
              }}
            >
              Dev
            </span>
          </div>

          <div className="mb-2 text-[15px] font-semibold tabular-nums tracking-tight">
            {fmtOffset(offset)}
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            <button
              onClick={resetSim}
              className="col-span-3 h-7 rounded-md text-[11px] font-medium active:opacity-80"
              style={{
                background: active
                  ? "var(--color-primary, #111)"
                  : "color-mix(in oklab, currentColor 8%, transparent)",
                color: active ? "var(--color-primary-foreground, #fff)" : "currentColor",
              }}
            >
              Real Time
            </button>
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => advanceSim(p.delta)}
                className="h-7 rounded-md text-[11px] font-medium tabular-nums active:opacity-80"
                style={{
                  background: "color-mix(in oklab, currentColor 8%, transparent)",
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <p className="mt-2 text-[10px] leading-tight text-muted-foreground">
            Syncs both surfaces &amp; all tabs.
          </p>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="pointer-events-auto flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold tabular-nums shadow-sm active:opacity-80"
        style={{
          background: active
            ? "color-mix(in oklab, var(--color-presence, #16a34a) 14%, var(--color-surface-elevated, #fff))"
            : "var(--color-surface-elevated, #fff)",
          borderColor: "color-mix(in oklab, currentColor 12%, transparent)",
          color: active ? "var(--color-presence, #16a34a)" : "currentColor",
        }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: active ? "var(--color-presence, #16a34a)" : "currentColor" }}
        />
        SIM · {fmtOffset(offset)}
      </button>
    </div>
  );
}
