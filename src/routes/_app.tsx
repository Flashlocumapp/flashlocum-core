import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { BottomTabs, TAB_BAR_HEIGHT } from "@/components/BottomTabs";
import { AnimatePresence, motion } from "framer-motion";
import { sheetEnter } from "@/lib/motion";

import { useImmersive } from "@/lib/immersion";
import { CoverDispatchPortal } from "@/features/cover/CoverDispatchPortal";
import { ensureDoctorSession } from "@/features/cover/dispatch";
import { HomeRouter } from "@/features/app/HomeRouter";
import { CoverageScreen } from "@/features/app/CoverageScreen";
import { AccountScreen } from "@/features/app/AccountScreen";
import { EarningsScreen } from "@/features/app/EarningsScreen";



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
import { mountPreshiftReminderScheduler } from "@/lib/preshift-reminder";

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

// Persistent tab paths. Each of these screens is mounted once on first
// visit and kept alive thereafter — tab switches just toggle visibility
// via CSS `display`. Scroll position, expanded cards, filter state, image
// decode state, realtime subscriptions, and the Google Map instance all
// survive switching between tabs and coming back. Sub-routes that aren't
// in this list (help, support, sub-pages) render through <Outlet /> on
// top of the hidden persistent layers and remount as normal.
const PERSISTENT_TAB_PATHS = ["/home", "/coverage", "/earnings", "/account"] as const;
type PersistentTabPath = (typeof PERSISTENT_TAB_PATHS)[number];

function AppShell() {
  const immersive = useImmersive();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const activeTab: PersistentTabPath | null = useMemo(() => {
    return (PERSISTENT_TAB_PATHS as readonly string[]).includes(pathname)
      ? (pathname as PersistentTabPath)
      : null;
  }, [pathname]);

  // Eager-mount every persistent tab on first AppShell mount. Off-screen
  // tabs are hidden via `display:none`, but their realtime subscriptions
  // and signed-URL warmups run in the background while Home is on screen,
  // so the first tap on Coverage / Earnings / Account is instant (no
  // cold-start skeleton or empty-state flash).
  useEffect(() => acquireHeartbeat(), []);
  useEffect(() => mountPreshiftReminderScheduler(), []);

  // Non-persistent routes (e.g. /help, /support, /admin children if rendered
  // here) display the Outlet on top of all hidden persistent layers.
  const showOutlet = activeTab === null;


  return (
    <div
      className="fixed inset-0 overflow-y-auto overflow-x-hidden"
      style={{
        background: "var(--color-background)",
        ["--tab-bar-h" as string]: immersive ? "0px" : `${TAB_BAR_HEIGHT}px`,
        WebkitOverflowScrolling: "touch",
        touchAction: "pan-y",
        overscrollBehavior: "contain",
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
        {/* Persistent Home layer. The map lives here and is never torn down. */}
        <PersistentLayer
          mounted={visitedRef.current.has("/home")}
          visible={activeTab === "/home"}
          scroll={false}
        >
          <HomeRouter active={activeTab === "/home"} />
        </PersistentLayer>

        {/* Persistent Coverage layer. */}
        <PersistentLayer
          mounted={visitedRef.current.has("/coverage")}
          visible={activeTab === "/coverage"}
          scroll
        >
          <CoverageScreen />
        </PersistentLayer>

        {/* Persistent Earnings layer (cover role only — the screen
            self-guards via role checks; mounting it for requesters is
            harmless because the route is gated above). */}
        <PersistentLayer
          mounted={visitedRef.current.has("/earnings")}
          visible={activeTab === "/earnings"}
          scroll
        >
          <EarningsScreen active={activeTab === "/earnings"} />
        </PersistentLayer>

        {/* Persistent Account layer. */}
        <PersistentLayer
          mounted={visitedRef.current.has("/account")}
          visible={activeTab === "/account"}
          scroll
        >
          <AccountScreen />
        </PersistentLayer>

        {/* Non-persistent routes render here on top. They remount as normal
            and the persistent layers below are hidden via display:none. */}
        <div
          className="absolute inset-0 overflow-y-auto overflow-x-hidden"
          style={{
            display: showOutlet ? "block" : "none",
            WebkitOverflowScrolling: "touch",
            touchAction: "pan-y",
            overscrollBehavior: "contain",
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
            transition={sheetEnter}
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

function PersistentLayer({
  mounted,
  visible,
  scroll,
  children,
}: {
  mounted: boolean;
  visible: boolean;
  scroll: boolean;
  children: React.ReactNode;
}) {
  if (!mounted) return null;
  return (
    <div
      className={
        scroll
          ? "absolute inset-0 overflow-y-auto overflow-x-hidden"
          : "absolute inset-0 overflow-hidden"
      }
      style={{
        display: visible ? "block" : "none",
        background: "var(--color-background)",
        WebkitOverflowScrolling: scroll ? "touch" : undefined,
        touchAction: scroll ? "pan-y" : undefined,
        overscrollBehavior: scroll ? "contain" : undefined,
      }}
      aria-hidden={!visible}
    >
      {children}
    </div>
  );
}

