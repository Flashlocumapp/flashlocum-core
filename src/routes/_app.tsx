import { createFileRoute, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { BottomTabs, TAB_BAR_HEIGHT } from "@/components/BottomTabs";
import { AnimatePresence, motion } from "framer-motion";

import { useImmersive } from "@/lib/immersion";
import { CoverDispatchPortal } from "@/features/cover/CoverDispatchPortal";
import { ensureDoctorSession } from "@/features/cover/dispatch";
import { ToastHost } from "@/components/ToastHost";
import { SimClockPanel } from "@/components/SimClockPanel";
import { clearRole, getRole, hasRole, setRole } from "@/lib/role";
import {
  effectiveOnboardedRole,
  fetchMyProfile,
  getCachedOnboardingStatus,
  getCachedProfile,
  isAccountOnboardedProfile,
  touchLastSeen,
} from "@/lib/profile-remote";
import { HomeRouter } from "@/features/app/HomeRouter";
import { CoverageScreen } from "@/features/app/CoverageScreen";
import { EarningsScreen } from "@/features/app/EarningsScreen";
import { AccountScreen } from "@/features/app/AccountScreen";
import { ensureAuthReady, getAuthSnapshot, subscribeAuthState } from "@/lib/auth-ready";

export const Route = createFileRoute("/_app")({
  component: AppShell,
});

function AppShell() {
  const immersive = useImmersive();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // Hydrate ready from the persisted onboarding cache so returning users
  // do NOT see a blank shell while the backend re-validates the session.
  // The shell stays mounted; check() runs in the background and only
  // redirects on hard failures (no session, missing onboarding, etc.).
  const [ready, setReady] = useState(() => {
    if (typeof window === "undefined" || !hasRole()) return false;
    const auth = getAuthSnapshot();
    return auth.ready && !!auth.verifiedAt && !!auth.session && getCachedOnboardingStatus(getRole()) === true;
  });

  const check = async () => {
    const auth = await ensureAuthReady();
    if (!auth.session) {
      clearRole();
      navigate({ to: "/role" });
      return;
    }
    if (!auth.user?.email_confirmed_at) {
      const role = getRole() ?? "request";
      navigate({ to: "/auth/$role", params: { role } });
      return;
    }
    let role = hasRole() ? getRole() : null;
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
      if (!eff) {
        navigate({ to: "/role" });
        return;
      }
      setRole(eff);
      role = eff;
    }
    // Backend is the source of truth for onboarding completion. Enforce
    // here so Back-button or direct URL access cannot bypass onboarding.
    const cachedOnboarded = getCachedOnboardingStatus(role);
    let onboarded = cachedOnboarded === true;
    if (!onboarded) {
      const profile = await fetchMyProfile();
      // Account-wide: if any role is onboarded, the account counts as
      // onboarded. Switch the active role to one the user has actually
      // onboarded for so the app shell renders the right surface instead
      // of bouncing them into onboarding for an unrelated role.
      if (isAccountOnboardedProfile(profile)) {
        const eff = effectiveOnboardedRole(profile, role) ?? role;
        if (eff !== role) setRole(eff);
        onboarded = true;
      }
    }
    if (!onboarded) {
      const fromRole = getRole();
      navigate({
        to: "/onboarding/$role",
        params: { role: fromRole },
        search: { from: "auth" },
      });
      return;
    }
    if (getRole() === "cover") ensureDoctorSession(false);
    void touchLastSeen(true);
    setReady(true);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await check();
      if (cancelled) return;
    })();

    const offAuth = subscribeAuthState(({ event, session }) => {
      // Cold starts can briefly emit a no-session initialization/refresh state
      // before storage restoration settles. Only an explicit sign-out should
      // clear the operational role and bounce the user out of the app shell.
      if (event === "SIGNED_OUT" && !session) {
        clearRole();
        navigate({ to: "/role" });
      }
    });
    const heartbeat = window.setInterval(() => {
      void touchLastSeen();
    }, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void touchLastSeen(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      offAuth();
      window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  if (!ready) return <div className="h-full w-full bg-background" />;
  return (
    <div
      className="fixed inset-0 overflow-hidden bg-background"
      style={{ ["--tab-bar-h" as string]: immersive ? "0px" : `${TAB_BAR_HEIGHT}px` }}
    >
      <div
        className="absolute inset-x-0 top-0 bg-background"
        style={{ bottom: `var(--tab-bar-h)` }}
      >
        <PersistentTabSurface active={pathname === "/home"}>
          <HomeRouter active={pathname === "/home"} />
        </PersistentTabSurface>
        <PersistentTabSurface active={pathname === "/coverage"}>
          <CoverageScreen />
        </PersistentTabSurface>
        <PersistentTabSurface active={pathname === "/earnings"}>
          <EarningsScreen active={pathname === "/earnings"} />
        </PersistentTabSurface>
        <PersistentTabSurface active={pathname === "/account"}>
          <AccountScreen />
        </PersistentTabSurface>
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

function PersistentTabSurface({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <div
      aria-hidden={!active}
      className="absolute inset-0 bg-background"
      style={{
        pointerEvents: active ? "auto" : "none",
        zIndex: active ? 4 : 1,
      }}
    >
      {children}
    </div>
  );
}
