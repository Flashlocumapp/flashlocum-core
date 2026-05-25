import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { BottomTabs, TAB_BAR_HEIGHT } from "@/components/BottomTabs";
import { AnimatePresence, motion } from "framer-motion";
import { useLocation } from "@tanstack/react-router";
import { useImmersive } from "@/lib/immersion";
import { CoverDispatchPortal } from "@/features/cover/CoverDispatchPortal";
import { ensureDoctorSession } from "@/features/cover/dispatch";
import { ToastHost } from "@/components/ToastHost";
import { getRole } from "@/lib/role";

export const Route = createFileRoute("/_app")({
  component: AppShell,
});

function AppShell() {
  const { pathname } = useLocation();
  const immersive = useImmersive();
  useEffect(() => {
    if (getRole() === "cover") ensureDoctorSession(true);
  }, []);
  return (
    <div
      className="fixed inset-0 overflow-hidden bg-background"
      style={{ ["--tab-bar-h" as string]: immersive ? "0px" : `${TAB_BAR_HEIGHT}px` }}
    >
      <div
        className="absolute inset-x-0 top-0"
        style={{ bottom: `var(--tab-bar-h)` }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={pathname}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
            className="h-full w-full"
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
    </div>
  );
}
