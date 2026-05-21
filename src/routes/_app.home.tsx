import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { MapBackground } from "@/components/MapBackground";

export const Route = createFileRoute("/_app/home")({
  component: HomeScreen,
});

type CoverageId = "standard" | "24h" | "weekend" | "home";
type Stage = "collapsed" | "search" | "configure" | "match";

type Recent = { name: string; area: string };

const RECENT: Recent[] = [
  { name: "Evercare Hospital", area: "Lekki Phase 1" },
  { name: "Lagoon Hospital", area: "Apapa" },
  { name: "Reddington Hospital", area: "Victoria Island" },
];

const COVERAGE: { id: CoverageId; label: string }[] = [
  { id: "standard", label: "Standard" },
  { id: "24h", label: "24-Hour" },
  { id: "weekend", label: "Weekend Call" },
  { id: "home", label: "Home Care" },
];

const MATCHES = [
  { id: "standard", title: "Standard Match", eta: "~45 min", note: "Best available nearby" },
  { id: "flexible", title: "Flexible Match", eta: "~2 hr", note: "Wider radius, calmer pace" },
  { id: "priority", title: "Priority Match", eta: "~15 min", note: "Fastest dispatch" },
];

const NOTE_PLACEHOLDER = "Female doctor needed; accommodation available; Mon, Tue, Weds";

function HomeScreen() {
  const [stage, setStage] = useState<Stage>("collapsed");
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState<Recent | null>(null);
  const [coverage, setCoverage] = useState<CoverageId>("standard");

  const recents = useMemo(
    () =>
      RECENT.filter((r) => r.name.toLowerCase().includes(query.toLowerCase())).slice(0, 3),
    [query],
  );

  const selectLocation = (r: Recent) => {
    setLocation(r);
    setQuery(r.name);
    setStage("configure");
  };

  return (
    <section className="relative h-full w-full overflow-hidden">
      <MapBackground />

      {/* top chrome */}
      <header className="absolute inset-x-0 top-0 z-30 safe-top pointer-events-none">
        <div className="mx-auto flex max-w-md items-center justify-between px-4 pt-3">
          <button className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-surface-elevated shadow-[0_2px_10px_rgba(0,0,0,0.08)]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <span className="h-10 w-10" />
        </div>
      </header>

      {/* Match-stage: compressed context bar on top */}
      <AnimatePresence>
        {stage === "match" && location && (
          <motion.button
            key="context-bar"
            initial={{ y: -16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -16, opacity: 0 }}
            transition={{ type: "spring", stiffness: 280, damping: 32 }}
            onClick={() => setStage("configure")}
            className="absolute left-3 right-3 z-30 mt-16 flex items-center gap-3 rounded-2xl bg-surface-elevated px-4 py-2.5 text-left shadow-[0_4px_18px_rgba(0,0,0,0.10)] safe-top"
          >
            <span className="h-2 w-2 rounded-full bg-[var(--color-presence)]" />
            <span className="flex-1 truncate text-[13px] font-medium">{location.name}</span>
            <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              {COVERAGE.find((c) => c.id === coverage)?.label}
            </span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-muted-foreground">
              <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </motion.button>
        )}
      </AnimatePresence>

      {/* The layered sheet */}
      <AnimatePresence mode="wait">
        {stage === "match" ? (
          <MatchSheet
            key="match"
            onBack={() => setStage("configure")}
          />
        ) : (
          <DispatchSheet
            key="dispatch"
            stage={stage}
            setStage={setStage}
            query={query}
            setQuery={setQuery}
            recents={recents}
            onPickRecent={selectLocation}
            location={location}
            coverage={coverage}
            setCoverage={setCoverage}
            onAdvance={() => setStage("match")}
          />
        )}
      </AnimatePresence>
    </section>
  );
}

/* ---------------------- Dispatch sheet ---------------------- */

function DispatchSheet({
  stage,
  setStage,
  query,
  setQuery,
  recents,
  onPickRecent,
  location,
  coverage,
  setCoverage,
  onAdvance,
}: {
  stage: Stage;
  setStage: (s: Stage) => void;
  query: string;
  setQuery: (v: string) => void;
  recents: Recent[];
  onPickRecent: (r: Recent) => void;
  location: Recent | null;
  coverage: CoverageId;
  setCoverage: (c: CoverageId) => void;
  onAdvance: () => void;
}) {
  // sheet height percentages
  const heights: Record<Exclude<Stage, "match">, string> = {
    collapsed: "14%",
    search: "70%",
    configure: "82%",
  };
  const height = heights[stage === "match" ? "configure" : stage];

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.velocity.y < -300 || info.offset.y < -60) {
      if (stage === "collapsed") setStage("search");
    } else if (info.velocity.y > 300 || info.offset.y > 60) {
      if (stage === "search") setStage("collapsed");
      else if (stage === "configure") setStage("search");
    }
  };

  return (
    <motion.section
      initial={false}
      animate={{ height }}
      transition={{ type: "spring", stiffness: 260, damping: 32, mass: 0.9 }}
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={0.04}
      dragMomentum={false}
      onDragEnd={handleDragEnd}
      className="absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-3xl shadow-[0_-12px_40px_-12px_rgba(0,0,0,0.18)]"
      style={{ background: "var(--color-surface-elevated)" }}
    >
      <button
        aria-label="Toggle"
        onClick={() => setStage(stage === "collapsed" ? "search" : "collapsed")}
        className="flex w-full shrink-0 justify-center pt-2.5 pb-1.5"
      >
        <span className="h-1.5 w-10 rounded-full bg-muted-foreground/25" />
      </button>

      <div className="flex flex-1 flex-col px-5 pb-5 overflow-hidden">
        {/* Search field */}
        <button
          onClick={() => stage === "collapsed" && setStage("search")}
          className="flex h-12 shrink-0 items-center gap-3 rounded-2xl bg-secondary px-4 text-left"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" className="text-muted-foreground">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
            <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          {stage === "collapsed" ? (
            <span className="text-[15px] text-foreground/85">Where is coverage needed?</span>
          ) : (
            <input
              autoFocus={stage === "search"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => stage === "configure" && setStage("search")}
              placeholder="Where is coverage needed?"
              className="h-full flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
            />
          )}
        </button>

        {/* Body */}
        <div className="mt-4 flex-1 overflow-y-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {stage === "search" && recents.length > 0 && (
            <ul className="space-y-0.5">
              {recents.map((r) => (
                <li key={r.name}>
                  <button
                    onClick={() => onPickRecent(r)}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left active:bg-accent"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="text-muted-foreground">
                        <path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z" stroke="currentColor" strokeWidth="1.6" />
                        <circle cx="12" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.6" />
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
          )}

          {stage === "configure" && location && (
            <ConfigureBody
              location={location}
              coverage={coverage}
              setCoverage={setCoverage}
              onAdvance={onAdvance}
            />
          )}
        </div>
      </div>
    </motion.section>
  );
}

/* ---------------------- Configure body ---------------------- */

function ConfigureBody({
  location,
  coverage,
  setCoverage,
  onAdvance,
}: {
  location: Recent;
  coverage: CoverageId;
  setCoverage: (c: CoverageId) => void;
  onAdvance: () => void;
}) {
  return (
    <div className="space-y-5">
      {/* selected location pill */}
      <div className="flex items-center gap-3 rounded-2xl bg-secondary/60 px-3 py-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-presence)]/15">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-presence)]" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="truncate text-[14px] font-medium">{location.name}</div>
          <div className="truncate text-[11.5px] text-muted-foreground">{location.area}</div>
        </div>
      </div>

      {/* Coverage type pills */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {COVERAGE.map((c) => {
          const active = c.id === coverage;
          return (
            <button
              key={c.id}
              onClick={() => setCoverage(c.id)}
              className={`shrink-0 rounded-full px-4 py-2 text-[13px] font-medium transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-foreground/75"
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {/* Dynamic fields */}
      <AnimatePresence mode="wait">
        <motion.div
          key={coverage}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}
        >
          <CoverageFields coverage={coverage} />
        </motion.div>
      </AnimatePresence>

      {/* Arrow progression */}
      <div className="flex justify-end pt-1">
        <button
          onClick={onAdvance}
          aria-label="Continue"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_6px_18px_rgba(0,0,0,0.18)] active:scale-95 transition-transform"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/* ---------------------- Coverage-specific fields ---------------------- */

function CoverageFields({ coverage }: { coverage: CoverageId }) {
  const today = new Date().toISOString().slice(0, 10);
  const nextSaturday = useMemo(() => {
    const d = new Date();
    const diff = (6 - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
  }, []);
  const nextMonday = useMemo(() => {
    const d = new Date(nextSaturday);
    d.setDate(d.getDate() + 2);
    return d.toISOString().slice(0, 10);
  }, [nextSaturday]);

  if (coverage === "standard") {
    return (
      <Fields>
        <Row><Field label="Start date" type="date" defaultValue={today} /><Field label="Duration" type="duration" /></Row>
        <Row><Field label="Start time" type="time" defaultValue="08:00" /><Field label="End time" type="time" defaultValue="18:00" /></Row>
        <NoteField />
      </Fields>
    );
  }
  if (coverage === "24h") {
    return (
      <Fields>
        <Row><Field label="Start date" type="date" defaultValue={today} /><Field label="Start time" type="time" defaultValue="08:00" /></Row>
        <Field label="Duration" type="duration" defaultValue={1} />
        <NoteField />
      </Fields>
    );
  }
  if (coverage === "weekend") {
    return (
      <Fields>
        <div className="rounded-xl bg-secondary/50 px-3 py-2 text-[12px] text-muted-foreground">
          {fmtRange(nextSaturday, nextMonday)} · 48 hours
        </div>
        <Row><Field label="Start time" type="time" defaultValue="08:00" /><Field label="End time" type="time" defaultValue="08:00" readOnly /></Row>
        <NoteField />
      </Fields>
    );
  }
  return (
    <Fields>
      <Row><Field label="Start date" type="date" defaultValue={today} /><Field label="Duration" type="duration" /></Row>
      <Row><Field label="Start time" type="time" defaultValue="09:00" /><Field label="End time" type="time" defaultValue="17:00" /></Row>
      <NoteField />
    </Fields>
  );
}

function Fields({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2.5">{children}</div>;
}
function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2.5">{children}</div>;
}

function Field({
  label,
  type,
  defaultValue,
  readOnly,
}: {
  label: string;
  type: "date" | "time" | "duration";
  defaultValue?: string | number;
  readOnly?: boolean;
}) {
  const [val, setVal] = useState<string | number>(defaultValue ?? (type === "duration" ? 1 : ""));
  return (
    <label className="flex flex-col gap-1 rounded-xl bg-secondary/60 px-3 py-2">
      <span className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </span>
      {type === "duration" ? (
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setVal(Math.max(1, Number(val) - 1))}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-elevated text-foreground/70 active:scale-95"
          >
            −
          </button>
          <span className="text-[14px] font-medium tabular-nums">
            {val} {Number(val) === 1 ? "day" : "days"}
          </span>
          <button
            type="button"
            onClick={() => setVal(Math.min(7, Number(val) + 1))}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-elevated text-foreground/70 active:scale-95"
          >
            +
          </button>
        </div>
      ) : (
        <input
          type={type}
          value={val as string}
          readOnly={readOnly}
          onChange={(e) => setVal(e.target.value)}
          className="bg-transparent text-[14px] font-medium outline-none"
        />
      )}
    </label>
  );
}

function NoteField() {
  return (
    <label className="flex flex-col gap-1 rounded-xl bg-secondary/60 px-3 py-2">
      <span className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        Note
      </span>
      <textarea
        rows={2}
        placeholder={NOTE_PLACEHOLDER}
        className="resize-none bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground/55"
      />
    </label>
  );
}

function fmtRange(a: string, b: string) {
  const fmt = (s: string) =>
    new Date(s).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return `${fmt(a)} → ${fmt(b)}`;
}

/* ---------------------- Match sheet ---------------------- */

function MatchSheet({ onBack }: { onBack: () => void }) {
  const [selected, setSelected] = useState("standard");
  return (
    <motion.section
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      exit={{ y: "100%" }}
      transition={{ type: "spring", stiffness: 280, damping: 34 }}
      className="absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-3xl shadow-[0_-12px_40px_-12px_rgba(0,0,0,0.18)]"
      style={{ background: "var(--color-surface-elevated)", height: "58%" }}
    >
      <button onClick={onBack} className="flex w-full shrink-0 justify-center pt-2.5 pb-1.5">
        <span className="h-1.5 w-10 rounded-full bg-muted-foreground/25" />
      </button>

      <div className="flex flex-1 flex-col px-5 pb-6">
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Choose coverage match
        </div>

        <ul className="mt-3 flex-1 space-y-2">
          {MATCHES.map((m) => {
            const active = m.id === selected;
            return (
              <li key={m.id}>
                <button
                  onClick={() => setSelected(m.id)}
                  className={`flex w-full items-center gap-4 rounded-2xl px-4 py-3.5 text-left transition-colors ${
                    active ? "bg-primary text-primary-foreground" : "bg-secondary/70"
                  }`}
                >
                  <span
                    className={`flex h-10 w-10 items-center justify-center rounded-full ${
                      active ? "bg-primary-foreground/15" : "bg-surface-elevated"
                    }`}
                  >
                    <span className="h-2 w-2 rounded-full bg-[var(--color-presence)]" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <div className="text-[14.5px] font-semibold">{m.title}</div>
                    <div className={`text-[12px] ${active ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                      {m.note}
                    </div>
                  </span>
                  <span className={`text-[12.5px] font-medium ${active ? "text-primary-foreground/85" : "text-foreground/75"}`}>
                    {m.eta}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <button className="mt-3 h-12 w-full rounded-full bg-primary text-[14px] font-semibold text-primary-foreground active:opacity-90">
          Confirm coverage
        </button>
      </div>
    </motion.section>
  );
}
