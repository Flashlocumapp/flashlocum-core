import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/_app/coverage")({
  component: CoverageScreen,
});

type CoverageItem = {
  id: string;
  facility: string;
  area: string;
  role: string;
  when: string;
  status: "active" | "upcoming" | "completed";
};

const ITEMS: CoverageItem[] = [
  { id: "c1", facility: "Evercare Hospital", area: "Lekki Phase 1", role: "General Practice", when: "Live · 02:14 in", status: "active" },
  { id: "c2", facility: "Lagoon Hospital", area: "Apapa", role: "Paediatrics", when: "Tomorrow · 08:00", status: "upcoming" },
  { id: "c3", facility: "Reddington", area: "Victoria Island", role: "Weekend Call", when: "Sat 22 · 18:00", status: "upcoming" },
  { id: "c4", facility: "St. Nicholas", area: "Lagos Island", role: "24-Hour", when: "Tue 18 · 9h", status: "completed" },
  { id: "c5", facility: "First Cardiology", area: "Ikoyi", role: "Standard", when: "Mon 17 · 6h", status: "completed" },
];

const TABS = [
  { id: "active", label: "Active" },
  { id: "upcoming", label: "Upcoming" },
  { id: "completed", label: "History" },
] as const;
type TabId = typeof TABS[number]["id"];

function CoverageScreen() {
  const [tab, setTab] = useState<TabId>("active");
  const filtered = ITEMS.filter((i) =>
    tab === "completed" ? i.status === "completed" : i.status === tab,
  );

  return (
    <section className="relative h-full w-full overflow-hidden bg-background">
      <header className="safe-top px-5 pt-4">
        <div className="mx-auto max-w-md">
          <h1 className="text-[26px] font-semibold tracking-tight">Coverage</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Your operational timeline
          </p>

          <div
            className="mt-4 flex gap-1 rounded-full p-1"
            style={{ background: "var(--color-secondary)" }}
          >
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className="flex-1 rounded-full py-2 text-[13px] font-medium transition-colors"
                  style={{
                    background: active ? "var(--color-surface-elevated)" : "transparent",
                    color: active
                      ? "var(--color-foreground)"
                      : "color-mix(in oklab, var(--color-foreground) 55%, transparent)",
                    boxShadow: active ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <div className="mx-auto mt-4 max-w-md overflow-y-auto px-5 pb-6" style={{ height: "calc(100% - 140px)" }}>
        {filtered.length === 0 ? (
          <EmptyState tab={tab} />
        ) : (
          <ul className="space-y-2">
            {filtered.map((item) => (
              <li key={item.id}>
                <CoverageRow item={item} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function CoverageRow({ item }: { item: CoverageItem }) {
  const isLive = item.status === "active";
  return (
    <button
      className="flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left transition-colors active:bg-accent"
      style={{ background: "var(--color-surface-elevated)" }}
    >
      <span
        className="relative flex h-10 w-10 items-center justify-center rounded-full"
        style={{
          background: isLive
            ? "color-mix(in oklab, var(--color-presence) 18%, transparent)"
            : "var(--color-secondary)",
        }}
      >
        {isLive ? (
          <>
            <span
              className="absolute inset-0 rounded-full"
              style={{
                background: "var(--color-presence)",
                opacity: 0.3,
                animation: "presence-pulse 1.8s ease-out infinite",
              }}
            />
            <span
              className="relative h-2.5 w-2.5 rounded-full"
              style={{ background: "var(--color-presence)" }}
            />
          </>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-muted-foreground">
            <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6"/>
            <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
        )}
      </span>
      <span className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-[15px] font-medium">{item.facility}</span>
        </div>
        <div className="text-[12.5px] text-muted-foreground">
          {item.role} · {item.area}
        </div>
      </span>
      <span className="shrink-0 text-right">
        <div
          className="text-[12px] font-medium"
          style={{
            color: isLive ? "var(--color-presence)" : "var(--color-foreground)",
          }}
        >
          {item.when}
        </div>
      </span>
    </button>
  );
}

function EmptyState({ tab }: { tab: TabId }) {
  const copy = {
    active: "No live coverage right now.",
    upcoming: "Nothing scheduled.",
    completed: "Your history will appear here.",
  }[tab];
  return (
    <div className="flex h-64 flex-col items-center justify-center text-center">
      <div
        className="flex h-12 w-12 items-center justify-center rounded-full"
        style={{ background: "var(--color-secondary)" }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-muted-foreground">
          <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6"/>
          <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
        </svg>
      </div>
      <p className="mt-3 text-[13.5px] text-muted-foreground">{copy}</p>
    </div>
  );
}
