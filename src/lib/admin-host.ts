// Detects whether the current browser is on the admin subdomain.
// The admin app is served from the SAME deployment as the user app —
// host routing is UX only; the real security boundary is `_admin/route`'s
// server-side `checkIsAdmin()` gate.
export const ADMIN_HOST = "admin.flashlocum.com";

export function isAdminHost(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hostname === ADMIN_HOST;
}
