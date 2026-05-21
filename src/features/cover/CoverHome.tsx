import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { MapBackground } from "@/components/MapBackground";

type RequestItem = {
  id: string;
  facility: string;
  area: string;
  role: "Standard" | "24-Hour" | "Weekend Call" | "Home Care";
  hours: number;
  amount: number;
  distanceKm: number;
  when: string;
};

const INCOMING: RequestItem[] = [
  {
    id: "r1",
    facility: "Evercare Hospital",
    area: "Lekki Phase 1",
    role: "Standard",
    hours: 10,
    amount: 36000,
    distanceKm: 4.2,
    when: "Today · 14:00",
  },
  {
    id: "r2",
    facility: "Reddington Hospital",
    area: "Victoria Island",
    role: "Weekend Call",
    hours: 48,
    amount: 80000,
    distanceKm: 7.8,
    when: "Sat · 08:00",
  },
  {
    id: "r3",
    facility: "Lagoon Hospital",
    area: "Apapa",
    role: "24-Hour",
    hours: 24,
    amount: 80000,
    distanceKm: 12.1,
    when: "Tomorrow · 08:00",
  },
];

const naira = (n: number) => "₦" + n.toLocaleString("en-NG");

export function CoverHome() {
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<RequestItem[]>(INCOMING);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<RequestItem | null>(null);

  // Surface the next incoming request after a short delay when online,
  // creating an Uber-driver-like dispatch feel.
  useEffect(() => {
    if (!online || activeId || accepted || queue.length === 0) return;
    const t = window.setTimeout(() => setActiveId(queue[0].id), 1200);
    return () => window.clearTimeout(t);
  }, [online, queue, activeId, accepted]);

  const active = useMemo(
    () => queue.find((r) => r.id === activeId) ?? null,
    [queue, activeId],
  );

  const decline = (id: string) => {
    setActiveId(null);
    setQueue((q) => q.filter((r) => r.id !== id));
  };
  const accept = (item: RequestItem) => {
    setActiveId(null);
    setAccepted(item);
    setQueue((q) => q.filter((r) => r.id !== item.id));
  };

  return (
    <section className="relative h-full w-full overflow-hidden">
      <MapBackground />

      {/* top status pill */}
      <header className="absolute inset-x-0 top-0 z-30 safe-top pointer-events-none">
        <div className="mx-auto flex max-w-md items-center justify-between px-4 pt-3">
          <button className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-surface-elevated shadow-[0_2px_10px_rgba(0,0,0,0.08)]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>

          <button
            onClick={() => setOnline((v) => !v)}
            className="pointer-events-auto flex h-10 items-center gap-2 rounded-full bg-surface-elevated px-4 shadow-[0_2px_10px_rgba(0,0,0,0.08)]"
          >
            <span
              className="relative h-2 w-2 rounded-full"
              style={{
                background: online
                  ? "var(--color-presence)"
                  : "color-mix(in oklab, var(--color-foreground) 30%, transparent)",
              }}
            >
              {online && (
                <span
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: "var(--color-presence)",
                    opacity: 0.45,
                    animation: "presence-pulse 2s ease-out infinite",
                  }}
                />
              )}
            </span>
            <span className="text-[12px] font-medium tracking-tight">
              {online ? "Online" : "Offline"}
            </span>
          </button>
        </div>
      </header>

      {/* Idle ambient sheet — replaced by incoming or accepted */}
      <AnimatePresence mode="wait">
        {accepted ? (
          <AcceptedSheet
            key="accepted"
            item={accepted}
            onComplete={() => setAccepted(null)}
          />
        ) : active ? (
          <IncomingSheet
            key={"incoming-" + active.id}
            item={active}
            onAccept={() => accept(active)}
            onDecline={() => decline(active.id)}
          />
        ) : (
          <IdleSheet key="idle" online={online} pending={queue.length} />
        )}
      </AnimatePresence>
    </section>
  );
}

/* ---------------------- Idle ---------------------- */

function IdleSheet({ online, pending }: { online: boolean; pending: number }) {
  return (
    <motion.section
      initial={{ y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 24, opacity: 0 }}
      transition={{ type: "spring", stiffness: 280, damping: 32 }}
      className="absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-3xl shadow-[0_-12px_40px_-12px_rgba(0,0,0,0.18)]"
      style={{ background: "var(--color-surface-elevated)" }}
    >
      <div className="flex w-full shrink-0 justify-center pt-3 pb-2">
        <span className="h-1.5 w-10 rounded-full bg-muted-foreground/25" />
      </div>
      <div className="px-6 pb-7 pt-2">
        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Dispatch
        </div>
        <div className="mt-2 text-[22px] font-semibold tracking-tight">
          {online
            ? pending > 0
              ? "Scanning nearby coverage"
              : "Listening for coverage"
            : "You're offline"}
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          {online
            ? "FlashLocum will surface dispatch requests near you in realtime."
            : "Go online to start receiving coverage requests."}
        </p>
      </div>
    </motion.section>
  );
}

/* ---------------------- Incoming dispatch ---------------------- */

function IncomingSheet({
  item,
  onAccept,
  onDecline,
}: {
  item: RequestItem;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 500) onDecline();
  };
  return (
    <motion.section
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      exit={{ y: "100%" }}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={0.05}
      dragMomentum={false}
      onDragEnd={handleDragEnd}
      className="absolute inset-x-0 bottom-0 z-30 flex flex-col rounded-t-3xl shadow-[0_-14px_44px_-12px_rgba(0,0,0,0.22)]"
      style={{ background: "var(--color-surface-elevated)" }}
    >
      <div className="flex w-full shrink-0 justify-center pt-3 pb-2">
        <span className="h-1.5 w-10 rounded-full bg-muted-foreground/25" />
      </div>

      <div className="px-6 pb-6 pt-1">
        <div className="flex items-center gap-2">
          <span
            className="relative h-2 w-2 rounded-full"
            style={{ background: "var(--color-presence)" }}
          >
            <span
              className="absolute inset-0 rounded-full"
              style={{
                background: "var(--color-presence)",
                opacity: 0.5,
                animation: "presence-pulse 1.6s ease-out infinite",
              }}
            />
          </span>
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            New dispatch · {item.role}
          </span>
        </div>

        <div className="mt-3 text-[22px] font-semibold leading-tight tracking-tight">
          {item.facility}
        </div>
        <div className="text-[13px] text-muted-foreground">
          {item.area} · {item.distanceKm.toFixed(1)} km away
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <Stat label="When" value={item.when} />
          <Stat label="Duration" value={`${item.hours}${item.hours > 12 ? "h" : " hrs"}`} />
        </div>

        <div className="mt-3 flex items-baseline justify-between rounded-2xl bg-secondary/60 px-4 py-3">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Settlement
          </span>
          <span className="text-[20px] font-semibold tracking-tight tabular-nums">
            {naira(item.amount)}
          </span>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={onDecline}
            className="h-13 flex-1 rounded-full bg-secondary py-4 text-[14px] font-medium text-foreground/75 active:opacity-90"
          >
            Decline
          </button>
          <button
            onClick={onAccept}
            className="h-13 flex-[1.4] rounded-full bg-primary py-4 text-[14.5px] font-semibold text-primary-foreground active:opacity-90"
          >
            Accept Coverage
          </button>
        </div>
      </div>
    </motion.section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
      <div className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-[14px] font-medium">{value}</div>
    </div>
  );
}

/* ---------------------- Accepted (active coverage) ---------------------- */

function AcceptedSheet({
  item,
  onComplete,
}: {
  item: RequestItem;
  onComplete: () => void;
}) {
  return (
    <motion.section
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      exit={{ y: "100%" }}
      transition={{ type: "spring", stiffness: 300, damping: 34 }}
      className="absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-3xl shadow-[0_-12px_40px_-12px_rgba(0,0,0,0.18)]"
      style={{ background: "var(--color-surface-elevated)" }}
    >
      <div className="flex w-full shrink-0 justify-center pt-3 pb-2">
        <span className="h-1.5 w-10 rounded-full bg-muted-foreground/25" />
      </div>
      <div className="px-6 pb-7 pt-1">
        <div className="text-[11px] font-medium uppercase tracking-[0.16em]" style={{ color: "var(--color-presence)" }}>
          Coverage Accepted
        </div>
        <div className="mt-2 text-[20px] font-semibold tracking-tight">
          {item.facility}
        </div>
        <div className="text-[13px] text-muted-foreground">
          {item.area} · {item.when}
        </div>

        <div className="mt-4 flex items-baseline justify-between rounded-2xl bg-secondary/60 px-4 py-3">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Settlement on completion
          </span>
          <span className="text-[18px] font-semibold tracking-tight tabular-nums">
            {naira(item.amount)}
          </span>
        </div>

        <button
          onClick={onComplete}
          className="mt-5 h-13 w-full rounded-full bg-primary py-4 text-[14.5px] font-semibold text-primary-foreground active:opacity-90"
        >
          Mark Coverage Complete
        </button>
      </div>
    </motion.section>
  );
}
