// FlashLocum pricing — frontend mirror of the SQL `compute_quote` / `end_shift`
// engines (v2). Rates are loaded from the DB-backed pricing tables at app
// boot; seed defaults match the v2 spec so estimates are correct before
// the network fetch resolves. The server is always authoritative.
//
// Spec rules implemented:
//   STANDARD     tier from booked per-day hours (<4h | 4-6h | >6h, locked);
//                two-sided 15-min grace; ceil to 15-min block; first-hour floor;
//                multi-day = each day priced independently and summed.
//   HOME CARE    ₦12,000/hr; 30-min grace; round up to next FULL HOUR.
//   STRAIGHT 24h flat ₦36,000 within 22h..25h; below → ₦1,500/hr (ceil hr);
//                above → flat + ₦1,500/extra-hour (ceil hr).
//   STRAIGHT 48h flat ₦72,000 within 46h..49h; same below/above math.
//   BUSY ×1.25   on Standard / Straight only; never Home Care.

import { supabase } from "@/integrations/supabase/client";

export type CoverageKind = "standard" | "home" | "straight24" | "straight48";
export type Environment = "normal" | "busy";

export type PricingTable = {
  versionId: string | null;
  rates: {
    "<4h": { day: number; night: number };
    "4-6h": { day: number; night: number };
    ">6h": { day: number; night: number };
    home_flat: { day: number; night: number };
  };
  flats: { straight_24h: number; straight_48h: number; home_hour: number };
  modifiers: {
    busy_mult: number;
    tolerance_min: number;
    block_min: number;
    first_hour_min: number;
    home_busy_applies: boolean;
    home_tolerance_min: number;
    home_block_min: number;
    straight24_lo_min: number;
    straight24_hi_min: number;
    straight48_lo_min: number;
    straight48_hi_min: number;
    straight_per_hour: number;
    surcharge_cap_blocks: number;
  };
};

const SEED_TABLE: PricingTable = {
  versionId: null,
  rates: {
    "<4h": { day: 3000, night: 2500 },
    "4-6h": { day: 2500, night: 2000 },
    ">6h": { day: 2000, night: 1500 },
    home_flat: { day: 12000, night: 12000 },
  },
  flats: { straight_24h: 36000, straight_48h: 72000, home_hour: 12000 },
  modifiers: {
    busy_mult: 1.25,
    tolerance_min: 15,
    block_min: 15,
    first_hour_min: 60,
    home_busy_applies: false,
    home_tolerance_min: 30,
    home_block_min: 60,
    straight24_lo_min: 1320,
    straight24_hi_min: 1500,
    straight48_lo_min: 2760,
    straight48_hi_min: 2940,
    straight_per_hour: 1500,
    surcharge_cap_blocks: 96,
  },
};

let CURRENT: PricingTable = SEED_TABLE;
const listeners = new Set<(t: PricingTable) => void>();

export function getPricingTable(): PricingTable {
  return CURRENT;
}

export function subscribePricingTable(fn: (t: PricingTable) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function loadPricingTable(): Promise<PricingTable> {
  try {
    const { data: ver } = await supabase
      .from("pricing_versions" as never)
      .select("id")
      .eq("is_active", true)
      .maybeSingle();
    const versionId = (ver as { id: string } | null)?.id ?? null;
    if (!versionId) return CURRENT;
    const [ratesRes, flatsRes, modsRes] = await Promise.all([
      supabase.from("pricing_rates" as never).select("tier, rate_day, rate_night").eq("version_id", versionId),
      supabase.from("pricing_flats" as never).select("product, amount").eq("version_id", versionId),
      supabase.from("pricing_modifiers" as never).select("key, value").eq("version_id", versionId),
    ]);
    const next: PricingTable = JSON.parse(JSON.stringify(SEED_TABLE));
    next.versionId = versionId;
    for (const r of (ratesRes.data ?? []) as Array<{ tier: keyof PricingTable["rates"]; rate_day: number; rate_night: number }>) {
      if (next.rates[r.tier]) next.rates[r.tier] = { day: r.rate_day, night: r.rate_night };
    }
    for (const f of (flatsRes.data ?? []) as Array<{ product: keyof PricingTable["flats"]; amount: number }>) {
      if (f.product in next.flats) next.flats[f.product] = f.amount;
    }
    for (const m of (modsRes.data ?? []) as Array<{ key: string; value: number }>) {
      const v = Number(m.value);
      switch (m.key) {
        case "busy_mult": next.modifiers.busy_mult = v; break;
        case "tolerance_min": next.modifiers.tolerance_min = v; break;
        case "block_min": next.modifiers.block_min = v; break;
        case "first_hour_min": next.modifiers.first_hour_min = v; break;
        case "home_busy_applies": next.modifiers.home_busy_applies = v === 1; break;
        case "home_tolerance_min": next.modifiers.home_tolerance_min = v; break;
        case "home_block_min": next.modifiers.home_block_min = v; break;
        case "straight24_lo_min": next.modifiers.straight24_lo_min = v; break;
        case "straight24_hi_min": next.modifiers.straight24_hi_min = v; break;
        case "straight48_lo_min": next.modifiers.straight48_lo_min = v; break;
        case "straight48_hi_min": next.modifiers.straight48_hi_min = v; break;
        case "straight_per_hour": next.modifiers.straight_per_hour = v; break;
        case "surcharge_cap_blocks": next.modifiers.surcharge_cap_blocks = v; break;
      }
    }
    CURRENT = next;
    listeners.forEach((fn) => fn(CURRENT));
    return CURRENT;
  } catch (e) {
    console.warn("[pricing] loadPricingTable failed:", (e as Error).message);
    return CURRENT;
  }
}

export const BUSY_MULTIPLIER = 1.25; // legacy UI string only
export const MIN_BILLABLE_MINUTES = 60;

export function coverageKindFromLabel(label: string): CoverageKind {
  const s = (label ?? "").trim().toLowerCase();
  if (s.startsWith("home")) return "home";
  if (s.startsWith("24")) return "straight24";
  if (s.startsWith("48") || s.startsWith("weekend")) return "straight48";
  return "standard";
}

function minsFromHHMM(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function bookedMinutesFromWindow(startHHMM: string, endHHMM: string): number {
  const start = minsFromHHMM(startHHMM);
  let end = minsFromHHMM(endHHMM);
  if (end === start) end += 24 * 60;
  if (end < start) end += 24 * 60;
  return Math.max(0, end - start);
}

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
  /**
   * User-friendly coverage label, e.g. "9-hour Single-Day Coverage" or
   * "24-hour Straight Coverage (Busy Environment)". Free of any pricing
   * arithmetic — safe to show in marketing/checkout surfaces.
   */
  displayLabel: string;
};

function friendlyCoverageLabel(
  coverage: CoverageKind,
  totalMin: number,
  days: number,
  environment: Environment,
): string {
  const hrs = Math.max(1, Math.round(totalMin / 60));
  const busy =
    environment === "busy" && coverage !== "home" ? " (Busy Environment)" : "";
  if (coverage === "home") return `${hrs}-hour Home Care Coverage`;
  if (coverage === "straight24") return `24-hour Straight Coverage${busy}`;
  if (coverage === "straight48") return `48-hour Straight Coverage${busy}`;
  const span = days > 1 ? "Multi-Day" : "Single-Day";
  return `${hrs}-hour ${span} Coverage${busy}`;
}

function tierFor(perDayHr: number, table: PricingTable): { day: number; night: number; label: "<4h" | "4-6h" | ">6h" } {
  if (perDayHr > 6) return { ...table.rates[">6h"], label: ">6h" };
  if (perDayHr >= 4) return { ...table.rates["4-6h"], label: "4-6h" };
  return { ...table.rates["<4h"], label: "<4h" };
}

function busySuffix(env: Environment, applies: boolean, mult: number): string {
  return env === "busy" && applies ? ` · Busy ×${mult}` : "";
}

/** Per-day price for a Standard shift: two-sided grace, first-hour, 15-min ceil. */
function priceStandardDay(
  bookedPerDayMin: number,
  workedMin: number,
  dayWin: number,
  nightWin: number,
  rateDay: number,
  rateNight: number,
  busyMult: number,
  toleranceMin: number,
  blockMin: number,
  firstHourMin: number,
): { billable: number; amount: number; toleranceFired: boolean } {
  let working = Math.max(0, Math.floor(workedMin));
  if (working < firstHourMin) working = firstHourMin;

  let bill: number;
  let fired = false;
  if (bookedPerDayMin > 0 && Math.abs(working - bookedPerDayMin) <= toleranceMin) {
    bill = bookedPerDayMin;
    fired = true;
  } else {
    bill = Math.ceil(working / blockMin) * blockMin;
  }
  const winTotal = dayWin + nightWin;
  let dBill = 0;
  let nBill = 0;
  if (winTotal > 0) {
    dBill = Math.round((bill * dayWin) / winTotal);
    nBill = bill - dBill;
  } else {
    dBill = bill;
  }
  const amount = Math.round(((dBill / 60) * rateDay + (nBill / 60) * rateNight) * busyMult);
  return { billable: bill, amount, toleranceFired: fired };
}

/**
 * Mirror of SQL `_effective_product`: upgrade a Standard booking whose
 * per-day window is exactly 24h (and days ∈ {1, 2}) to the matching
 * straight product. Three separate 8h shifts do NOT upgrade.
 */
export function effectiveCoverageKind(
  coverage: CoverageKind,
  perDayMin: number,
  days: number,
): CoverageKind {
  if (coverage !== "standard") return coverage;
  const d = Math.max(1, Math.round(days));
  if (perDayMin === 1440 && d === 1) return "straight24";
  if (perDayMin === 1440 && d === 2) return "straight48";
  return "standard";
}

/** Booked-window quote (no worked input). */
export function computeCoveragePricing(
  coverage: CoverageKind,
  startHHMM: string,
  endHHMM: string,
  days: number = 1,
  environment: Environment = "normal",
): PricingResult {
  const t = CURRENT;
  const d = Math.max(1, Math.round(days));
  const perDay = splitPerDayMinutes(startHHMM, endHHMM);
  const perDayMin = perDay.dayMinutes + perDay.nightMinutes;
  // Duration-aware upgrade so the quote matches what end_shift will charge.
  coverage = effectiveCoverageKind(coverage, perDayMin, d);
  const totalMin = perDayMin * d;
  const busyApplies = environment === "busy" && coverage !== "home";
  const busyMult = busyApplies ? t.modifiers.busy_mult : 1.0;
  const homeRate = t.flats.home_hour;

  const label = friendlyCoverageLabel(coverage, totalMin, d, environment);

  if (coverage === "home") {
    const amount = Math.round((totalMin / 60) * homeRate);
    return {
      amount,
      billableMinutes: totalMin,
      explanation: `Home Care · ₦${homeRate.toLocaleString("en-NG")}/hr.`,
      displayLabel: label,
    };
  }
  if (coverage === "straight24") {
    return {
      amount: Math.round(t.flats.straight_24h * busyMult),
      billableMinutes: 1440,
      explanation:
        `24-hour straight · flat ₦${t.flats.straight_24h.toLocaleString("en-NG")} (22h–25h window).` +
        busySuffix(environment, busyApplies, t.modifiers.busy_mult),
      displayLabel: label,
    };
  }
  if (coverage === "straight48") {
    return {
      amount: Math.round(t.flats.straight_48h * busyMult),
      billableMinutes: 2880,
      explanation:
        `48-hour straight · flat ₦${t.flats.straight_48h.toLocaleString("en-NG")} (46h–49h window).` +
        busySuffix(environment, busyApplies, t.modifiers.busy_mult),
      displayLabel: label,
    };
  }

  // Standard: per-day tier, day/night split, multi-day = sum of independent days.
  const tier = tierFor(perDayMin / 60, t);
  const dayMin = perDay.dayMinutes;
  const nightMin = perDay.nightMinutes;
  const perDayAmount = Math.round(((dayMin / 60) * tier.day + (nightMin / 60) * tier.night) * busyMult);
  const amount = perDayAmount * d;

  const parts: string[] = [];
  if (dayMin > 0) parts.push(`${trim(dayMin / 60)}h day · ₦${tier.day.toLocaleString("en-NG")}/hr`);
  if (nightMin > 0) parts.push(`${trim(nightMin / 60)}h night · ₦${tier.night.toLocaleString("en-NG")}/hr`);
  const perDayLabel = d > 1 ? ` × ${d} days` : "";
  return {
    amount,
    billableMinutes: totalMin,
    explanation: (parts.join(" + ") || "Standard coverage rate.") + perDayLabel + busySuffix(environment, busyApplies, t.modifiers.busy_mult),
    displayLabel: label,
  };
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Worked minutes → block-min ceiling (used by live estimators). */
export function roundedOverrunMinutes(workedMin: number): number {
  const block = CURRENT.modifiers.block_min;
  const total = Math.max(0, Math.floor(workedMin));
  return Math.ceil(total / block) * block;
}
export function billableMinutes(workedMin: number): number {
  const safe = Number.isFinite(workedMin) ? Math.max(0, Math.floor(workedMin)) : 0;
  return Math.max(CURRENT.modifiers.first_hour_min, roundedOverrunMinutes(safe));
}

/**
 * Worked-time estimator mirroring the SQL end_shift pipeline.
 *
 * `priorBilledAmount`: authoritative server-side sum of `billed_amount` for
 * already-closed segments. When provided (>= 0), it OVERRIDES the local
 * estimate of prior days — `worked` is treated as the CURRENT day only and
 * total = today + priorBilledAmount. Pass `undefined` (default) to fall
 * back to estimating prior days at booked length using the locked tier.
 */
export function computeWorkedPricing(
  coverage: CoverageKind,
  startHHMM: string,
  workedMinutes: number,
  endHHMM?: string,
  days: number = 1,
  environment: Environment = "normal",
  bookedMinutesPerDay?: number,
  priorBilledAmount?: number,
): PricingResult {
  const t = CURRENT;
  const worked = Math.max(0, Math.floor(workedMinutes));
  const d = Math.max(1, Math.round(days));

  const bookedPerDay =
    bookedMinutesPerDay && bookedMinutesPerDay > 0
      ? Math.round(bookedMinutesPerDay)
      : endHHMM
        ? bookedMinutesFromWindow(startHHMM, endHHMM)
        : 0;

  // Duration-aware upgrade so the live estimate matches what end_shift bills.
  coverage = effectiveCoverageKind(coverage, bookedPerDay, d);

  const busyApplies =
    environment === "busy" && (coverage !== "home" || t.modifiers.home_busy_applies);
  const busyMult = busyApplies ? t.modifiers.busy_mult : 1.0;

  // === STRAIGHT 24H ===
  if (coverage === "straight24") {
    const flat = t.flats.straight_24h;
    const lo = t.modifiers.straight24_lo_min;
    const hi = t.modifiers.straight24_hi_min;
    const perHr = t.modifiers.straight_per_hour;
    let amount: number;
    if (worked >= lo && worked <= hi) {
      amount = Math.round(flat * busyMult);
    } else if (worked < lo) {
      const hrs = Math.ceil(worked / 60);
      amount = Math.round(hrs * perHr * busyMult);
    } else {
      const extraHr = Math.ceil((worked - hi) / 60);
      amount = Math.round((flat + extraHr * perHr) * busyMult);
    }
    return {
      amount,
      billableMinutes: worked,
      explanation: `24-hour straight · ${trim(worked / 60)}h actual.` + busySuffix(environment, busyApplies, t.modifiers.busy_mult),
      displayLabel: friendlyCoverageLabel("straight24", 1440, 1, environment),
    };
  }

  // === STRAIGHT 48H ===
  if (coverage === "straight48") {
    const flat = t.flats.straight_48h;
    const lo = t.modifiers.straight48_lo_min;
    const hi = t.modifiers.straight48_hi_min;
    const perHr = t.modifiers.straight_per_hour;
    let amount: number;
    if (worked >= lo && worked <= hi) {
      amount = Math.round(flat * busyMult);
    } else if (worked < lo) {
      const hrs = Math.ceil(worked / 60);
      amount = Math.round(hrs * perHr * busyMult);
    } else {
      const extraHr = Math.ceil((worked - hi) / 60);
      amount = Math.round((flat + extraHr * perHr) * busyMult);
    }
    return {
      amount,
      billableMinutes: worked,
      explanation: `48-hour straight · ${trim(worked / 60)}h actual.` + busySuffix(environment, busyApplies, t.modifiers.busy_mult),
      displayLabel: friendlyCoverageLabel("straight48", 2880, 1, environment),
    };
  }

  // === HOME CARE === (per-day independent billing; `worked` represents the
  // current day. Prior days are estimated at booked length — Settlement re-reads
  // the authoritative per-day ledger from get_request_billing_state.)
  if (coverage === "home") {
    const homeRate = t.flats.home_hour;
    const homeTol = t.modifiers.home_tolerance_min;
    const homeBlock = t.modifiers.home_block_min;
    const priceHomeDay = (workedMin: number): number => {
      let w = Math.max(workedMin, t.modifiers.first_hour_min);
      let bill: number;
      if (bookedPerDay > 0 && Math.abs(w - bookedPerDay) <= homeTol) {
        bill = bookedPerDay;
      } else {
        bill = Math.ceil(w / homeBlock) * homeBlock;
      }
      return Math.round((bill / 60) * homeRate * busyMult);
    };
    const todayAmount = priceHomeDay(worked);
    const priorDaysAmount =
      typeof priorBilledAmount === "number" && priorBilledAmount >= 0
        ? priorBilledAmount
        : (d - 1) * priceHomeDay(bookedPerDay);
    return {
      amount: todayAmount + priorDaysAmount,
      billableMinutes: Math.ceil(worked / homeBlock) * homeBlock,
      explanation:
        `Home Care · ₦${homeRate.toLocaleString("en-NG")}/hr` +
        (d > 1 ? ` · ${d} days (per-day)` : "") +
        busySuffix(environment, busyApplies, t.modifiers.busy_mult),
      displayLabel: friendlyCoverageLabel("home", bookedPerDay * d, d, environment),
    };
  }

  // === STANDARD (per-day independent billing) ===
  // `worked` is the CURRENT day's worked minutes. Prior days estimated at
  // booked length using the LOCKED tier. Settlement re-reads the authoritative
  // per-day ledger from get_request_billing_state.days_breakdown.
  const tier = tierFor(bookedPerDay > 0 ? bookedPerDay / 60 : worked / 60, t);
  let dWin = 0;
  let nWin = 0;
  if (endHHMM) {
    const split = splitPerDayMinutes(startHHMM, endHHMM);
    dWin = split.dayMinutes;
    nWin = split.nightMinutes;
  } else {
    dWin = bookedPerDay;
  }

  const today = priceStandardDay(
    bookedPerDay,
    worked,
    dWin,
    nWin,
    tier.day,
    tier.night,
    busyMult,
    t.modifiers.tolerance_min,
    t.modifiers.block_min,
    t.modifiers.first_hour_min,
  );
  const priorDay = d > 1
    ? priceStandardDay(
        bookedPerDay,
        bookedPerDay,
        dWin,
        nWin,
        tier.day,
        tier.night,
        busyMult,
        t.modifiers.tolerance_min,
        t.modifiers.block_min,
        t.modifiers.first_hour_min,
      )
    : { billable: 0, amount: 0, toleranceFired: false };

  const priorAmount =
    typeof priorBilledAmount === "number" && priorBilledAmount >= 0
      ? priorBilledAmount
      : (d - 1) * priorDay.amount;
  const total = today.amount + priorAmount;
  const billable = today.billable + (d - 1) * priorDay.billable;

  const parts: string[] = [];
  if (dWin > 0) parts.push(`₦${tier.day.toLocaleString("en-NG")}/hr day`);
  if (nWin > 0) parts.push(`₦${tier.night.toLocaleString("en-NG")}/hr night`);
  return {
    amount: total,
    billableMinutes: billable,
    explanation:
      (parts.join(" + ") || "Standard coverage rate.") +
      (d > 1 ? ` · ${d} days (per-day)` : "") +
      busySuffix(environment, busyApplies, t.modifiers.busy_mult),
  };
}
