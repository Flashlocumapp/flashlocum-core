// Active operational role for the FlashLocum app shell.
// "request" = Request Coverage (requester side)
// "cover"   = Cover & Earn (doctor side)
export type Role = "request" | "cover";

const KEY = "flashlocum.role";

export function setRole(role: Role) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, role);
  } catch {
    /* noop */
  }
}

export function getRole(): Role {
  if (typeof window === "undefined") return "request";
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "cover" ? "cover" : "request";
  } catch {
    return "request";
  }
}

export function clearRole() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
