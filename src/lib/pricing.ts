// FlashLocum pricing — frontend mirror of the SQL `compute_quote` / `end_shift`
// engines. The server is authoritative (end_shift writes `total_billed_amount`
// to the row); this module exists only to render consistent quotes/estimates
// before the server amount is available. Numbers MUST match the backend.
//
// Strict ordered pipeline (mirrors SQL exactly):
//   STEP 1  read inputs
//   STEP 2  resolve coverage product (early-exit for 24h / 48h Straight)
//   STEP 3  TIER from booked_min ONLY (never from worked, never from billable)
//   STEP 4  RATE from tier + environment (frozen)
//   STEP 5a First-Hour Rule (worked < 60 → 60)
//   STEP 5b ±15-min Tolerance — applied BEFORE any rounding
//   STEP 5c 15-min CEILING rounding — only if 5b did NOT fire
//   STEP 6  day/night split of billable
//   STEP 7  amount from frozen rate
//
// Rate table:
//   <4h   tier  → day ₦3,000  · night ₦2,500
//   4-6h  tier  → day ₦2,500  · night ₦2,000
//   >6h   tier  → day ₦2,000  · night ₦1,500
//   Home Care   → ₦15,000/hr flat (no busy multiplier, no day/night)
//   Busy ×1.25 applies to Standard tiers only.
//   Straight 24h → ₦36,000 (₦45,000 busy); Straight 48h → ₦72,000 (₦90,000 busy).

export type CoverageKind = "standard" | "home" | "straight24" | "straight48";
export type Environment = "normal" | "busy";

const RATE_HOME = 15000;
const FLAT_24H = 36000;
const FLAT_48H = 72000;

export const BUSY_MULTIPLIER = 1.25;
export const MIN_BILLABLE_MINUTES = 60;

export function coverageKindFromLabel(label: string): CoverageKind {
  const s = (label ?? "").trim().toLowerCase();
  if (s.startsWith("home")) return "home";
  if (s.startsWith("24")) return "straight24";
  if (s.startsWith("weekend")) return "straight48";
  return "standard";
}

function minsFromHHMM(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Per-day booked minutes from start/end HH:MM (handles overnight). */
export function bookedMinutesFromWindow(startHHMM: string, endHHMM: string): number {
  const start = minsFromHHMM(startHHMM);
  let end = minsFromHHMM(endHHMM);
  if (end === start) end += 24 * 60;
  if (end < start) end += 24 * 60;
  return Math.max(0, end - start);
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

export type PricingResult = {
  amount: number;
  billableMinutes: number;
  explanation: string;
};

function tierRates(bookedHr: number): { day: number; night: number; label: string } {
  if (bookedHr > 6) return { day: 2000, night: 1500, label: ">6h" };
  if (bookedHr >= 4) return { day: 2500, night: 2000, label: "4-6h" };
  return { day: 3000, night: 2500, label: "<4h" };
}

function envSuffix(env: Environment, product: "standard" | "home"): string {
  return env === "busy" && product === "standard" ? " · Busy ×1.25" : "";
}

/** Booked-window quote (no worked input). */
export function computeCoveragePricing(
  coverage: CoverageKind,
  startHHMM: string,
  endHHMM: string,
  days: number = 1,
  environment: Environment = "normal",
): PricingResult {
  const d = Math.max(1, Math.round(days));
  const perDay = splitPerDayMinutes(startHHMM, endHHMM);
  const perDayMin = perDay.dayMinutes + perDay.nightMinutes;
  const totalMin = perDayMin * d;
  const busyMult = environment === "busy" ? BUSY_MULTIPLIER : 1.0;

  // STEP 2: product early-exit.
  if (coverage === "home") {
    const amount = Math.round((totalMin / 60) * RATE_HOME);
    return {
      amount,
      billableMinutes: totalMin,
      explanation: `Home Care · ₦${RATE_HOME.toLocaleString("en-NG")}/hr in-home coverage.`,
    };
  }
  if (coverage === "straight24" || (d === 1 && totalMin === 1440)) {
    return {
      amount: Math.round(FLAT_24H * busyMult),
      billableMinutes: 1440,
      explanation:
        `Continuous 24-hour coverage · flat ₦${FLAT_24H.toLocaleString("en-NG")}.` +
        envSuffix(environment, "standard"),
    };
  }
  if (coverage === "straight48" || totalMin === 2880) {
    return {
      amount: Math.round(FLAT_48H * busyMult),
      billableMinutes: 2880,
      explanation:
        `48-hour block · flat ₦${FLAT_48H.toLocaleString("en-NG")}.` +
        envSuffix(environment, "standard"),
    };
  }

  // STEPS 3–7 (booked == billable for a pure quote).
  const tier = tierRates(perDayMin / 60);
  const totalDay = perDay.dayMinutes * d;
  const totalNight = perDay.nightMinutes * d;
  const base = (totalDay / 60) * tier.day + (totalNight / 60) * tier.night;
  const amount = Math.round(base * busyMult);
  const parts: string[] = [];
  if (totalDay > 0) parts.push(`${trim(totalDay / 60)}h day · ₦${tier.day.toLocaleString("en-NG")}/hr`);
  if (totalNight > 0)
    parts.push(`${trim(totalNight / 60)}h night · ₦${tier.night.toLocaleString("en-NG")}/hr`);
  return {
    amount,
    billableMinutes: totalMin,
    explanation: (parts.join(" + ") || "Standard coverage rate.") + envSuffix(environment, "standard"),
  };
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Worked minutes → 15-min ceiling. */
export function roundedOverrunMinutes(workedMin: number): number {
  const total = Math.max(0, Math.floor(workedMin));
  return Math.ceil(total / 15) * 15;
}
/** Legacy helper: worked → 15-min ceiling with 60-min floor. Kept for UI only. */
export function billableMinutes(workedMin: number): number {
  if (!Number.isFinite(workedMin) || workedMin <= 0) return 0;
  return Math.max(MIN_BILLABLE_MINUTES, roundedOverrunMinutes(workedMin));
}

/**
 * Live billing during/after a shift, based on real worked minutes.
 * Follows the strict ordered pipeline; tier is derived from the booked
 * per-day window (`bookedMinutes`), NEVER from worked or billable.
 */
export function computeWorkedPricing(
  coverage: CoverageKind,
  startHHMM: string,
  workedMinutes: number,
  endHHMM?: string,
  days: number = 1,
  environment: Environment = "normal",
  bookedMinutesPerDay?: number,
): PricingResult {
  const worked = Math.max(0, Math.floor(workedMinutes));
  const d = Math.max(1, Math.round(days));
  const busyMult =
    environment === "busy" && coverage !== "home" ? BUSY_MULTIPLIER : 1.0;

  // Booked per-day window resolution.
  const bookedPerDay =
    bookedMinutesPerDay && bookedMinutesPerDay > 0
      ? Math.round(bookedMinutesPerDay)
      : endHHMM
        ? bookedMinutesFromWindow(startHHMM, endHHMM)
        : 0;

  // STEP 2: product early-exit.
  if (coverage === "straight24") {
    return {
      amount: Math.round(FLAT_24H * busyMult),
      billableMinutes: 1440,
      explanation:
        `Continuous 24-hour coverage · flat ₦${FLAT_24H.toLocaleString("en-NG")}.` +
        envSuffix(environment, "standard"),
    };
  }
  if (coverage === "straight48") {
    return {
      amount: Math.round(FLAT_48H * busyMult),
      billableMinutes: 2880,
      explanation:
        `48-hour block · flat ₦${FLAT_48H.toLocaleString("en-NG")}.` +
        envSuffix(environment, "standard"),
    };
  }

  // STEP 5a — First-Hour Rule
  let working = worked;
  if (working > 0 && working < 60) working = 60;

  // STEP 5b — ±15-min Tolerance (BEFORE rounding)
  let billable = 0;
  let toleranceFired = false;
  if (bookedPerDay > 0 && working > 0 && Math.abs(working - bookedPerDay) <= 15) {
    billable = bookedPerDay;
    toleranceFired = true;
  } else if (working > 0) {
    // STEP 5c — 15-min CEILING rounding
    billable = Math.ceil(working / 15) * 15;
  }

  if (coverage === "home") {
    const amount = Math.round((billable / 60) * RATE_HOME);
    return {
      amount,
      billableMinutes: billable,
      explanation: `Home Care · ₦${RATE_HOME.toLocaleString("en-NG")}/hr.`,
    };
  }

  // STEP 3: TIER from booked per-day duration ONLY.
  const tier = tierRates(
    bookedPerDay > 0 ? bookedPerDay / 60 : working / 60,
  );

  // STEP 6: day/night split of billable.
  let dayMin = 0;
  let nightMin = 0;
  if (billable > 0) {
    if (toleranceFired && endHHMM) {
      // Split derived from the booked window so the bill matches the anchor.
      const split = splitPerDayMinutes(startHHMM, endHHMM);
      const total = split.dayMinutes + split.nightMinutes || 1;
      dayMin = Math.round((billable * split.dayMinutes) / total);
      nightMin = billable - dayMin;
    } else if (d > 1 && endHHMM) {
      const split = splitPerDayMinutes(startHHMM, endHHMM);
      const total = split.dayMinutes + split.nightMinutes || 1;
      dayMin = Math.round((billable * split.dayMinutes) / total);
      nightMin = billable - dayMin;
    } else {
      // Walk minute-by-minute from start across the BILLABLE window.
      const start = minsFromHHMM(startHHMM);
      for (let i = 0; i < billable; i++) {
        const h = Math.floor(((start + i) % (24 * 60)) / 60);
        if (h >= 6 && h < 22) dayMin++;
        else nightMin++;
      }
    }
  }

  // STEP 7: amount from frozen rate.
  const base = (dayMin / 60) * tier.day + (nightMin / 60) * tier.night;
  const amount = Math.round(base * busyMult);

  const parts: string[] = [];
  if (dayMin > 0) parts.push(`${trim(dayMin / 60)}h day · ₦${tier.day.toLocaleString("en-NG")}/hr`);
  if (nightMin > 0) parts.push(`${trim(nightMin / 60)}h night · ₦${tier.night.toLocaleString("en-NG")}/hr`);
  return {
    amount,
    billableMinutes: billable,
    explanation: (parts.join(" + ") || "Standard coverage rate.") + envSuffix(environment, "standard"),
  };
}
