import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { BottomTabs, TAB_BAR_HEIGHT } from "@/components/BottomTabs";
import { AnimatePresence, motion } from "framer-motion";

import { useImmersive } from "@/lib/immersion";
import { CoverDispatchPortal } from "@/features/cover/CoverDispatchPortal";
import { ensureDoctorSession } from "@/features/cover/dispatch";
import { HomeRouter } from "@/features/app/HomeRouter";


import { RestrictionBanner } from "@/components/RestrictionBanner";
import { clearRole, getRole, hasRole, setRole, type Role } from "@/lib/role";
import {
  effectiveOnboardedRole,
  fetchMyProfile,
  getCachedOnboardingStatus,
  getCachedProfile,
  isAccountOnboardedProfile,
  touchLastSeen,
} from "@/lib/profile-remote";
import { ensureAuthReady } from "@/lib/auth-ready";

export const Route = createFileRoute("/_app")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const auth = await ensureAuthReady();
    if (!auth.session) {
      clearRole();
      throw redirect({ to: "/role", replace: true });
    }
    if (!auth.user?.email_confirmed_at) {
      const role = getRole();
      throw redirect(
        role
          ? { to: "/auth/$role", params: { role }, replace: true }
          : { to: "/role", replace: true },
      );
    }

    let role: Role | null = hasRole() ? getRole() : null;
    if (!role) {
      const cached = getCachedProfile();
      const cachedRole =
        cached?.id === auth.user.id && (cached.role === "cover" || cached.role === "request")
          ? cached.role
          : null;
      const cachedOnboardedRole =
        cachedRole ??
        (cached?.id === auth.user.id && getCachedOnboardingStatus("cover") === true
          ? "cover"
          : cached?.id === auth.user.id && getCachedOnboardingStatus("request") === true
            ? "request"
            : null);
      if (cachedOnboardedRole) {
        setRole(cachedOnboardedRole);
        role = cachedOnboardedRole;
      }
    }

    if (!role) {
      const profile = await fetchMyProfile();
      const eff = effectiveOnboardedRole(profile, "request");
      if (!eff) throw redirect({ to: "/role", replace: true });
      setRole(eff);
      role = eff;
    }

    const cachedOnboarded = getCachedOnboardingStatus(role);
    let onboarded = cachedOnboarded === true;
    if (!onboarded) {
      const profile = await fetchMyProfile();
      if (isAccountOnboardedProfile(profile)) {
        const eff = effectiveOnboardedRole(profile, role) ?? role;
        if (eff !== role) setRole(eff);
        role = eff;
        onboarded = true;
      }
    }
    if (!onboarded) {
      throw redirect({
        to: "/onboarding/$role",
        params: { role },
        search: { from: "auth" },
        replace: location.pathname !== "/home",
      });
    }

    if (role === "cover") ensureDoctorSession(false);
    void touchLastSeen(true);
    return { role };
  },
  component: AppShell,
});

// Module-level singleton heartbeat. Using a refcount + shared interval means
// React StrictMode double-mounts, HMR module reloads, and nested AppShell
// remounts can never produce more than one timer firing `touchLastSeen` per
// minute. Previously the interval lived inside useEffect — cleanup is correct
// in steady state, but during HMR the old module's interval can briefly
// overlap the new one, doubling DB writes.
let heartbeatRefcount = 0;
let heartbeatTimer: number | null = null;
let visibilityHandler: (() => void) | null = null;

function acquireHeartbeat(): () => void {
  heartbeatRefcount += 1;
  if (heartbeatRefcount === 1) {
    heartbeatTimer = window.setInterval(() => {
      void touchLastSeen();
    }, 60_000);
    visibilityHandler = () => {
      if (document.visibilityState === "visible") void touchLastSeen(true);
    };
    document.addEventListener("visibilitychange", visibilityHandler);
  }
  return () => {
    heartbeatRefcount = Math.max(0, heartbeatRefcount - 1);
    if (heartbeatRefcount === 0) {
      if (heartbeatTimer !== null) {
        window.clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (visibilityHandler) {
        document.removeEventListener("visibilitychange", visibilityHandler);
        visibilityHandler = null;
      }
    }
  };
}

function AppShell() {
  const immersive = useImmersive();
  // The Home tab content (map, search sheet) is mounted exactly once for
  // the lifetime of the session. Tab switches just toggle its visibility
  // via CSS `display`, so the Google Map instance, markers, camera state,
  // and watchPosition subscription all survive switching to Coverage /
  // Account and back. Without this, `<Outlet />` would unmount the map
  // every time the user touches another tab.
  const isHome = useRouterState({ select: (s) => s.location.pathname === "/home" });

  useEffect(() => acquireHeartbeat(), []);


  return (
    <div
      className="fixed inset-0 overflow-y-auto overflow-x-hidden"
      style={{
        background: "var(--color-background)",
        ["--tab-bar-h" as string]: immersive ? "0px" : `${TAB_BAR_HEIGHT}px`,
        WebkitOverflowScrolling: "touch",
        touchAction: "pan-y",
      }}
    >
      {/* Persistent backdrop matches body/page background so no lighter
          layer is exposed during route transitions. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0"
        style={{ bottom: `var(--tab-bar-h)`, background: "var(--color-background)" }}
        aria-hidden
      />
      <div
        className="absolute inset-x-0 top-0"
        style={{ bottom: `var(--tab-bar-h)`, paddingTop: "env(safe-area-inset-top)" }}
      >
        {/* Persistent Home layer — always mounted, visibility toggled by
            CSS so the map instance is never torn down on tab switch. */}
        <div
          className="absolute inset-0 overflow-hidden"
          style={{
            display: isHome ? "block" : "none",
            background: "var(--color-background)",
          }}
          aria-hidden={!isHome}
        >
          <HomeRouter active={isHome} />
        </div>
        {/* Non-home routes render here. On `/home` this stays empty (the
            route's component is `() => null`) so the persistent layer
            above is what the user sees. On other routes this covers the
            persistent layer naturally because the home layer is hidden. */}
        <div
          className="absolute inset-0 overflow-y-auto overflow-x-hidden"
          style={{
            display: isHome ? "none" : "block",
            WebkitOverflowScrolling: "touch",
            touchAction: "pan-y",
            background: "var(--color-background)",
          }}
        >
          <Outlet />
        </div>
      </div>

      <AnimatePresence>
        {!immersive && (
          <motion.div
            key="tabs"
            initial={{ y: 64, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 64, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            className="absolute inset-x-0 bottom-0"
          >
            <BottomTabs />
          </motion.div>
        )}
      </AnimatePresence>
      <CoverDispatchPortal />

      <RestrictionBanner />
    </div>
  );
}
