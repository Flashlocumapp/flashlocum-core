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
