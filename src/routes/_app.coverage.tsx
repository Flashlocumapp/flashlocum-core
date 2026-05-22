import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { getRole, type Role } from "@/lib/role";
import { ShiftSettlement } from "@/features/request/ShiftSettlement";
import { fmtNairaK, fmtShiftMeta, shortWeekdays } from "@/lib/format";

export const Route = createFileRoute("/_app/coverage")({
  component: CoverageScreen,
});

// ----- Doctor-side items (unchanged shape) -----
type DoctorItem = {
  id: string;
  facility: string;
  area: string;
  role: string;
  when: string;
  status: "active" | "upcoming" | "completed";
};

const DOCTOR_ITEMS: DoctorItem[] = [
  { id: "c1", facility: "Evercare Hospital", area: "Lekki Phase 1", role: "General Practice", when: "Live · 02:14 in", status: "active" },
  { id: "c2", facility: "Lagoon Hospital", area: "Apapa", role: "Paediatrics", when: "Tomorrow · 08:00", status: "upcoming" },
  { id: "c3", facility: "Reddington", area: "Victoria Island", role: "Weekend Call", when: "Sat 22 · 18:00", status: "upcoming" },
  { id: "c4", facility: "St. Nicholas", area: "Lagos Island", role: "24-Hour", when: "Tue 18 · 9h", status: "completed" },
  { id: "c5", facility: "First Cardiology", area: "Ikoyi", role: "Standard", when: "Mon 17 · 6h", status: "completed" },
];

// ----- Requester-side dispatch entries -----
type Coverage = "Standard" | "24-Hour" | "Weekend Call" | "Home Care";
type ReqStatus = "upcoming" | "active" | "completed";
type RequestItem = {
  id: string;
  doctor: string;
  mdcn: string;
  initials: string;
  coverage: Coverage;
  schedule: string; // e.g. "Tuesday · 8:00 AM" or "Today · 9:24 AM"
  completedOn?: string; // e.g. "Mon 17 Nov"
  amount: number;
  status: ReqStatus;
};

const DEFAULT_DOCTOR_PHONE = "+2348012345678";

const INITIAL_REQUESTS: RequestItem[] = [
  {
    id: "r-active-1",
    doctor: "Dr. Adaobi Okeke",
    mdcn: "MDCN-18432",
    initials: "AO",
    coverage: "Standard",
    schedule: "Today · 9:24 AM",
    amount: 36000,
    status: "active",
  },
  {
    id: "r-up-1",
    doctor: "Dr. Emmanuel Adeleke",
    mdcn: "MDCN-12245",
    initials: "EA",
    coverage: "Standard",
    schedule: "Tuesday · 8:00 AM",
    amount: 36000,
    status: "upcoming",
  },
  {
    id: "r-up-2",
    doctor: "Dr. Tunde Bello",
    mdcn: "MDCN-20918",
    initials: "TB",
    coverage: "Weekend Call",
    schedule: "Sat · 8:00 AM",
    amount: 80000,
    status: "upcoming",
  },
  {
    id: "r-hist-1",
    doctor: "Dr. Ifeoma Nweze",
    mdcn: "MDCN-09921",
    initials: "IN",
    coverage: "Home Care",
    schedule: "",
    completedOn: "Mon 17 Nov",
    amount: 45000,
    status: "completed",
  },
];

const TABS = [
  { id: "active", label: "Active" },
  { id: "upcoming", label: "Upcoming" },
  { id: "completed", label: "History" },
] as const;
type TabId = typeof TABS[number]["id"];


function CoverageScreen() {
  const [tab, setTab] = useState<TabId>("active");
  const [role, setLocalRole] = useState<Role>("request");
  useEffect(() => setLocalRole(getRole()), []);

  return role === "cover" ? (
    <DoctorCoverage tab={tab} setTab={setTab} />
  ) : (
    <RequesterCoverage tab={tab} setTab={setTab} />
  );
}

// ============ REQUESTER ============

function RequesterCoverage({ tab, setTab }: { tab: TabId; setTab: (t: TabId) => void }) {
  const [items, setItems] = useState<RequestItem[]>(INITIAL_REQUESTS);
  const [settlingId, setSettlingId] = useState<string | null>(null);

  const filtered = useMemo(
    () => items.filter((i) => i.status === tab),
    [items, tab],
  );

  const settling = items.find((i) => i.id === settlingId) ?? null;

  const moveToActive = (id: string) => {
    setItems((prev) =>
      prev.map((i) =>
        i.id === id
          ? { ...i, status: "active", schedule: "Today · just now" }
          : i,
      ),
    );
    setTab("active");
  };

  const beginEndShift = (id: string) => {
    setSettlingId(id);
  };

  const confirmEnd = () => {
    if (!settlingId) return;
    setItems((prev) =>
      prev.map((i) =>
        i.id === settlingId
          ? {
              ...i,
              status: "completed",
              completedOn: new Date().toLocaleDateString("en-NG", {
                weekday: "short",
                day: "2-digit",
                month: "short",
              }),
            }
          : i,
      ),
    );
  };

  return (
    <section className="relative h-full w-full overflow-hidden bg-background">
      <CoverageHeader subtitle="Your coverage continuity" tab={tab} setTab={setTab} />

      <div
        className="mx-auto mt-3 max-w-md overflow-y-auto px-5 pb-6"
        style={{ height: "calc(100% - 140px)" }}
      >
        {filtered.length === 0 ? (
          <EmptyState tab={tab} role="request" />
        ) : (
          <ul className="space-y-2.5">
            <AnimatePresence initial={false}>
              {filtered.map((item) => (
                <motion.li
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                >
                  <RequestCard
                    item={item}
                    onStart={() => moveToActive(item.id)}
                    onEnd={() => beginEndShift(item.id)}
                    onCancel={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
                    onEdit={() => {
                      /* Edit Shift: notify doctor of operational updates */
                    }}
                  />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>

      <ShiftSettlement
        open={!!settling}
        onClose={() => setSettlingId(null)}
        initialPhase="settlement"
        onConfirmed={confirmEnd}
        shift={
          settling
            ? {
                facility: "Lagoon Health",
                doctor: settling.doctor,
                role: `${settling.coverage} · Active`,
                amount: settling.amount,
              }
            : undefined
        }
      />
    </section>
  );
}

function RequestCard({
  item,
  onStart,
  onEnd,
  onCancel,
  onEdit,
}: {
  item: RequestItem;
  onStart: () => void;
  onEnd: () => void;
  onCancel: () => void;
  onEdit: () => void;
}) {
  const isActive = item.status === "active";
  const isUpcoming = item.status === "upcoming";
  const isHistory = item.status === "completed";

  const meta = isHistory
    ? `${item.coverage} · ${shortWeekdays(item.completedOn ?? "")} · ${fmtNairaK(item.amount)}`
    : isActive
      ? `${item.coverage} · Active · ${fmtNairaK(item.amount)}`
      : fmtShiftMeta(item.coverage, item.schedule, item.amount);

  return (
    <div
      className="rounded-2xl px-3.5 py-3"
      style={{
        background: isHistory
          ? "color-mix(in oklab, var(--color-surface-elevated) 60%, transparent)"
          : "var(--color-surface-elevated)",
      }}
    >
      <div className="flex items-center gap-3">
        <Avatar initials={item.initials} dim={isHistory} live={isActive} />

        <div className="min-w-0 flex-1">
          <div
            className="truncate text-[15px] font-medium"
            style={{
              color: isHistory
                ? "color-mix(in oklab, var(--color-foreground) 78%, transparent)"
                : "var(--color-foreground)",
            }}
          >
            {item.doctor}
          </div>
          <div className="truncate text-[12px] text-muted-foreground">{item.mdcn}</div>
          <div
            className="mt-0.5 truncate text-[12.5px]"
            style={{
              color: isHistory
                ? "color-mix(in oklab, var(--color-foreground) 55%, transparent)"
                : "color-mix(in oklab, var(--color-foreground) 70%, transparent)",
            }}
          >
            {meta}
          </div>
        </div>

        {isUpcoming && (
          <button
            onClick={onStart}
            className="shrink-0 rounded-full px-3.5 py-2 text-[12.5px] font-medium transition-transform active:scale-[0.97]"
            style={{
              background: "var(--color-foreground)",
              color: "var(--color-background)",
            }}
          >
            Start Shift
          </button>
        )}
        {isActive && (
          <button
            onClick={onEnd}
            className="shrink-0 rounded-full px-3.5 py-2 text-[12.5px] font-medium transition-transform active:scale-[0.97]"
            style={{
              background: "var(--color-foreground)",
              color: "var(--color-background)",
            }}
          >
            End Shift
          </button>
        )}
      </div>

      {isUpcoming && (
        <div className="mt-2.5 flex items-center gap-1.5 pl-[56px]">
          <SecondaryAction onClick={onEdit} label="Edit" />
          <SecondaryAction onClick={onCancel} label="Cancel" />
          <a
            href={`tel:${DEFAULT_DOCTOR_PHONE}`}
            className="inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors active:opacity-80"
            style={{
              background: "color-mix(in oklab, var(--color-foreground) 6%, transparent)",
              color: "color-mix(in oklab, var(--color-foreground) 80%, transparent)",
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
              <path
                d="M5 4h3l2 5-2.5 1.5a11 11 0 005 5L14 13l5 2v3a2 2 0 01-2 2A14 14 0 013 6a2 2 0 012-2z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Call
          </a>
        </div>
      )}
    </div>
  );
}

function SecondaryAction({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="h-7 rounded-full px-3 text-[12px] font-medium transition-colors active:opacity-80"
      style={{
        background: "color-mix(in oklab, var(--color-foreground) 6%, transparent)",
        color: "color-mix(in oklab, var(--color-foreground) 80%, transparent)",
      }}
    >
      {label}
    </button>
  );
}



function Avatar({
  initials,
  dim,
  live,
}: {
  initials: string;
  dim?: boolean;
  live?: boolean;
}) {
  return (
    <span className="relative shrink-0">
      <span
        className="flex h-11 w-11 items-center justify-center rounded-full text-[13px] font-semibold"
        style={{
          background: "var(--color-secondary)",
          color: dim
            ? "color-mix(in oklab, var(--color-foreground) 55%, transparent)"
            : "var(--color-foreground)",
        }}
      >
        {initials}
      </span>
      {live && (
        <span
          className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2"
          style={{
            background: "var(--color-presence)",
            // @ts-expect-error css var
            "--tw-ring-color": "var(--color-background)",
            boxShadow: "0 0 0 2px var(--color-background)",
          }}
        />
      )}
    </span>
  );
}

// ============ DOCTOR (unchanged behavior) ============

function DoctorCoverage({ tab, setTab }: { tab: TabId; setTab: (t: TabId) => void }) {
  const filtered = DOCTOR_ITEMS.filter((i) =>
    tab === "completed" ? i.status === "completed" : i.status === tab,
  );

  return (
    <section className="relative h-full w-full overflow-hidden bg-background">
      <CoverageHeader subtitle="Your dispatch timeline" tab={tab} setTab={setTab} />
      <div
        className="mx-auto mt-3 max-w-md overflow-y-auto px-5 pb-6"
        style={{ height: "calc(100% - 140px)" }}
      >
        {filtered.length === 0 ? (
          <EmptyState tab={tab} role="cover" />
        ) : (
          <ul className="space-y-2">
            {filtered.map((item) => (
              <li key={item.id}>
                <DoctorRow item={item} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function DoctorRow({ item }: { item: DoctorItem }) {
  const isLive = item.status === "active";
  return (
    <div
      className="flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left"
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
            <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
            <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium">{item.facility}</div>
        <div className="text-[12.5px] text-muted-foreground">
          {item.role} · {item.area}
        </div>
      </span>
      <span
        className="shrink-0 text-[12px] font-medium"
        style={{ color: isLive ? "var(--color-presence)" : "var(--color-foreground)" }}
      >
        {item.when}
      </span>
    </div>
  );
}

// ============ Shared shell ============

function CoverageHeader({
  subtitle,
  tab,
  setTab,
}: {
  subtitle: string;
  tab: TabId;
  setTab: (t: TabId) => void;
}) {
  return (
    <header className="safe-top px-5 pt-4">
      <div className="mx-auto max-w-md">
        <h1 className="text-[26px] font-semibold tracking-tight">Coverage</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{subtitle}</p>

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
  );
}

function EmptyState({ tab, role }: { tab: TabId; role: Role }) {
  const copy = (
    role === "cover"
      ? {
          active: "No live coverage right now.",
          upcoming: "Nothing scheduled.",
          completed: "Your history will appear here.",
        }
      : {
          active: "No active coverage right now.",
          upcoming: "No upcoming coverage scheduled.",
          completed: "Your past coverage will appear here.",
        }
  )[tab];
  return (
    <div className="flex h-64 flex-col items-center justify-center text-center">
      <div
        className="flex h-12 w-12 items-center justify-center rounded-full"
        style={{ background: "var(--color-secondary)" }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-muted-foreground">
          <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
          <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </div>
      <p className="mt-3 text-[13.5px] text-muted-foreground">{copy}</p>
    </div>
  );
}
