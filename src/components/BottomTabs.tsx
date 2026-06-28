import { Link, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion, LayoutGroup } from "framer-motion";
import { getRole, subscribeRoleChange, type Role } from "@/lib/role";
import { emitHaptic } from "@/lib/feedback";
import { springSnappy } from "@/lib/motion";

type TabTo = "/home" | "/coverage" | "/earnings" | "/account";
type Tab = {
  to: TabTo;
  label: string;
  icon: (active: boolean) => React.ReactNode;
};

// Icons render BOTH stroke weights stacked and cross-fade by opacity so the
// active/inactive transition is smooth instead of a binary swap.
function StackedIcon({
  active,
  paths,
}: {
  active: boolean;
  paths: { d: string; cap?: "round"; join?: "round" }[];
}) {
  const render = (weight: number, opacity: number) => (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      style={{
        position: "absolute",
        inset: 0,
        transition: "opacity 180ms ease",
        opacity,
      }}
    >
      {paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          stroke="currentColor"
          strokeWidth={weight}
          strokeLinecap={p.cap}
          strokeLinejoin={p.join}
        />
      ))}
    </svg>
  );
  return (
    <span style={{ position: "relative", width: 22, height: 22, display: "inline-block" }}>
      {render(1.6, active ? 0 : 1)}
      {render(2, active ? 1 : 0)}
    </span>
  );
}

const HOME: Tab = {
  to: "/home",
  label: "Home",
  icon: (a) => (
    <StackedIcon
      active={a}
      paths={[
        { d: "M3.5 11.5L12 4l8.5 7.5", cap: "round", join: "round" },
        {
          d: "M5.5 10.5V19a1 1 0 001 1h3.5v-5h4v5H17a1 1 0 001-1v-8.5",
          cap: "round",
          join: "round",
        },
      ]}
    />
  ),
};
const COVERAGE: Tab = {
  to: "/coverage",
  label: "Coverage",
  icon: (a) => (
    <span style={{ position: "relative", width: 22, height: 22, display: "inline-block" }}>
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        style={{
          position: "absolute",
          inset: 0,
          transition: "opacity 180ms ease",
          opacity: a ? 0 : 1,
        }}
      >
        <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth={1.6} />
        <path
          d="M12 7.5V12l3 2"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        style={{
          position: "absolute",
          inset: 0,
          transition: "opacity 180ms ease",
          opacity: a ? 1 : 0,
        }}
      >
        <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth={2} />
        <path
          d="M12 7.5V12l3 2"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  ),
};
const EARNINGS: Tab = {
  to: "/earnings",
  label: "Earnings",
  icon: (a) => (
    <StackedIcon
      active={a}
      paths={[
        { d: "M4 17l4-4 3 3 5-6 4 5", cap: "round", join: "round" },
        { d: "M4 20h16", cap: "round" },
      ]}
    />
  ),
};
const ACCOUNT: Tab = {
  to: "/account",
  label: "Account",
  icon: (a) => (
    <span style={{ position: "relative", width: 22, height: 22, display: "inline-block" }}>
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        style={{
          position: "absolute",
          inset: 0,
          transition: "opacity 180ms ease",
          opacity: a ? 0 : 1,
        }}
      >
        <circle cx="12" cy="9" r="3.5" stroke="currentColor" strokeWidth={1.6} />
        <path
          d="M5 19.5c1.5-3.2 4-4.8 7-4.8s5.5 1.6 7 4.8"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
        />
      </svg>
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        style={{
          position: "absolute",
          inset: 0,
          transition: "opacity 180ms ease",
          opacity: a ? 1 : 0,
        }}
      >
        <circle cx="12" cy="9" r="3.5" stroke="currentColor" strokeWidth={2} />
        <path
          d="M5 19.5c1.5-3.2 4-4.8 7-4.8s5.5 1.6 7 4.8"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
        />
      </svg>
    </span>
  ),
};

const REQUESTER_TABS: Tab[] = [HOME, COVERAGE, ACCOUNT];
const COVER_TABS: Tab[] = [HOME, COVERAGE, EARNINGS, ACCOUNT];

export function BottomTabs() {
  const { pathname } = useLocation();
  const [role, setLocalRole] = useState<Role | null>(() => getRole());
  useEffect(() => subscribeRoleChange(() => setLocalRole(getRole())), []);
  if (!role) return null;
  const tabs = role === "cover" ? COVER_TABS : REQUESTER_TABS;

  return (
    <nav
      aria-label="Primary"
      className="pointer-events-auto absolute inset-x-0 bottom-0 z-40"
      style={{
        background: "color-mix(in oklab, var(--color-surface-elevated) 92%, transparent)",
        backdropFilter: "saturate(140%) blur(18px)",
        WebkitBackdropFilter: "saturate(140%) blur(18px)",
        borderTop: "1px solid color-mix(in oklab, var(--color-foreground) 6%, transparent)",
        paddingBottom: "max(env(safe-area-inset-bottom), 6px)",
      }}
    >
      <LayoutGroup id="bottom-tabs">
        <ul className="mx-auto flex max-w-md items-stretch justify-around px-2 pt-1.5">
          {tabs.map((t) => {
            const active = pathname === t.to || pathname.startsWith(t.to + "/");
            return (
              <li key={t.to} className="flex-1">
                <Link
                  to={t.to}
                  preload="intent"
                  onPointerDown={() => emitHaptic("light")}
                  className="relative flex flex-col items-center gap-1 px-3 py-1.5 transition-transform duration-150 active:scale-[0.92] active:opacity-80"
                  style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                  draggable={false}
                >
                  <span
                    className="flex items-center justify-center"
                    style={{
                      color: active
                        ? "var(--color-foreground)"
                        : "color-mix(in oklab, var(--color-foreground) 42%, transparent)",
                      transition: "color 180ms ease",
                    }}
                  >
                    {t.icon(active)}
                  </span>
                  <span
                    className="text-[10.5px] font-medium tracking-[0.02em]"
                    style={{
                      color: active
                        ? "var(--color-foreground)"
                        : "color-mix(in oklab, var(--color-foreground) 48%, transparent)",
                      transition: "color 180ms ease",
                    }}
                  >
                    {t.label}
                  </span>
                  {active && (
                    <motion.span
                      layoutId="tab-indicator"
                      transition={springSnappy}
                      className="absolute -top-0.5 h-0.5 w-6 rounded-full"
                      style={{ background: "var(--color-foreground)" }}
                    />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </LayoutGroup>
    </nav>
  );
}

export const TAB_BAR_HEIGHT = 64;
