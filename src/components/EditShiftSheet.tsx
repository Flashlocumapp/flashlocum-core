import { useEffect, useState } from "react";
import { DismissSheet } from "./DismissSheet";
import { fmtAmPm } from "@/lib/format";

export type EditableShift = {
  /** "HH:MM" 24h */
  startTime: string;
  /** "HH:MM" 24h */
  endTime: string;
  note: string;
};

function computeHours(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return 0;
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60;
  return Math.round(mins / 60);
}

/**
 * Lightweight edit sheet — Start Time / End Time / Note. Duration and
 * pricing are derived automatically by the caller. Doctor remains assigned;
 * confirming surfaces a calm "Doctor notified" pulse via the caller.
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

  const diff = (): (keyof EditableShift)[] => {
    const keys: (keyof EditableShift)[] = ["startTime", "endTime", "note"];
    return keys.filter((k) => draft[k] !== initial[k]);
  };

  const handleSave = () => {
    const changed = diff();
    if (changed.length === 0) {
      onDismiss();
      return;
    }
    onSave(draft, changed.length === 1 ? changed[0] : "multiple");
  };

  const hrs = computeHours(draft.startTime, draft.endTime);

  return (
    <DismissSheet open={open} onDismiss={onDismiss}>
      <h3 className="text-[17px] font-semibold tracking-tight">Edit shift</h3>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        Doctor remains assigned. Coverage length and pricing update automatically.
      </p>

      <div className="mt-4 space-y-2.5">
        <div className="grid grid-cols-2 gap-2.5">
          <Cell label="Start time">
            <input
              type="time"
              value={draft.startTime}
              onChange={(e) => setDraft({ ...draft, startTime: e.target.value })}
              className="bg-transparent text-[14px] font-medium outline-none"
            />
            <span className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
              {fmtAmPm(draft.startTime)}
            </span>
          </Cell>
          <Cell label="End time">
            <input
              type="time"
              value={draft.endTime}
              onChange={(e) => setDraft({ ...draft, endTime: e.target.value })}
              className="bg-transparent text-[14px] font-medium outline-none"
            />
            <span className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
              {fmtAmPm(draft.endTime)}
            </span>
          </Cell>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-secondary/40 px-3 py-2">
          <span className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Coverage length
          </span>
          <span className="text-[13px] font-medium tabular-nums">{hrs} hr</span>
        </div>

        <Cell label="Note">
          <textarea
            rows={2}
            value={draft.note}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            placeholder="Female doctor needed; Mon, Tue, Weds"
            className="resize-none bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground/55"
          />
        </Cell>
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

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 rounded-xl bg-secondary/60 px-3 py-2">
      <span className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
