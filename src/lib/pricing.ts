// FlashLocum pricing engine.
//
// Rules (calm operational pricing — not payroll):
// - Standard coverage: split into daytime (8:00-22:00) vs nighttime (22:00-8:00)
//     • Daytime rate buckets (based on total daytime hours in the window):
//         ≤ 3 hrs → ₦5,000/hr
//         4-5 hrs → ₦4,000/hr
//         ≥ 6 hrs → ₦3,000/hr
//     • Nighttime: flat ₦2,000/hr
// - Home Care: flat ₦15,000/hr.
// - Continuous overrides (Standard only):
//     • Exactly 24 continuous hours → ₦50,000 flat
//     • Exactly 48 continuous hours → ₦100,000 flat

export type CoverageKind = "standard" | "home";

export function coverageKindFromLabel(label: string): CoverageKind {
  return label.toLowerCase().startsWith("home") ? "home" : "standard";
}

function splitDayNightMinutes(startTs: number, endTs: number) {
  let day = 0;
  let night = 0;
  for (let t = startTs; t < endTs; t += 60_000) {
    const h = new Date(t).getHours();
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

export function computeCoveragePricing(
  coverage: CoverageKind,
  startTs: number,
  endTs: number,
): PricingResult {
  const durHrs = Math.max(0, (endTs - startTs) / 3_600_000);

  if (coverage === "home") {
    return {
      amount: Math.round(durHrs * 15000),
      explanation: "Home Care · ₦15,000/hr for personal in-home coverage.",
    };
  }

  // Standard
  if (Math.round(durHrs) === 24) {
    return {
      amount: 50000,
      explanation: "Continuous 24-hour coverage · flat ₦50,000.",
    };
  }
  if (Math.round(durHrs) === 48) {
    return {
      amount: 100000,
      explanation: "Continuous 48-hour coverage · flat ₦100,000.",
    };
  }

  const { dayMinutes, nightMinutes } = splitDayNightMinutes(startTs, endTs);
  const dayHours = dayMinutes / 60;
  const nightHours = nightMinutes / 60;
  const dayRate = dayRateFor(dayHours);
  const amount = Math.round(dayHours * dayRate + nightHours * 2000);

  const parts: string[] = [];
  if (dayHours > 0) parts.push(`${trim(dayHours)}h day · ₦${dayRate.toLocaleString("en-NG")}/hr`);
  if (nightHours > 0) parts.push(`${trim(nightHours)}h night · ₦2,000/hr`);
  return {
    amount,
    explanation: parts.join(" + ") || "Standard operational coverage rate.",
  };
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
