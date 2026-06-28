import type { ReactNode } from "react";

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-secondary p-6 text-center text-[13.5px] text-muted-foreground">
      {children}
    </div>
  );
}

export function Chip({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span
      className="inline-flex h-5 items-center rounded-full px-2 text-[10.5px] font-semibold uppercase tracking-wider"
      style={{
        color: color ?? "var(--color-muted-foreground)",
        background: "color-mix(in oklab, currentColor 12%, transparent)",
      }}
    >
      {children}
    </span>
  );
}

export type VerificationStatus =
  "pending" | "approved" | "suspended" | "rejected" | "action_required";

// eslint-disable-next-line react-refresh/only-export-components
export function statusTone(s: VerificationStatus) {
  switch (s) {
    case "approved":
      return { label: "Approved", color: "var(--color-presence)" };
    case "suspended":
      return { label: "Suspended", color: "#c2410c" };
    case "rejected":
      return { label: "Rejected", color: "#b91c1c" };
    case "action_required":
      return { label: "Action required", color: "#b45309" };
    default:
      return { label: "Pending", color: "var(--color-muted-foreground)" };
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

// eslint-disable-next-line react-refresh/only-export-components
export function fmt(d: string | number | null | undefined): string {
  if (d == null || d === "") return "—";
  try {
    return new Date(d).toLocaleString();
  } catch {
    return "—";
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export function fmtDate(d: string | number | null | undefined): string {
  if (d == null || d === "") return "—";
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return "—";
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export function fmtRelative(d: string | number | null | undefined): string {
  if (d == null || d === "") return "never";
  const t = typeof d === "string" ? new Date(d).getTime() : d;
  const ms = Date.now() - t;
  if (Number.isNaN(ms) || ms < 0) return "—";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(t).toLocaleDateString();
}

// eslint-disable-next-line react-refresh/only-export-components
export function fmtNaira(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return `₦${Number(amount).toLocaleString()}`;
}

export function AdminPageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b pb-4">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{subtitle}</p>}
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  tone,
  live,
  hint,
}: {
  label: string;
  value: number | string | undefined | null;
  tone?: "presence" | "warn" | "danger";
  live?: boolean;
  hint?: string;
}) {
  const color =
    tone === "presence"
      ? "var(--color-presence)"
      : tone === "danger"
        ? "#b91c1c"
        : tone === "warn"
          ? "#c2410c"
          : "var(--color-foreground)";
  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: "var(--color-surface-elevated)",
        boxShadow: "0 6px 20px -10px rgba(0,0,0,0.10)",
      }}
    >
      <div className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
        {live && (
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{
              background: "var(--color-presence)",
              boxShadow: "0 0 0 3px color-mix(in oklab, var(--color-presence) 22%, transparent)",
            }}
          />
        )}
      </div>
      <div className="mt-1.5 text-[26px] font-semibold tracking-tight" style={{ color }}>
        {value ?? "—"}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function RefreshButton({ onClick, busy }: { onClick: () => void; busy?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="h-9 rounded-full bg-secondary px-4 text-[12.5px] font-medium disabled:opacity-60"
    >
      {busy ? "Refreshing…" : "Refresh"}
    </button>
  );
}
