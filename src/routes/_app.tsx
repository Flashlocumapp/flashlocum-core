import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { BottomTabs, TAB_BAR_HEIGHT } from "@/components/BottomTabs";
import { AnimatePresence, motion } from "framer-motion";

import { useImmersive } from "@/lib/immersion";
import { CoverDispatchPortal } from "@/features/cover/CoverDispatchPortal";
import { ensureDoctorSession } from "@/features/cover/dispatch";
import { ToastHost } from "@/components/ToastHost";
import { SimClockPanel } from "@/components/SimClockPanel";
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

function AppShell() {
  const immersive = useImmersive();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    const heartbeat = window.setInterval(() => {
      void touchLastSeen();
    }, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void touchLastSeen(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return (
    <div
      className="fixed inset-0 overflow-hidden"
      style={{
        background: "var(--color-map)",
        ["--tab-bar-h" as string]: immersive ? "0px" : `${TAB_BAR_HEIGHT}px`,
      }}
    >
      {/* Persistent backdrop — matches map ground colour so any one-frame
          gap between unmounting tab A and mounting tab B never paints white. */}
      <div
        className="pointer-events-absolute absolute inset-x-0 top-0"
        style={{ bottom: `var(--tab-bar-h)`, background: "var(--color-map)" }}
        aria-hidden
      />
      <div
        className="absolute inset-x-0 top-0"
        style={{ bottom: `var(--tab-bar-h)` }}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={pathname}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0"
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
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
      <ToastHost />
      <SimClockPanel />
    </div>
  );
}
