import { useEffect, useState } from "react";
import { DismissSheet } from "./DismissSheet";

export type EditableShift = {
  timing: string;
  duration: number;
  accommodation: boolean;
  note: string;
};

/**
 * Lightweight edit sheet — updates operational details WITHOUT restarting
 * dispatch or unassigning the doctor. Confirming surfaces a calm
 * "Doctor notified" pulse via the caller.
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
    const keys: (keyof EditableShift)[] = ["timing", "duration", "accommodation", "note"];
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

  return (
    <DismissSheet open={open} onDismiss={onDismiss}>
      <h3 className="text-[17px] font-semibold tracking-tight">Edit shift</h3>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        Doctor remains assigned. Updates send instantly.
      </p>

      <div className="mt-4 space-y-2.5">
        <Cell label="Timing">
          <input
            type="time"
            value={draft.timing}
            onChange={(e) => setDraft({ ...draft, timing: e.target.value })}
            className="bg-transparent text-[14px] font-medium outline-none"
          />
        </Cell>

        <Cell label="Duration">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setDraft({ ...draft, duration: Math.max(1, draft.duration - 1) })}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-elevated text-foreground/70 active:scale-95"
            >
              −
            </button>
            <span className="text-[14px] font-medium tabular-nums">
              {draft.duration} {draft.duration === 1 ? "day" : "days"}
            </span>
            <button
              onClick={() => setDraft({ ...draft, duration: Math.min(7, draft.duration + 1) })}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-elevated text-foreground/70 active:scale-95"
            >
              +
            </button>
          </div>
        </Cell>

        <button
          onClick={() => setDraft({ ...draft, accommodation: !draft.accommodation })}
          className="flex w-full items-center justify-between rounded-xl bg-secondary/60 px-3 py-2.5 text-left"
        >
          <span className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Accommodation
          </span>
          <span
            className="flex h-5 w-9 items-center rounded-full p-0.5 transition-colors"
            style={{
              background: draft.accommodation
                ? "var(--color-presence)"
                : "color-mix(in oklab, var(--color-foreground) 18%, transparent)",
            }}
          >
            <span
              className="h-4 w-4 rounded-full bg-background transition-transform"
              style={{ transform: draft.accommodation ? "translateX(16px)" : "translateX(0)" }}
            />
          </span>
        </button>

        <Cell label="Note">
          <textarea
            rows={2}
            value={draft.note}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            placeholder="Female doctor needed; accommodation available; Mon, Tue, Weds"
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
