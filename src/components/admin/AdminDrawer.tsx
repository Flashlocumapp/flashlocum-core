/**
 * Shared chrome for admin detail drawers (user / shift / payment).
 *
 * Renders a right-side overlay panel with header, tabs, and scrollable body.
 * Kept dependency-free (no Radix Dialog) to match the existing admin look
 * already used in `_admin.admin.shifts.tsx`.
 */
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

export function AdminDrawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = "max-w-2xl",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  width?: string;
}) {
  // Close on Esc.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-foreground/30" />
      <div
        className={`relative z-10 flex h-full w-full ${width} flex-col overflow-hidden`}
        style={{ background: "var(--color-surface-elevated)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold tracking-tight">{title}</div>
            {subtitle && <div className="mt-0.5 text-[12px] text-muted-foreground">{subtitle}</div>}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-full bg-secondary px-3 py-1 text-[12px]"
          >
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export function TabBar<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string; badge?: number | null }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b px-3 py-2">
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-medium transition ${
              active ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"
            }`}
          >
            {t.label}
            {typeof t.badge === "number" && t.badge > 0 && (
              <span className="ml-1.5 text-[10.5px] opacity-80">{t.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="px-5 py-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {title}
        </h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-[12px]" : "text-foreground"}>{value ?? "—"}</span>
    </div>
  );
}

export function Copyable({ text }: { text: string | null | undefined }) {
  const [copied, setCopied] = useState(false);
  if (!text) return <span>—</span>;
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* noop */
        }
      }}
      className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11.5px] hover:bg-secondary/70"
      title="Click to copy"
    >
      {copied ? "Copied" : text}
    </button>
  );
}

export function ReasonPrompt({
  open,
  title,
  hint,
  submitting,
  onClose,
  onSubmit,
  confirmLabel = "Confirm",
  destructive = false,
  amountField = false,
  referenceField = false,
}: {
  open: boolean;
  title: string;
  hint?: string;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (input: {
    reason: string;
    amount?: number;
    reference?: string;
  }) => Promise<void> | void;
  confirmLabel?: string;
  destructive?: boolean;
  amountField?: boolean;
  referenceField?: boolean;
}) {
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  useEffect(() => {
    if (!open) {
      setReason("");
      setAmount("");
      setReference("");
    }
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-foreground/40" />
      <div
        className="relative z-10 w-full max-w-md rounded-2xl p-5"
        style={{ background: "var(--color-surface-elevated)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
        {hint && <p className="mt-1 text-[12.5px] text-muted-foreground">{hint}</p>}
        {amountField && (
          <input
            type="number"
            inputMode="decimal"
            placeholder="Amount (₦)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-3 h-10 w-full rounded-xl bg-secondary px-3 text-[14px] outline-none"
          />
        )}
        {referenceField && (
          <input
            placeholder="Reference (optional)"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className="mt-3 h-10 w-full rounded-xl bg-secondary px-3 text-[14px] outline-none"
          />
        )}
        <textarea
          placeholder="Reason (required)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="mt-3 w-full resize-none rounded-xl bg-secondary p-3 text-[14px] outline-none"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="h-9 rounded-full bg-secondary px-4 text-[12.5px] font-medium"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            onClick={() =>
              void onSubmit({
                reason,
                amount: amountField ? Number(amount) || 0 : undefined,
                reference: referenceField ? reference || undefined : undefined,
              })
            }
            disabled={submitting || !reason.trim() || (amountField && !(Number(amount) > 0))}
            className={`h-9 rounded-full px-4 text-[12.5px] font-semibold disabled:opacity-60 ${
              destructive
                ? "bg-destructive text-destructive-foreground"
                : "bg-primary text-primary-foreground"
            }`}
          >
            {submitting ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
