// FlashLocum pricing — frontend mirror of the SQL `compute_quote` engine.
//
// Server is authoritative (end_shift writes `total_billed_amount` to the
// row). This module exists only to render consistent quotes/estimates
// before the server amount is available. Numbers MUST match the backend.
//
// Spec:
//   Standard (per-shift bucket from total hours):
//     >= 6h   → day ₦2,000/hr  · night ₦1,500/hr
//     4–<6h  → day ₦2,500/hr  · night ₦2,000/hr
//     <4h    → day ₦3,000/hr  · night ₦2,500/hr
//   Day band 06:00–22:00, Night 22:00–06:00 (Africa/Lagos).
//   Fixed: single 24h shift → ₦36,000; single 48h block → ₦72,000.
//   Home Care: ₦15,000/hr (no day/night split).
//   Environment multiplier: Busy = ×1.25 (applied last, before fee split).
//   Minimum billable = 60 min. Worked minutes round UP to 15-min blocks.

export type CoverageKind = "standard" | "home";
export type Environment = "normal" | "busy";

const RATE_DAY_LONG = 2000;
const RATE_NIGHT_LONG = 1500;
const RATE_DAY_MID = 2500;
const RATE_NIGHT_MID = 2000;
const RATE_DAY_SHORT = 3000;
const RATE_NIGHT_SHORT = 2500;
const RATE_HOME = 15000;
const FLAT_24H = 36000;
const FLAT_48H = 72000;

export const BUSY_MULTIPLIER = 1.25;
export const MIN_BILLABLE_MINUTES = 60;

export function coverageKindFromLabel(label: string): CoverageKind {
  return label.toLowerCase().startsWith("home") ? "home" : "standard";
}

function minsFromHHMM(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Split a window into day vs night minutes using the 06–22 day band. */
function splitPerDayMinutes(startHHMM: string, endHHMM: string) {
  const start = minsFromHHMM(startHHMM);
  let end = minsFromHHMM(endHHMM);
  if (end === start) end += 24 * 60;
  if (end < start) end += 24 * 60;
  let day = 0;
  let night = 0;
  for (let t = start; t < end; t++) {
    const h = Math.floor((t % (24 * 60)) / 60);
    if (h >= 6 && h < 22) day++;
    else night++;
  }
  return { dayMinutes: day, nightMinutes: night };
}

export type PricingResult = { amount: number; explanation: string };

function applyEnvironment(amount: number, env: Environment): number {
  return env === "busy" ? Math.round(amount * BUSY_MULTIPLIER) : Math.round(amount);
}

function envSuffix(env: Environment): string {
  return env === "busy" ? " · Busy ×1.25" : "";
}

function bucketRates(perDayHrs: number) {
  if (perDayHrs >= 6) return { day: RATE_DAY_LONG, night: RATE_NIGHT_LONG, label: "6h+" };
  if (perDayHrs >= 4) return { day: RATE_DAY_MID, night: RATE_NIGHT_MID, label: "4–6h" };
  return { day: RATE_DAY_SHORT, night: RATE_NIGHT_SHORT, label: "<4h" };
}

function priceStandard(
  totalDayMin: number,
  totalNightMin: number,
  perDayHrs: number,
  env: Environment,
): PricingResult {
  const { day: rd, night: rn } = bucketRates(perDayHrs);
  const dayHours = totalDayMin / 60;
  const nightHours = totalNightMin / 60;
  const base = dayHours * rd + nightHours * rn;
  const amount = applyEnvironment(base, env);
  const parts: string[] = [];
  if (dayHours > 0) parts.push(`${trim(dayHours)}h day · ₦${rd.toLocaleString("en-NG")}/hr`);
  if (nightHours > 0)
    parts.push(`${trim(nightHours)}h night · ₦${rn.toLocaleString("en-NG")}/hr`);
  return {
    amount,
    explanation: (parts.join(" + ") || "Standard coverage rate.") + envSuffix(env),
  };
}

/** Booked-window quote. */
export function computeCoveragePricing(
  coverage: CoverageKind,
  startHHMM: string,
  endHHMM: string,
  days: number = 1,
  environment: Environment = "normal",
): PricingResult {
  const d = Math.max(1, Math.round(days));
  const perDay = splitPerDayMinutes(startHHMM, endHHMM);
  const perDayHrs = (perDay.dayMinutes + perDay.nightMinutes) / 60;
  const totalDayMin = perDay.dayMinutes * d;
  const totalNightMin = perDay.nightMinutes * d;
  const totalHrs = (totalDayMin + totalNightMin) / 60;

  if (coverage === "home") {
    const base = totalHrs * RATE_HOME;
    return {
      amount: applyEnvironment(base, environment),
      explanation:
        `Home Care · ₦${RATE_HOME.toLocaleString("en-NG")}/hr in-home coverage.` +
        envSuffix(environment),
    };
  }

  if (d === 1 && Math.round(totalHrs) === 24) {
    return {
      amount: applyEnvironment(FLAT_24H, environment),
      explanation:
        `Continuous 24-hour coverage · flat ₦${FLAT_24H.toLocaleString("en-NG")}.` +
        envSuffix(environment),
    };
  }
  if (Math.round(totalHrs) === 48) {
    return {
      amount: applyEnvironment(FLAT_48H, environment),
      explanation:
        `48-hour block · flat ₦${FLAT_48H.toLocaleString("en-NG")}.` + envSuffix(environment),
    };
  }

  return priceStandard(totalDayMin, totalNightMin, perDayHrs, environment);
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Worked minutes → 15-min ceiling, min 60. */
export function roundedOverrunMinutes(workedMin: number): number {
  const total = Math.max(0, Math.floor(workedMin));
  return Math.ceil(total / 15) * 15;
}
export function billableMinutes(workedMin: number): number {
  if (!Number.isFinite(workedMin) || workedMin <= 0) return 0;
  return Math.max(MIN_BILLABLE_MINUTES, roundedOverrunMinutes(workedMin));
}

/** Live billing during/after a shift, based on real worked minutes. */
export function computeWorkedPricing(
  coverage: CoverageKind,
  startHHMM: string,
  workedMinutes: number,
  endHHMM?: string,
  days: number = 1,
  environment: Environment = "normal",
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
      if (h >= 6 && h < 22) day++;
      else night++;
    }
  }
  const totalHrs = worked / 60;

  if (coverage === "home") {
    const base = totalHrs * RATE_HOME;
    return {
      amount: applyEnvironment(base, environment),
      explanation:
        `Home Care · ₦${RATE_HOME.toLocaleString("en-NG")}/hr.` + envSuffix(environment),
    };
  }
  if (d === 1 && Math.round(totalHrs) === 24) {
    return {
      amount: applyEnvironment(FLAT_24H, environment),
      explanation: `Continuous 24-hour coverage · flat ₦${FLAT_24H.toLocaleString("en-NG")}.` +
        envSuffix(environment),
    };
  }
  if (Math.round(totalHrs) === 48) {
    return {
      amount: applyEnvironment(FLAT_48H, environment),
      explanation: `48-hour block · flat ₦${FLAT_48H.toLocaleString("en-NG")}.` +
        envSuffix(environment),
    };
  }
  return priceStandard(day, night, perDayHrs, environment);
}
