// Operational formatting helpers — compressed scan-friendly card meta.

const WEEKDAY_SHORT: Record<string, string> = {
  Sunday: "Sun",
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Weds",
  Thursday: "Thu",
  Friday: "Fri",
  Saturday: "Sat",
};

export function shortWeekdays(s: string): string {
  let out = s;
  for (const [full, short] of Object.entries(WEEKDAY_SHORT)) {
    out = out.replace(new RegExp(`\\b${full}\\b`, "g"), short);
  }
  return out;
}

// Full monetary formatting globally — no K abbreviation.
export function fmtNairaK(n: number): string {
  return "₦" + n.toLocaleString("en-NG");
}
export const fmtNaira = fmtNairaK;

// Unified operational format:  Type · Day · Time · Duration · Amount
export function fmtShiftMeta(
  coverage: string,
  schedule: string,
  amount: number,
  durationHrs?: number,
): string {
  const dur = durationHrs ? ` · ${durationHrs}hr` : "";
  return `${coverage} · ${shortWeekdays(schedule)}${dur} · ${fmtNairaK(amount)}`;
}

// History meta:  Type · Date · Time · Duration · Amount
export function fmtHistoryMeta(
  coverage: string,
  completedOn: string,
  start: string,
  durationHrs: number,
  amount: number,
): string {
  return `${coverage} · ${shortWeekdays(completedOn)} · ${start} · ${durationHrs}hr · ${fmtNairaK(amount)}`;
}

// Live count-up timer label from a start timestamp.
export function fmtElapsed(fromMs: number, nowMs: number = Date.now()): string {
  const total = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
