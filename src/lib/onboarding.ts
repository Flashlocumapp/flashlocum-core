// Lightweight per-role onboarding tracking.
// MVP testing rule: NEVER hard-block users. We only track whether a role's
// onboarding has been visited so we can prompt on first-time switch.
import type { Role } from "@/lib/role";

const KEY = (r: Role) => `flashlocum.onboarded.${r}`;
const DATA_KEY = (r: Role) => `flashlocum.profile.${r}`;

export type RequesterProfile = {
  phone?: string;
  gender?: string;
};

export type DoctorProfile = {
  phone?: string;
  selfie?: string; // data url
  mdcn?: string;
  license?: string; // filename
  years?: string;
  bankName?: string;
  bankAccount?: string;
};

export function isOnboarded(role: Role): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY(role)) === "1";
  } catch {
    return false;
  }
}

export function markOnboarded(role: Role) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY(role), "1");
  } catch {
    /* noop */
  }
}

export function getProfile<T = RequesterProfile | DoctorProfile>(role: Role): T {
  if (typeof window === "undefined") return {} as T;
  try {
    const raw = window.localStorage.getItem(DATA_KEY(role));
    return raw ? (JSON.parse(raw) as T) : ({} as T);
  } catch {
    return {} as T;
  }
}

export function saveProfile(role: Role, data: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  try {
    const cur = getProfile<Record<string, unknown>>(role);
    window.localStorage.setItem(DATA_KEY(role), JSON.stringify({ ...cur, ...data }));
  } catch {
    /* noop */
  }
}
