import { useEffect, useState } from "react";
import { DismissSheet } from "./DismissSheet";
import { TimeField12h } from "./TimeField12h";

export type EditableShift = {
  /** Start time "HH:MM" 24h */
  startTime: string;
  /** End time "HH:MM" 24h */
  endTime: string;
  /** Auto-calculated from start/end; overnight wraps to next day */
  durationHrs: number;
  note: string;
};

/** Hours between start and end (overnight wraps to next day). */
function calcDurationHrs(startHHMM: string, endHHMM: string): number {
  const [sh, sm] = startHHMM.split(":").map(Number);
  const [eh, em] = endHHMM.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return 1;
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60;
  return Math.max(1, Math.round(mins / 60));
}

/**
 * Lightweight edit sheet — updates operational details WITHOUT restarting
 * dispatch or unassigning the doctor. Coverage length is auto-derived from
 * start and end time; pricing is recomputed by the caller.
 */
export function EditShiftSheet({
  open,
  initial,
  onDismiss,
  onSave,
}: {
  open: boolean;
  initial: EditableShift;
  onDismiss: () => void;
  onSave: (next: EditableShift, changedField: keyof EditableShift | "multiple") => void;
}) {
  const [draft, setDraft] = useState<EditableShift>(initial);

  useEffect(() => {
    if (open) setDraft(initial);
  }, [open, initial]);

  // Always keep durationHrs in sync with start/end.
  const liveDuration = calcDurationHrs(draft.startTime, draft.endTime);

  const diff = (): (keyof EditableShift)[] => {
    const changed: (keyof EditableShift)[] = [];
    if (draft.startTime !== initial.startTime) changed.push("startTime");
    if (draft.endTime !== initial.endTime) changed.push("endTime");
    if (liveDuration !== initial.durationHrs) changed.push("durationHrs");
    if (draft.note !== initial.note) changed.push("note");
    return changed;
  };

  const handleSave = () => {
    const changed = diff();
    if (changed.length === 0) {
      onDismiss();
      return;
    }
    const next: EditableShift = { ...draft, durationHrs: liveDuration };
    // Prefer the most user-meaningful single change for the toast label.
    const primary = changed.find((c) => c === "startTime" || c === "endTime") ?? changed[0];
    onSave(next, changed.length === 1 ? primary : "multiple");
  };

  return (
    <DismissSheet open={open} onDismiss={onDismiss}>
      <h3 className="text-[17px] font-semibold tracking-tight">Edit shift</h3>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        Doctor remains assigned. Updates send instantly.
      </p>

      <div className="mt-4 space-y-2.5">
        <div className="grid grid-cols-2 gap-2.5">
          <TimeField12h
            label="Start time"
            value={draft.startTime}
            onChange={(v) => setDraft({ ...draft, startTime: v })}
          />
          <TimeField12h
            label="End time"
            value={draft.endTime}
            onChange={(v) => setDraft({ ...draft, endTime: v })}
          />
        </div>

        <div className="flex items-center justify-between rounded-xl bg-secondary/60 px-3 py-2.5">
          <span className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Coverage Length
          </span>
          <span className="text-[14px] font-medium tabular-nums">{liveDuration} hr</span>
        </div>

        <label className="flex flex-col gap-1 rounded-xl bg-secondary/60 px-3 py-2">
          <span className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Note
          </span>
          <textarea
            rows={2}
            value={draft.note}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            placeholder="Female doctor needed; accommodation available; Mon, Tue, Weds"
            className="resize-none bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground/55"
          />
        </label>
      </div>

      <button
        onClick={handleSave}
        className="mt-5 h-12 w-full rounded-full bg-primary text-[14px] font-semibold text-primary-foreground active:opacity-90"
      >
        Save & Notify Doctor
      </button>
    </DismissSheet>
  );
}
