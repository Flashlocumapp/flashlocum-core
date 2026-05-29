import { useState } from "react";
import { DismissSheet } from "./DismissSheet";
import { fmtNairaK, shortWeekdays } from "@/lib/format";

export type HistoryDetail = {
  id: string;
  doctor: string;
  mdcn: string;
  initials: string;
  coverage: string;
  completedOn?: string;
  amount: number;
  note?: string;
  rating?: number;
};

export function HistoryDetailSheet({
  open,
  item,
  onDismiss,
  onRate,
}: {
  open: boolean;
  item: HistoryDetail | null;
  onDismiss: () => void;
  onRate: (id: string, rating: number, feedback: string) => void;
}) {

  const [rating, setRating] = useState(item?.rating ?? 0);
  const [feedback, setFeedback] = useState("");

  if (!item) return null;

  const meta = `${item.coverage} · ${shortWeekdays(item.completedOn ?? "")} · ${fmtNairaK(item.amount)}`;
  const showRating = !item.rating;

  return (
    <DismissSheet open={open} onDismiss={onDismiss}>
      <div className="flex items-center gap-3">
        <span
          className="flex h-12 w-12 items-center justify-center rounded-full text-[14px] font-semibold"
          style={{ background: "var(--color-secondary)" }}
        >
          {item.initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-medium">{item.doctor}</div>
          <div className="text-[12px] text-muted-foreground">{item.mdcn}</div>
        </div>
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

      <div className="mt-4 rounded-2xl bg-secondary/50 px-3.5 py-3">
        <Row label="Coverage" value={item.coverage} />
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
            disabled={!rating}
            onClick={() => onRate(item.id, rating, feedback)}
            className="mt-3 h-10 w-full rounded-full bg-primary text-[13px] font-semibold text-primary-foreground disabled:opacity-40 active:opacity-90"
          >
            Submit rating
          </button>
        </div>
      )}

      {!showRating && item.rating && (
        <div className="mt-3 text-[12.5px] text-muted-foreground">
          You rated this coverage {item.rating} / 5
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
