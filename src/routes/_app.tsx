import { createFileRoute, Outlet } from "@tanstack/react-router";
import { BottomTabs, TAB_BAR_HEIGHT } from "@/components/BottomTabs";
import { AnimatePresence, motion } from "framer-motion";
import { useLocation } from "@tanstack/react-router";

export const Route = createFileRoute("/_app")({
  component: AppShell,
});

function AppShell() {
  const { pathname } = useLocation();
  return (
    <div
      className="fixed inset-0 overflow-hidden bg-background"
      style={{ ["--tab-bar-h" as string]: `${TAB_BAR_HEIGHT}px` }}
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
      <BottomTabs />
    </div>
  );
}
