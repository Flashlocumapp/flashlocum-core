import { useEffect, useState } from "react";
import { DismissSheet } from "./DismissSheet";
import { EnvironmentBadge } from "./EnvironmentBadge";
import { fmtNairaK, shortWeekdays } from "@/lib/format";
import { useDoctorIdentity } from "@/lib/doctor-identity";

export type HistoryDetail = {
  id: string;
  doctorSid: string | null;
  coverage: string;
  completedOn?: string;
  amount: number;
  note?: string;
  rating?: number;
  environment?: "normal" | "busy";
  /** Exact moment the shift first started (ms epoch). */
  startedAtMs?: number | null;
  /** Exact moment the shift ended (ms epoch). */
  endedAtMs?: number | null;
  /** Actual worked minutes summed across segments. */
  actualMinutes?: number | null;
  /** Server-billed minutes. */
  billedMinutes?: number | null;
};

function fmtMoment(ms: number | null | undefined) {
  if (!ms) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-NG", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function fmtHrMin(min: number) {
  const m = Math.max(0, Math.floor(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}min`;
  if (r === 0) return `${h}hr`;
  return `${h}hr ${r}min`;
}


export function HistoryDetailSheet({
  open,
  item,
  onDismiss,
  onRate,
  alreadyRated = false,
}: {
  open: boolean;
  item: HistoryDetail | null;
  onDismiss: () => void;
  onRate: (id: string, rating: number, feedback: string) => void | Promise<void>;
  /** True when the current user has already submitted a rating for this shift,
   *  even if the numeric score isn't loaded locally. Collapses the form. */
  alreadyRated?: boolean;
}) {

  const [rating, setRating] = useState(item?.rating ?? 0);
  const [feedback, setFeedback] = useState("");
  // Locally remember that the user just submitted, so the rating form
  // collapses immediately — independent of whether the server snapshot
  // has refreshed `item.rating` yet.
  const [localSubmitted, setLocalSubmitted] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const identity = useDoctorIdentity(item?.doctorSid ?? null);

  // Reset draft state whenever the open row changes.
  useEffect(() => {
    setRating(item?.rating ?? 0);
    setFeedback("");
    setLocalSubmitted(null);
    setSubmitting(false);
  }, [item?.id]);

  if (!item) return null;

  const startedLabel = fmtMoment(item.startedAtMs ?? null);
  const endedLabel = fmtMoment(item.endedAtMs ?? null);
  const effectiveRating = item.rating ?? localSubmitted ?? null;
  const showRating = effectiveRating == null;

  const meta = `${item.coverage} · ${shortWeekdays(item.completedOn ?? "")} · ${fmtNairaK(item.amount)}`;

  return (
    <DismissSheet open={open} onDismiss={onDismiss}>
      <div className="flex items-center gap-3">
        <span
          className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full text-[14px] font-semibold"
          style={{ background: "var(--color-secondary)" }}
        >
          {identity.selfieUrl ? (
            <img src={identity.selfieUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            identity.initials
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-medium">{identity.fullName}</div>
          <div className="text-[12px] text-muted-foreground">{identity.mdcn}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <EnvironmentBadge environment={item.environment} size="xs" />
          <span
            className="rounded-full px-2.5 py-1 text-[10.5px] font-medium uppercase tracking-[0.1em]"
            style={{
              background: "color-mix(in oklab, var(--color-presence) 14%, transparent)",
              color: "var(--color-presence)",
            }}
          >
            Settled
          </span>
        </div>
      </div>


      <div className="mt-4 rounded-2xl bg-secondary/50 px-3.5 py-3">
        <Row label="Coverage" value={item.coverage} />
        {startedLabel && <Row label="Started" value={startedLabel} />}
        {endedLabel && <Row label="Ended" value={endedLabel} />}
        {typeof item.actualMinutes === "number" && item.actualMinutes > 0 && (
          <Row label="Hours worked" value={fmtHrMin(item.actualMinutes)} />
        )}
        {typeof item.billedMinutes === "number" && item.billedMinutes > 0 && (
          <Row label="Hours billed" value={fmtHrMin(item.billedMinutes)} />
        )}
        <Row label="Completed" value={item.completedOn ?? "—"} />
        <Row label="Settlement" value={`₦${item.amount.toLocaleString("en-NG")}`} strong />
        <div className="text-[11.5px] text-muted-foreground mt-2 tabular-nums">{meta}</div>
      </div>

      {item.note && (
        <div className="mt-3 rounded-2xl bg-secondary/40 px-3.5 py-3">
          <div className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Notes
          </div>
          <div className="mt-1 text-[13px] text-foreground/80">{item.note}</div>
        </div>
      )}

      {showRating && (
        <div className="mt-4 rounded-2xl bg-secondary/40 px-3.5 py-3">
          <div className="text-[13px] font-medium">How was the experience with the doctor?</div>
          <div className="mt-3 flex items-center justify-between px-1">
            {[1, 2, 3, 4, 5].map((n) => {
              const active = n <= rating;
              return (
                <button
                  key={n}
                  onClick={() => setRating(n)}
                  className="p-1 transition-transform active:scale-90"
                  aria-label={`${n} star${n > 1 ? "s" : ""}`}
                >
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z"
                      fill={active ? "var(--color-presence)" : "transparent"}
                      stroke={active ? "var(--color-presence)" : "color-mix(in oklab, var(--color-foreground) 35%, transparent)"}
                      strokeWidth="1.6"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              );
            })}
          </div>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={2}
            placeholder="Optional feedback"
            className="mt-3 w-full resize-none rounded-xl bg-background/60 px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground/55"
          />
          <button
            disabled={!rating || submitting}
            onClick={async () => {
              if (!rating || submitting) return;
              setSubmitting(true);
              // Optimistically collapse the form so the user sees an
              // immediate response even before the parent finishes the
              // backend round-trip.
              setLocalSubmitted(rating);
              try {
                await onRate(item.id, rating, feedback);
              } finally {
                setSubmitting(false);
              }
            }}
            className="mt-3 h-10 w-full rounded-full bg-primary text-[13px] font-semibold text-primary-foreground disabled:opacity-40 active:opacity-90"
          >
            {submitting ? "Submitting…" : "Submit rating"}
          </button>
        </div>
      )}

      {!showRating && effectiveRating != null && (
        <div className="mt-3 text-[12.5px] text-muted-foreground">
          You rated this coverage {effectiveRating} / 5
        </div>
      )}

    </DismissSheet>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className={strong ? "text-[14px] font-semibold tabular-nums" : "text-[13px] font-medium"}>
        {value}
      </span>
    </div>
  );
}
