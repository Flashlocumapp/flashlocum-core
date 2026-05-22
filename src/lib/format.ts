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

export function fmtNairaK(n: number): string {
  if (n >= 1000) return "₦" + Math.round(n / 1000) + "K";
  return "₦" + n.toLocaleString("en-NG");
}

// Standard · Tue · 8:00 AM · ₦36K
export function fmtShiftMeta(
  coverage: string,
  schedule: string,
  amount: number,
): string {
  return `${coverage} · ${shortWeekdays(schedule)} · ${fmtNairaK(amount)}`;
}
