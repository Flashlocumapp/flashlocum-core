// Active operational role for the FlashLocum app shell.
// "request" = Request Coverage (requester side / Person A device)
// "cover"   = Cover & Earn (doctor side / Person B device)
//
// IMPORTANT: role is stored in sessionStorage, NOT localStorage.
// Each browser tab/window is an INDEPENDENT authenticated session, so two
// tabs can be logged in as two different roles at the same time and behave
// like two real devices. The shared dispatch engine in src/lib/network.ts
// is what synchronises them via BroadcastChannel + localStorage.
export type Role = "request" | "cover";

const KEY = "flashlocum.role";
const ROLE_EVENT = "flashlocum:role-change";

function notifyRoleChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ROLE_EVENT));
}

export function setRole(role: Role) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY, role);
    notifyRoleChange();
  } catch {
    /* noop */
  }
}

export function getRole(): Role {
  if (typeof window === "undefined") return "request";
  try {
    const v = window.sessionStorage.getItem(KEY);
    return v === "cover" ? "cover" : "request";
  } catch {
    return "request";
  }
}

export function hasRole(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const v = window.sessionStorage.getItem(KEY);
    return v === "cover" || v === "request";
  } catch {
    return false;
  }
}

export function clearRole() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(KEY);
    notifyRoleChange();
  } catch {
    /* noop */
  }
}

export function subscribeRoleChange(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(ROLE_EVENT, listener);
  return () => window.removeEventListener(ROLE_EVENT, listener);
}
