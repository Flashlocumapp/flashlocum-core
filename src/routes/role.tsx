import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { motion } from "framer-motion";
import locumSvg from "@/assets/logo-locum.svg";
import flashSvg from "@/assets/logo-flash.svg";

export const Route = createFileRoute("/role")({
  component: RoleScreen,
});

function RoleScreen() {
  const search = useSearch({ from: "/role" }) as Record<string, unknown>;
  const resetSuccess = search.reset === "success";

  return (
    <main className="min-h-screen bg-background safe-top safe-bottom">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-6 pt-10 pb-8">
        <div className="flex items-center gap-1">
          <img src={flashSvg} alt="" className="logo-theme h-5 w-auto" />
          <img src={locumSvg} alt="FlashLocum" className="logo-theme h-5 w-auto" />
        </div>

        {resetSuccess && (
          <div className="mt-6 rounded-2xl bg-secondary px-4 py-3 text-[14px] text-foreground">
            Password updated successfully
          </div>
        )}

        <div className={resetSuccess ? "mt-8" : "mt-16"}>
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight">
            How will you use<br />FlashLocum?
          </h1>
          <p className="mt-3 text-[15px] text-muted-foreground">
            You can switch anytime from your profile.
          </p>
        </div>

        <div className="mt-10 space-y-3">
          <RoleCard
            to="/auth/request"
            title="Request Coverage"
            desc="Request temporary medical coverage for facilities, patients, or teams."
            delay={0.05}
          />
          <RoleCard
            to="/auth/cover"
            title="Cover & Earn"
            desc="Accept temporary medical coverage requests and earn."
            delay={0.12}
          />
        </div>

        <div className="mt-auto pt-10 text-center text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          FlashLocum · Realtime Coverage Network
        </div>
      </div>
    </main>
  );
}

function RoleCard({
  to, title, desc, delay,
}: { to: string; title: string; desc: string; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      <Link
        to={to}
        preload="render"
        className="block rounded-2xl bg-card p-5 transition-colors active:bg-accent"
        style={{ boxShadow: "0 1px 0 var(--color-hairline), 0 10px 30px -22px rgba(0,0,0,0.25)" }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[17px] font-semibold tracking-tight">{title}</div>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">{desc}</p>
          </div>
          <span className="mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M5 12h14M13 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
      </Link>
    </motion.div>
  );
}
