// FlashLocum pricing — frontend mirror of the SQL `compute_quote` / `end_shift`
// engines. Rates are loaded from the DB-backed pricing_versions table at app
// boot; seed defaults match the v1 seed so synchronous estimates work even
// before the network fetch resolves. The server is always authoritative.
//
// Strict ordered pipeline (mirrors SQL exactly):
//   STEP 1  read inputs
//   STEP 2  resolve coverage product (early-exit for 24h / 48h Straight)
//   STEP 3  TIER from booked_min ONLY (never from worked, never from billable)
//   STEP 4  RATE from tier + environment (frozen)
//   STEP 5a First-Hour Rule (worked < first_hour_min → first_hour_min)
//   STEP 5b ±tolerance_min Tolerance — applied BEFORE any rounding
//   STEP 5c block_min CEILING rounding — only if 5b did NOT fire
//   STEP 6  day/night split of billable
//   STEP 7  amount from frozen rate

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
  };
};

// Seed defaults — must match the seeded v1 row in pricing_versions.
const SEED_TABLE: PricingTable = {
  versionId: null,
  rates: {
    "<4h": { day: 3000, night: 2500 },
    "4-6h": { day: 2500, night: 2000 },
    ">6h": { day: 2000, night: 1500 },
    home_flat: { day: 15000, night: 15000 },
  },
  flats: { straight_24h: 36000, straight_48h: 72000, home_hour: 15000 },
  modifiers: {
    busy_mult: 1.25,
    tolerance_min: 15,
    block_min: 15,
    first_hour_min: 60,
    home_busy_applies: false,
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
      if (m.key === "busy_mult") next.modifiers.busy_mult = Number(m.value);
      else if (m.key === "tolerance_min") next.modifiers.tolerance_min = Number(m.value);
      else if (m.key === "block_min") next.modifiers.block_min = Number(m.value);
      else if (m.key === "first_hour_min") next.modifiers.first_hour_min = Number(m.value);
      else if (m.key === "home_busy_applies") next.modifiers.home_busy_applies = Number(m.value) === 1;
    }
    CURRENT = next;
    listeners.forEach((fn) => fn(CURRENT));
    return CURRENT;
  } catch (e) {
    console.warn("[pricing] loadPricingTable failed:", (e as Error).message);
    return CURRENT;
  }
}

export const BUSY_MULTIPLIER = 1.25; // legacy export — UI strings only
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

function tierFor(bookedHr: number, table: PricingTable): { day: number; night: number; label: "<4h" | "4-6h" | ">6h" } {
  if (bookedHr > 6) return { ...table.rates[">6h"], label: ">6h" };
  if (bookedHr >= 4) return { ...table.rates["4-6h"], label: "4-6h" };
  return { ...table.rates["<4h"], label: "<4h" };
}

function envSuffix(env: Environment, product: "standard" | "home", mult: number): string {
  return env === "busy" && product === "standard" ? ` · Busy ×${mult}` : "";
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
  const totalMin = perDayMin * d;
  const busyMult = environment === "busy" ? t.modifiers.busy_mult : 1.0;
  const homeRate = t.rates.home_flat.day;

  if (coverage === "home") {
    const amount = Math.round((totalMin / 60) * homeRate);
    return {
      amount,
      billableMinutes: totalMin,
      explanation: `Home Care · ₦${homeRate.toLocaleString("en-NG")}/hr in-home coverage.`,
    };
  }
  if (coverage === "straight24" || (d === 1 && totalMin === 1440)) {
    return {
      amount: Math.round(t.flats.straight_24h * busyMult),
      billableMinutes: 1440,
      explanation:
        `Continuous 24-hour coverage · flat ₦${t.flats.straight_24h.toLocaleString("en-NG")}.` +
        envSuffix(environment, "standard", t.modifiers.busy_mult),
    };
  }
  if (coverage === "straight48" || totalMin === 2880) {
    return {
      amount: Math.round(t.flats.straight_48h * busyMult),
      billableMinutes: 2880,
      explanation:
        `48-hour block · flat ₦${t.flats.straight_48h.toLocaleString("en-NG")}.` +
        envSuffix(environment, "standard", t.modifiers.busy_mult),
    };
  }

  const tier = tierFor(perDayMin / 60, t);
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
    explanation: (parts.join(" + ") || "Standard coverage rate.") + envSuffix(environment, "standard", t.modifiers.busy_mult),
  };
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Worked minutes → block-min ceiling. */
export function roundedOverrunMinutes(workedMin: number): number {
  const block = CURRENT.modifiers.block_min;
  const total = Math.max(0, Math.floor(workedMin));
  return Math.ceil(total / block) * block;
}
export function billableMinutes(workedMin: number): number {
  if (!Number.isFinite(workedMin) || workedMin <= 0) return 0;
  return Math.max(CURRENT.modifiers.first_hour_min, roundedOverrunMinutes(workedMin));
}

export function computeWorkedPricing(
  coverage: CoverageKind,
  startHHMM: string,
  workedMinutes: number,
  endHHMM?: string,
  days: number = 1,
  environment: Environment = "normal",
  bookedMinutesPerDay?: number,
): PricingResult {
  const t = CURRENT;
  const worked = Math.max(0, Math.floor(workedMinutes));
  const d = Math.max(1, Math.round(days));
  const busyMult =
    environment === "busy" && (coverage !== "home" || t.modifiers.home_busy_applies)
      ? t.modifiers.busy_mult
      : 1.0;
  const homeRate = t.rates.home_flat.day;

  const bookedPerDay =
    bookedMinutesPerDay && bookedMinutesPerDay > 0
      ? Math.round(bookedMinutesPerDay)
      : endHHMM
        ? bookedMinutesFromWindow(startHHMM, endHHMM)
        : 0;

  if (coverage === "straight24") {
    return {
      amount: Math.round(t.flats.straight_24h * busyMult),
      billableMinutes: 1440,
      explanation:
        `Continuous 24-hour coverage · flat ₦${t.flats.straight_24h.toLocaleString("en-NG")}.` +
        envSuffix(environment, "standard", t.modifiers.busy_mult),
    };
  }
  if (coverage === "straight48") {
    return {
      amount: Math.round(t.flats.straight_48h * busyMult),
      billableMinutes: 2880,
      explanation:
        `48-hour block · flat ₦${t.flats.straight_48h.toLocaleString("en-NG")}.` +
        envSuffix(environment, "standard", t.modifiers.busy_mult),
    };
  }

  let working = worked;
  if (working > 0 && working < t.modifiers.first_hour_min) working = t.modifiers.first_hour_min;

  let billable = 0;
  let toleranceFired = false;
  if (bookedPerDay > 0 && working > 0 && Math.abs(working - bookedPerDay) <= t.modifiers.tolerance_min) {
    billable = bookedPerDay;
    toleranceFired = true;
  } else if (working > 0) {
    billable = Math.ceil(working / t.modifiers.block_min) * t.modifiers.block_min;
  }

  if (coverage === "home") {
    const amount = Math.round((billable / 60) * homeRate * busyMult);
    return {
      amount,
      billableMinutes: billable,
      explanation: `Home Care · ₦${homeRate.toLocaleString("en-NG")}/hr.`,
    };
  }

  const tier = tierFor(bookedPerDay > 0 ? bookedPerDay / 60 : working / 60, t);

  let dayMin = 0;
  let nightMin = 0;
  if (billable > 0) {
    if (toleranceFired && endHHMM) {
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
      const start = minsFromHHMM(startHHMM);
      for (let i = 0; i < billable; i++) {
        const h = Math.floor(((start + i) % (24 * 60)) / 60);
        if (h >= 6 && h < 22) dayMin++;
        else nightMin++;
      }
    }
  }

  const base = (dayMin / 60) * tier.day + (nightMin / 60) * tier.night;
  const amount = Math.round(base * busyMult);

  const parts: string[] = [];
  if (dayMin > 0) parts.push(`${trim(dayMin / 60)}h day · ₦${tier.day.toLocaleString("en-NG")}/hr`);
  if (nightMin > 0) parts.push(`${trim(nightMin / 60)}h night · ₦${tier.night.toLocaleString("en-NG")}/hr`);
  return {
    amount,
    billableMinutes: billable,
    explanation: (parts.join(" + ") || "Standard coverage rate.") + envSuffix(environment, "standard", t.modifiers.busy_mult),
  };
}
