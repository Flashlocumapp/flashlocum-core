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

/** Global operational meta:  Type · Day · Start - End · {n}hr · ₦Amount */
export function fmtOpMeta(
  coverage: string,
  day: string,
  start: string,
  end: string,
  durationHrs: number,
  amount: number,
): string {
  const timing = end && end !== start ? `${start} - ${end}` : start;
  return `${coverage} · ${shortWeekdays(day)} · ${timing} · ${durationHrs}hr · ${fmtNairaK(amount)}`;
}

/** Parse "8:00AM" / "10:30PM" / "08:00" → minutes since midnight. */
export function parseClock(t: string): number | null {
  if (!t) return null;
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = m[3]?.toUpperCase();
  if (ap === "PM" && h < 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

/** "Dr. Emmanuel Adeleke" → "Dr. Emmanuel A." */
export function shortDoctorName(full: string): string {
  if (!full) return full;
  const stripped = full.replace(/^Dr\.?\s+/i, "").trim();
  const parts = stripped.split(/\s+/);
  if (parts.length === 0) return full;
  const first = parts[0];
  const last = parts[parts.length - 1] ?? "";
  const initial = last ? last[0].toUpperCase() + "." : "";
  return `Dr. ${first}${initial ? " " + initial : ""}`.trim();
}

/** "HH:MM" 24h → "8:00AM" */
export function fmtAmPm(hhmm: string): string {
  if (!hhmm) return hhmm;
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  const hr = ((h + 11) % 12) + 1;
  return `${hr}:${String(m).padStart(2, "0")}${period}`;
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
