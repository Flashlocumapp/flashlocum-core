// FlashLocum pricing engine.
//
// Rules (calm operational pricing — not payroll):
// - Night-rate ONLY applies to minutes whose real clock time falls inside
//   22:00 → 08:00. Multi-day shifts repeat the booked daily window; night
//   hours are only billed when the window actually overlaps the night band.
// - Standard daytime rate buckets (based on TOTAL daytime hours billed):
//     ≤ 3 hrs → ₦5,000/hr
//     4-5 hrs → ₦4,000/hr
//     ≥ 6 hrs → ₦3,000/hr
//   Nighttime: flat ₦2,000/hr.
// - Home Care: flat ₦15,000/hr.
// - Continuous overrides (Standard only):
//     Exactly 24h total → ₦50,000 flat
//     Exactly 48h total → ₦100,000 flat

export type CoverageKind = "standard" | "home";

export function coverageKindFromLabel(label: string): CoverageKind {
  return label.toLowerCase().startsWith("home") ? "home" : "standard";
}

function minsFromHHMM(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Split a single daily window (HH:MM → HH:MM, overnight allowed) into
 * day vs night minutes based on real clock-time overlap with 22:00–08:00.
 */
function splitPerDayMinutes(startHHMM: string, endHHMM: string) {
  const start = minsFromHHMM(startHHMM);
  let end = minsFromHHMM(endHHMM);
  if (end === start) end += 24 * 60; // exact 24h window
  if (end < start) end += 24 * 60; // overnight wrap
  let day = 0;
  let night = 0;
  for (let t = start; t < end; t++) {
    const h = Math.floor((t % (24 * 60)) / 60);
    if (h >= 8 && h < 22) day++;
    else night++;
  }
  return { dayMinutes: day, nightMinutes: night };
}

function dayRateFor(dayHours: number): number {
  if (dayHours <= 3) return 5000;
  if (dayHours <= 5) return 4000;
  return 3000;
}

export type PricingResult = { amount: number; explanation: string };

/**
 * Compute coverage pricing from a repeating daily window.
 * `days` is the number of times the window is booked (defaults to 1).
 */
export function computeCoveragePricing(
  coverage: CoverageKind,
  startHHMM: string,
  endHHMM: string,
  days: number = 1,
): PricingResult {
  const d = Math.max(1, Math.round(days));
  const perDay = splitPerDayMinutes(startHHMM, endHHMM);
  const totalDayMin = perDay.dayMinutes * d;
  const totalNightMin = perDay.nightMinutes * d;
  const totalHrs = (totalDayMin + totalNightMin) / 60;

  if (coverage === "home") {
    return {
      amount: Math.round(totalHrs * 15000),
      explanation: "Home Care · ₦15,000/hr for personal in-home coverage.",
    };
  }

  // Continuous overrides
  if (Math.round(totalHrs) === 24) {
    return {
      amount: 50000,
      explanation: "Continuous 24-hour coverage · flat ₦50,000.",
    };
  }
  if (Math.round(totalHrs) === 48) {
    return {
      amount: 100000,
      explanation: "Continuous 48-hour coverage · flat ₦100,000.",
    };
  }

  const dayHours = totalDayMin / 60;
  const nightHours = totalNightMin / 60;
  const dayRate = dayRateFor(dayHours);
  const amount = Math.round(dayHours * dayRate + nightHours * 2000);

  const parts: string[] = [];
  if (dayHours > 0)
    parts.push(`${trim(dayHours)}h day · ₦${dayRate.toLocaleString("en-NG")}/hr`);
  if (nightHours > 0)
    parts.push(`${trim(nightHours)}h night · ₦2,000/hr`);
  return {
    amount,
    explanation: parts.join(" + ") || "Standard operational coverage rate.",
  };
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * 15-minute half-block billing expansion.
 *
 * Each hour is split into two halves (0–30 and 31–60), and each half into
 * 15-min segments. Billing expands forward from the scheduled end:
 *
 *   First half (0–30):
 *     •  0–15 min → +0   (round down to hour mark)
 *     • 16–30 min → +15  (round down to :15)
 *   Second half (31–60):
 *     • 31–45 min → +45  (round up to :45)
 *     • 46–60 min → +60  (round up to next full hour)
 *
 * Beyond one hour, each completed full hour bills as +60 and the remainder
 * follows the same half-block table. Input/output are minutes.
 *
 * Used both for end-of-shift rounding and for re-evaluating billing when a
 * payment window lapses and coverage auto-resumes — the same rule keeps
 * expanding the billed block as simulated time advances.
 */
export function roundedOverrunMinutes(overrunMin: number): number {
  const total = Math.max(0, Math.floor(overrunMin));
  const fullHours = Math.floor(total / 60);
  const rem = total % 60;
  let extra = 0;
  if (rem <= 15) extra = 0;
  else if (rem <= 30) extra = 15;
  else if (rem <= 45) extra = 45;
  else extra = 60;
  return fullHours * 60 + extra;
}

/**
 * Compute pricing from a real worked duration starting at `startHHMM`.
 *
 * Walks forward minute-by-minute from the start clock time, classifying
 * each minute as day (08:00–22:00) or night, then applies the same
 * standard buckets and 24h/48h overrides as `computeCoveragePricing`.
 *
 * Used to bind final billing to the LIVE Active Coverage timer — the
 * scheduled end is irrelevant. Pass `workedMinutes` already rounded by
 * `roundedOverrunMinutes` for the calm 15-minute half-block behaviour.
 */
export function computeWorkedPricing(
  coverage: CoverageKind,
  startHHMM: string,
  workedMinutes: number,
): PricingResult {
  const worked = Math.max(0, Math.floor(workedMinutes));
  const start = minsFromHHMM(startHHMM);
  let day = 0;
  let night = 0;
  for (let i = 0; i < worked; i++) {
    const h = Math.floor(((start + i) % (24 * 60)) / 60);
    if (h >= 8 && h < 22) day++;
    else night++;
  }
  const totalHrs = worked / 60;

  if (coverage === "home") {
    return {
      amount: Math.round(totalHrs * 15000),
      explanation: "Home Care · ₦15,000/hr for personal in-home coverage.",
    };
  }
  if (Math.round(totalHrs) === 24) {
    return { amount: 50000, explanation: "Continuous 24-hour coverage · flat ₦50,000." };
  }
  if (Math.round(totalHrs) === 48) {
    return { amount: 100000, explanation: "Continuous 48-hour coverage · flat ₦100,000." };
  }
  const dayHours = day / 60;
  const nightHours = night / 60;
  const dayRate = dayRateFor(dayHours);
  const amount = Math.round(dayHours * dayRate + nightHours * 2000);
  const parts: string[] = [];
  if (dayHours > 0)
    parts.push(`${trim(dayHours)}h day · ₦${dayRate.toLocaleString("en-NG")}/hr`);
  if (nightHours > 0) parts.push(`${trim(nightHours)}h night · ₦2,000/hr`);
  return {
    amount,
    explanation: parts.join(" + ") || "Standard operational coverage rate.",
  };
}
