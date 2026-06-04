// FlashLocum pricing engine — official operational rates.
//
// Standard coverage:
//   • Duration < 4 hrs           → flat ₦3,000/hr
//   • Duration 4–5 hrs           → flat ₦2,500/hr
//   • Duration ≥ 6 hrs           → split by real clock time:
//       Day   (08:00–22:00) → ₦2,000/hr
//       Night (22:00–08:00) → ₦1,500/hr
//   • Single-day 24-hour shift   → flat ₦36,000
//
// Home Care: flat ₦15,000/hr.
//
// Multi-day shifts repeat the booked daily window and inherit the same
// hourly bucket as the per-day duration — they never trigger the 24h flat.

export type CoverageKind = "standard" | "home";

const RATE_DAY = 2000;
const RATE_NIGHT = 1500;
const RATE_SHORT_45 = 2500;
const RATE_SHORT_LT4 = 3000;
const RATE_HOME = 15000;
const FLAT_24H = 36000;

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

export type PricingResult = { amount: number; explanation: string };

/**
 * Price a standard shift from total day/night minutes already accumulated.
 * Bucket is chosen from per-day duration so multi-day shifts inherit the
 * same hourly rate that the booked daily window qualifies for.
 */
function priceStandard(
  totalDayMin: number,
  totalNightMin: number,
  perDayHrs: number,
): PricingResult {
  const dayHours = totalDayMin / 60;
  const nightHours = totalNightMin / 60;
  const totalHrs = dayHours + nightHours;

  // Short shifts: single flat hourly rate, no day/night split.
  if (perDayHrs < 4) {
    return {
      amount: Math.round(totalHrs * RATE_SHORT_LT4),
      explanation: `${trim(totalHrs)}h · ₦${RATE_SHORT_LT4.toLocaleString("en-NG")}/hr`,
    };
  }
  if (perDayHrs < 6) {
    return {
      amount: Math.round(totalHrs * RATE_SHORT_45),
      explanation: `${trim(totalHrs)}h · ₦${RATE_SHORT_45.toLocaleString("en-NG")}/hr`,
    };
  }

  // Long shifts: split by real clock band.
  const amount = Math.round(dayHours * RATE_DAY + nightHours * RATE_NIGHT);
  const parts: string[] = [];
  if (dayHours > 0)
    parts.push(`${trim(dayHours)}h day · ₦${RATE_DAY.toLocaleString("en-NG")}/hr`);
  if (nightHours > 0)
    parts.push(`${trim(nightHours)}h night · ₦${RATE_NIGHT.toLocaleString("en-NG")}/hr`);
  return {
    amount,
    explanation: parts.join(" + ") || "Standard operational coverage rate.",
  };
}

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
  const perDayHrs = (perDay.dayMinutes + perDay.nightMinutes) / 60;
  const totalDayMin = perDay.dayMinutes * d;
  const totalNightMin = perDay.nightMinutes * d;
  const totalHrs = (totalDayMin + totalNightMin) / 60;

  if (coverage === "home") {
    return {
      amount: Math.round(totalHrs * RATE_HOME),
      explanation: `Home Care · ₦${RATE_HOME.toLocaleString("en-NG")}/hr for personal in-home coverage.`,
    };
  }

  // Single-day 24h flat override.
  if (d === 1 && Math.round(totalHrs) === 24) {
    return {
      amount: FLAT_24H,
      explanation: `Continuous 24-hour coverage · flat ₦${FLAT_24H.toLocaleString("en-NG")}.`,
    };
  }

  return priceStandard(totalDayMin, totalNightMin, perDayHrs);
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * 15-minute half-block billing expansion (unchanged operational rounding).
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
 * Operational minimum: once coverage starts, the first 15 minutes are
 * always billable. Beyond that, regular half-block rounding applies.
 */
export const MIN_BILLABLE_MINUTES = 15;
export function billableMinutes(workedMin: number): number {
  if (!Number.isFinite(workedMin) || workedMin <= 0) return 0;
  return Math.max(MIN_BILLABLE_MINUTES, roundedOverrunMinutes(workedMin));
}

/**
 * Compute pricing from a real worked duration starting at `startHHMM`.
 * Binds final billing to the LIVE Active Coverage timer across pause/resume
 * cycles. Pass `workedMinutes` already rounded by `roundedOverrunMinutes`.
 */
export function computeWorkedPricing(
  coverage: CoverageKind,
  startHHMM: string,
  workedMinutes: number,
  endHHMM?: string,
  days: number = 1,
): PricingResult {
  const worked = Math.max(0, Math.floor(workedMinutes));
  const d = Math.max(1, Math.round(days));
  let day = 0;
  let night = 0;
  let perDayHrs = worked / 60;

  if (d > 1 && endHHMM) {
    const perDay = splitPerDayMinutes(startHHMM, endHHMM);
    const totalPerDay = perDay.dayMinutes + perDay.nightMinutes || 1;
    perDayHrs = totalPerDay / 60;
    day = Math.round((worked * perDay.dayMinutes) / totalPerDay);
    night = worked - day;
  } else {
    const start = minsFromHHMM(startHHMM);
    for (let i = 0; i < worked; i++) {
      const h = Math.floor(((start + i) % (24 * 60)) / 60);
      if (h >= 8 && h < 22) day++;
      else night++;
    }
  }
  const totalHrs = worked / 60;

  if (coverage === "home") {
    return {
      amount: Math.round(totalHrs * RATE_HOME),
      explanation: `Home Care · ₦${RATE_HOME.toLocaleString("en-NG")}/hr for personal in-home coverage.`,
    };
  }
  if (d === 1 && Math.round(totalHrs) === 24) {
    return {
      amount: FLAT_24H,
      explanation: `Continuous 24-hour coverage · flat ₦${FLAT_24H.toLocaleString("en-NG")}.`,
    };
  }
  return priceStandard(day, night, perDayHrs);
}
