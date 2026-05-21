import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { MapBackground } from "@/components/MapBackground";
import { BottomSheet } from "@/components/BottomSheet";

export const Route = createFileRoute("/_app/home")({
  component: HomeScreen,
});

const COVERAGE_TYPES = [
  { id: "standard", title: "Standard Coverage", time: "~ now", note: "Single shift" },
  { id: "24h", title: "24-Hour Coverage", time: "Full day", note: "Continuous shift" },
  { id: "weekend", title: "Weekend Call", time: "Sat–Sun", note: "On-call cover" },
  { id: "home", title: "Home Care", time: "By visit", note: "At residence" },
];

const RECENT = [
  { name: "Evercare Hospital", area: "Lekki Phase 1" },
  { name: "Lagoon Hospital", area: "Apapa" },
  { name: "Reddington Hospital", area: "Victoria Island" },
  { name: "St. Nicholas Hospital", area: "Lagos Island" },
];

function HomeScreen() {
  const [expanded, setExpanded] = useState(false);
  const [coverage, setCoverage] = useState("standard");
  const [query, setQuery] = useState("");

  return (
    <section className="relative h-full w-full overflow-hidden">
      <MapBackground />

      {/* top status bar */}
      <header className="absolute inset-x-0 top-0 z-30 safe-top">
        <div className="mx-auto flex max-w-md items-center justify-between px-4 pt-3">
          <button className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-elevated shadow-[0_2px_10px_rgba(0,0,0,0.08)]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
          <div className="flex items-center gap-2 rounded-full bg-surface-elevated px-3 py-1.5 shadow-[0_2px_10px_rgba(0,0,0,0.08)]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inset-0 animate-ping rounded-full bg-[var(--color-presence)] opacity-60" />
              <span className="relative h-2 w-2 rounded-full bg-[var(--color-presence)]" />
            </span>
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              12 doctors nearby
            </span>
          </div>
          <span className="h-10 w-10" />
        </div>
      </header>

      {/* recenter FAB */}
      <button
        className="absolute right-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-surface-elevated shadow-[0_4px_14px_rgba(0,0,0,0.12)] active:scale-95 transition-transform"
        style={{ bottom: expanded ? "calc(60% + 16px)" : "200px" }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6"/>
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
        </svg>
      </button>

      <BottomSheet expanded={expanded} onExpandedChange={setExpanded}>
        <div className="flex h-full flex-col px-5">
          <button
            onClick={() => setExpanded(true)}
            className={`flex items-center gap-3 rounded-2xl bg-secondary px-4 transition-all ${expanded ? "h-14" : "h-13 py-3.5"}`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-muted-foreground">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8"/>
              <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
            {expanded ? (
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Where is coverage needed?"
                className="h-full flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
              />
            ) : (
              <span className="text-[15px] font-medium text-foreground/90">
                Where is coverage needed?
              </span>
            )}
          </button>

          {!expanded ? (
            <CollapsedQuick onTap={() => setExpanded(true)} />
          ) : (
            <div className="mt-5 flex-1 overflow-y-auto pb-8">
              <SectionLabel>Recent</SectionLabel>
              <ul className="mt-2 space-y-1">
                {RECENT.filter((r) => r.name.toLowerCase().includes(query.toLowerCase())).map((r) => (
                  <li key={r.name}>
                    <button className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left active:bg-accent">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-muted-foreground">
                          <path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z" stroke="currentColor" strokeWidth="1.6"/>
                          <circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.6"/>
                        </svg>
                      </span>
                      <span className="flex-1">
                        <div className="text-[15px] font-medium">{r.name}</div>
                        <div className="text-[12.5px] text-muted-foreground">{r.area}</div>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              <SectionLabel className="mt-6">Coverage type</SectionLabel>
              <div className="mt-2 -mx-1 flex gap-2 overflow-x-auto pb-2 pl-1 pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {COVERAGE_TYPES.map((c) => {
                  const active = coverage === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setCoverage(c.id)}
                      className={`shrink-0 rounded-2xl px-4 py-3 text-left transition-colors ${active ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"}`}
                      style={{ minWidth: 150 }}
                    >
                      <div className="text-[14px] font-semibold">{c.title}</div>
                      <div className={`text-[11.5px] mt-0.5 ${active ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                        {c.time} · {c.note}
                      </div>
                    </button>
                  );
                })}
              </div>

              <button className="mt-5 h-13 w-full rounded-2xl bg-primary py-3.5 text-[15px] font-semibold text-primary-foreground active:opacity-90">
                Request coverage
              </button>
            </div>
          )}
        </div>
      </BottomSheet>
    </section>
  );
}

function CollapsedQuick({ onTap }: { onTap: () => void }) {
  return (
    <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {["Standard", "24-Hour", "Weekend", "Home Care"].map((t) => (
        <button
          key={t}
          onClick={onTap}
          className="shrink-0 rounded-full bg-secondary px-3.5 py-2 text-[12.5px] font-medium text-foreground/90 active:bg-accent"
        >
          {t}
        </button>
      ))}
    </div>
  );
}

function SectionLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground ${className}`}>
      {children}
    </div>
  );
}
