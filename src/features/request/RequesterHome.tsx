import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { useNavigate } from "@tanstack/react-router";
import { MapBackground } from "@/components/MapBackground";

export function RequesterHome() {
  return <HomeScreen />;
}


type CoverageId = "standard" | "24h" | "weekend" | "home";
type Stage = "collapsed" | "search" | "configure" | "match" | "dispatch" | "accepted";

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

const NOTE_PLACEHOLDER = "Female doctor needed; accommodation available; Mon, Tue, Weds";

/* ---------------------- Pricing ---------------------- */

type PricingContext = { coverage: CoverageId; days: number };

function computePricing({ coverage, days }: PricingContext) {
  const d = Math.max(1, days);
  let amount = 0;
  let explanation = "";

  if (coverage === "24h") {
    amount = d * 80000;
    explanation = "24-hour coverage includes extended operational continuity.";
  } else if (coverage === "weekend") {
    amount = 80000;
    explanation = "Weekend coverage includes extended operational hours.";
  } else if (coverage === "home") {
    amount = d * 45000;
    explanation = "Home care coverage includes personalized operational coordination.";
  } else {
    amount = d * 36000;
    explanation =
      d <= 1
        ? "Short coverage includes adjusted operational pricing."
        : d <= 3
          ? "Mid-length coverage includes adjusted operational pricing."
          : "Standard operational coverage rate.";
  }

  return { amount, explanation };
}

function formatNaira(n: number) {
  return "₦" + n.toLocaleString("en-NG");
}

/* ---------------------- Home ---------------------- */

function HomeScreen() {
  const [stage, setStage] = useState<Stage>("collapsed");
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState<Recent | null>(null);
  const [coverage, setCoverageRaw] = useState<CoverageId>("standard");
  const [days, setDays] = useState(1);

  const setCoverage = (c: CoverageId) => {
    setCoverageRaw(c);
    // Operational defaults per coverage type
    if (c === "24h") setDays(1);
    else if (c === "standard" || c === "home") setDays((d) => (d < 1 || d > 7 ? 1 : d));
  };

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

      {/* Match-stage: compressed context bar */}
      <AnimatePresence>
        {stage === "match" && location && (
          <motion.button
            key="context-bar"
            initial={{ y: -16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -16, opacity: 0 }}
            transition={{ type: "spring", stiffness: 280, damping: 32 }}
            onClick={() => setStage("configure")}
            className="absolute left-3 right-3 z-30 mt-16 flex min-h-12 items-center gap-3 rounded-2xl bg-surface-elevated px-4 py-3 text-left shadow-[0_4px_18px_rgba(0,0,0,0.10)] safe-top"
          >
            <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-presence)]" />
            <span className="flex-1 truncate text-[13px] font-medium leading-none">
              {location.name}
            </span>
            <span className="shrink-0 text-[11px] uppercase tracking-[0.12em] leading-none text-muted-foreground">
              {COVERAGE.find((c) => c.id === coverage)?.label}
            </span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="shrink-0 text-muted-foreground">
              <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </motion.button>
        )}
      </AnimatePresence>

      {/* The layered sheet */}
      <AnimatePresence mode="wait">
        {stage === "dispatch" || stage === "accepted" ? (
          <DispatchOverlay
            key="dispatch-overlay"
            stage={stage}
            setStage={setStage}
            coverage={coverage}
            days={days}
            location={location}
          />
        ) : stage === "match" ? (
          <SettlementSheet
            key="settlement"
            pricing={computePricing({ coverage, days })}
            onConfirm={() => setStage("dispatch")}
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
            days={days}
            setDays={setDays}
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
  days,
  setDays,
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
  days: number;
  setDays: (n: number) => void;
  onAdvance: () => void;
}) {
  const heights: Record<Exclude<Stage, "match">, string> = {
    collapsed: "132px",
    search: "72vh",
    configure: "86vh",
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
        className="flex w-full shrink-0 justify-center pt-3 pb-2"
      >
        <span className="h-1.5 w-10 rounded-full bg-muted-foreground/25" />
      </button>

      <div className="flex flex-1 flex-col overflow-hidden px-5 pb-5 pt-1">
        {/* Search field */}
        <button
          onClick={() => stage === "collapsed" && setStage("search")}
          className="flex h-14 shrink-0 items-center gap-3 rounded-2xl bg-secondary px-4 text-left"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" className="text-muted-foreground">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
            <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          {stage === "collapsed" ? (
            <span className="text-[15px] leading-none text-foreground/85">
              Where is coverage needed?
            </span>
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
              days={days}
              setDays={setDays}
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
  days,
  setDays,
  onAdvance,
}: {
  location: Recent;
  coverage: CoverageId;
  setCoverage: (c: CoverageId) => void;
  days: number;
  setDays: (n: number) => void;
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

      {/* Coverage type pills — Uber-style ride-category selectors */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {COVERAGE.map((c) => {
          const active = c.id === coverage;
          return (
            <button
              key={c.id}
              onClick={() => setCoverage(c.id)}
              className={`shrink-0 rounded-full px-4 py-2 text-[13px] font-medium transition-all ${
                active
                  ? "bg-foreground text-background"
                  : "bg-secondary/70 text-foreground/70 hover:bg-secondary"
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {/* Dynamic fields — switch fluidly per coverage type */}
      <AnimatePresence mode="wait">
        <motion.div
          key={coverage}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}
        >
          <CoverageFields coverage={coverage} days={days} setDays={setDays} />
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

function addHoursToTime(time: string, hoursToAdd: number) {
  const [h, m] = time.split(":").map(Number);
  const total = (h * 60 + m + hoursToAdd * 60) % (24 * 60);
  const nh = Math.floor(total / 60);
  const nm = total % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

function CoverageFields({
  coverage,
  days,
  setDays,
}: {
  coverage: CoverageId;
  days: number;
  setDays: (n: number) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const nextSaturday = useMemo(() => {
    const d = new Date();
    const diff = (6 - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
  }, []);
  const nextSunday = useMemo(() => {
    const d = new Date(nextSaturday);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }, [nextSaturday]);

  // Weekend Call — auto Sat→Mon, +48h, no Duration field
  if (coverage === "weekend") {
    const [startTime, setStartTime] = useState("08:00");
    return (
      <Fields>
        <div className="rounded-xl bg-secondary/50 px-3 py-2.5 text-[12px] text-muted-foreground">
          {fmtRange(nextSaturday, nextSunday)} · 48 hours
        </div>
        <Row>
          <TimeField label="Start time" value={startTime} onChange={setStartTime} />
          <TimeField label="End time" value={addHoursToTime(startTime, 48)} readOnly />
        </Row>
        <NoteField />
      </Fields>
    );
  }

  // Standard / Home Care — Start Date, Start Time, End Time, Duration (1–7d), Note
  if (coverage === "standard" || coverage === "home") {
    return (
      <Fields>
        <Row>
          <Field label="Start date" type="date" defaultValue={today} />
          <Field label="Start time" type="time" defaultValue="08:00" />
        </Row>
        <Row>
          <Field label="End time" type="time" defaultValue="17:00" />
          <DaysStepper value={days} setValue={setDays} />
        </Row>
        <NoteField />
      </Fields>
    );
  }

  // 24-Hour — Start Date, Start Time, Duration (prefilled 1d, up to 7), Note
  return (
    <Fields>
      <Row>
        <Field label="Start date" type="date" defaultValue={today} />
        <Field label="Start time" type="time" defaultValue="08:00" />
      </Row>
      <DaysStepper value={days} setValue={setDays} />
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
  type: "date" | "time";
  defaultValue?: string;
  readOnly?: boolean;
}) {
  const [val, setVal] = useState<string>(defaultValue ?? "");
  return (
    <label className="flex flex-col gap-1 rounded-xl bg-secondary/60 px-3 py-2">
      <span className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </span>
      <input
        type={type}
        value={val}
        readOnly={readOnly}
        onChange={(e) => setVal(e.target.value)}
        className="bg-transparent text-[14px] font-medium outline-none"
      />
    </label>
  );
}

function Stepper({
  label,
  value,
  setValue,
  min,
  max,
  unit,
}: {
  label: string;
  value: number;
  setValue: (n: number) => void;
  min: number;
  max: number;
  unit: (n: number) => string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-secondary/60 px-3 py-2">
      <span className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </span>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setValue(Math.max(min, value - 1))}
          className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-elevated text-foreground/70 active:scale-95"
        >
          −
        </button>
        <span className="text-[14px] font-medium tabular-nums">
          {value} {unit(value)}
        </span>
        <button
          type="button"
          onClick={() => setValue(Math.min(max, value + 1))}
          className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-elevated text-foreground/70 active:scale-95"
        >
          +
        </button>
      </div>
    </div>
  );
}

function TimeField({
  label,
  value,
  onChange,
  readOnly,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 rounded-xl bg-secondary/60 px-3 py-2">
      <span className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </span>
      <input
        type="time"
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
        className="bg-transparent text-[14px] font-medium outline-none"
      />
    </label>
  );
}
function DaysStepper({ value, setValue }: { value: number; setValue: (n: number) => void }) {
  return (
    <Stepper
      label="Duration"
      value={value}
      setValue={setValue}
      min={1}
      max={7}
      unit={(n) => (n === 1 ? "day" : "days")}
    />
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

/* ---------------------- Settlement sheet ---------------------- */

function SettlementSheet({
  pricing,
}: {
  pricing: { amount: number; explanation: string };
}) {
  return (
    <motion.section
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      exit={{ y: "100%" }}
      transition={{ type: "spring", stiffness: 280, damping: 34 }}
      className="absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-3xl shadow-[0_-12px_40px_-12px_rgba(0,0,0,0.18)]"
      style={{ background: "var(--color-surface-elevated)" }}
    >
      <div className="flex w-full shrink-0 justify-center pt-3 pb-2">
        <span className="h-1.5 w-10 rounded-full bg-muted-foreground/25" />
      </div>

      <div className="flex flex-col px-6 pb-7 pt-3">
        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Standard
        </div>

        <div className="mt-2 text-[34px] font-semibold leading-none tracking-tight tabular-nums">
          {formatNaira(pricing.amount)}
        </div>

        <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
          {pricing.explanation}
        </p>

        <button className="mt-6 h-13 w-full rounded-full bg-primary py-4 text-[14.5px] font-semibold text-primary-foreground active:opacity-90">
          Request Coverage
        </button>
      </div>
    </motion.section>
  );
}
