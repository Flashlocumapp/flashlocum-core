// Single source of truth for post-acceptance cancellation reasons.
// Server validates the same code lists (see migration: validate_cancellation_reason).

export type CancellationActor = "requester" | "doctor";

export type CancellationReason = {
  code: string;
  label: string;
};

export const REQUESTER_REASONS: readonly CancellationReason[] = [
  { code: "no_longer_needed", label: "Shift no longer required" },
  { code: "schedule_changed", label: "Schedule changed internally" },
  { code: "wrong_details", label: "Wrong shift details entered" },
  { code: "found_alternative", label: "Found alternative cover" },
  { code: "other", label: "Other" },
] as const;

export const DOCTOR_REASONS: readonly CancellationReason[] = [
  { code: "personal_emergency", label: "Personal emergency" },
  { code: "illness", label: "Illness or health issue" },
  { code: "scheduling_conflict", label: "Scheduling conflict" },
  { code: "travel_issue", label: "Travel or transportation issue" },
  { code: "other", label: "Other" },
] as const;

export function reasonsFor(actor: CancellationActor): readonly CancellationReason[] {
  return actor === "doctor" ? DOCTOR_REASONS : REQUESTER_REASONS;
}

const ALL: Record<string, string> = Object.fromEntries(
  [...REQUESTER_REASONS, ...DOCTOR_REASONS].map((r) => [r.code, r.label]),
);

export function labelForCode(code: string | null | undefined): string {
  if (!code) return "—";
  return ALL[code] ?? code;
}
