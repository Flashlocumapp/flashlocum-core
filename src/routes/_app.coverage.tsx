import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { getRole, type Role } from "@/lib/role";
import { ShiftSettlement } from "@/features/request/ShiftSettlement";
import { fmtNairaK, fmtShiftMeta, shortWeekdays } from "@/lib/format";
import { CancelFlow } from "@/components/CancelFlow";
import { HistoryDetailSheet, type HistoryDetail } from "@/components/HistoryDetailSheet";
import { EditShiftSheet, type EditableShift } from "@/components/EditShiftSheet";
import { DismissSheet } from "@/components/DismissSheet";
import {
  cancelUpcoming,
  nairaK,
  useDispatch,
  type Coverage as CoverItem,
  type HistoryItem,
} from "@/features/cover/dispatch";

export const Route = createFileRoute("/_app/coverage")({
  component: CoverageScreen,
});

// (Doctor placeholder items removed — driven by live simulation only.)

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

// Placeholder records removed — populated only through live simulation.
const INITIAL_REQUESTS: RequestItem[] = [];

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
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [cancelTargetId, setCancelTargetId] = useState<string | null>(null);
  const [editTargetId, setEditTargetId] = useState<string | null>(null);
  const [editInitial, setEditInitial] = useState<EditableShift>({
    timing: "08:00", duration: 1, accommodation: false, note: "",
  });
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const filtered = useMemo(
    () => items.filter((i) => i.status === tab),
    [items, tab],
  );

  const settling = items.find((i) => i.id === settlingId) ?? null;
  const historyItem = items.find((i) => i.id === historyId) ?? null;
  const historyDetail: HistoryDetail | null = historyItem
    ? {
        id: historyItem.id,
        doctor: historyItem.doctor,
        mdcn: historyItem.mdcn,
        initials: historyItem.initials,
        coverage: historyItem.coverage,
        completedOn: historyItem.completedOn,
        amount: historyItem.amount,
        rating: ratings[historyItem.id],
      }
    : null;

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

  const beginEndShift = (id: string) => setSettlingId(id);

  const confirmEnd = () => {
    if (!settlingId) return;
    setItems((prev) =>
      prev.map((i) =>
        i.id === settlingId
          ? {
              ...i,
              status: "completed",
              completedOn: new Date().toLocaleDateString("en-NG", {
                weekday: "short", day: "2-digit", month: "short",
              }),
            }
          : i,
      ),
    );
  };

  const openEdit = (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    setEditInitial({ timing: "08:00", duration: 1, accommodation: false, note: "" });
    setEditTargetId(id);
  };

  const handleEditSave = (next: EditableShift, changed: keyof EditableShift | "multiple") => {
    setEditTargetId(null);
    const label: Record<keyof EditableShift | "multiple", string> = {
      timing: "Coverage timing updated",
      duration: "Coverage duration updated",
      accommodation: "Accommodation updated",
      note: "Coverage notes updated",
      multiple: "Coverage details updated",
    };
    setNotice(`${label[changed]} · Doctor notified`);
    window.setTimeout(() => setNotice(null), 2600);
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
                    onCancel={() => setCancelTargetId(item.id)}
                    onEdit={() => openEdit(item.id)}
                    onOpenHistory={() => setHistoryId(item.id)}
                  />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>

      <AnimatePresence>
        {notice && (
          <motion.div
            key={notice}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-x-0 bottom-24 z-30 mx-auto flex max-w-md justify-center px-5"
          >
            <span
              className="flex items-center gap-2 rounded-full px-3.5 py-2 text-[12px] font-medium shadow-[0_4px_18px_rgba(0,0,0,0.10)]"
              style={{
                background: "var(--color-surface-elevated)",
                color: "var(--color-foreground)",
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--color-presence)" }}
              />
              {notice}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <ShiftSettlement
        open={!!settling}
        onClose={() => setSettlingId(null)}
        initialPhase="settlement"
        onConfirmed={confirmEnd}
        onRebook={() => setSettlingId(null)}
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

      <CancelFlow
        open={!!cancelTargetId}
        onDismiss={() => setCancelTargetId(null)}
        confirmTitle="Cancel this shift?"
        confirmBody="The assigned doctor will be notified. Keeping it preserves continuity."
        primaryLabel="Keep Shift"
        secondaryLabel="Cancel Shift"
        onCancelled={() => {
          const id = cancelTargetId;
          setCancelTargetId(null);
          if (id) setItems((prev) => prev.filter((i) => i.id !== id));
        }}
      />

      <EditShiftSheet
        open={!!editTargetId}
        initial={editInitial}
        onDismiss={() => setEditTargetId(null)}
        onSave={handleEditSave}
      />

      <HistoryDetailSheet
        open={!!historyDetail}
        item={historyDetail}
        onDismiss={() => setHistoryId(null)}
        onRate={(id, rating) => {
          setRatings((prev) => ({ ...prev, [id]: rating }));
          setHistoryId(null);
        }}
        onRebook={() => {
          setHistoryId(null);
          window.location.assign("/home");
        }}
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
  onOpenHistory,
}: {
  item: RequestItem;
  onStart: () => void;
  onEnd: () => void;
  onCancel: () => void;
  onEdit: () => void;
  onOpenHistory: () => void;
}) {
  const isActive = item.status === "active";
  const isUpcoming = item.status === "upcoming";
  const isHistory = item.status === "completed";

  const meta = isHistory
    ? `${item.coverage} · ${shortWeekdays(item.completedOn ?? "")} · ${fmtNairaK(item.amount)}`
    : isActive
      ? `${item.coverage} · Active · ${fmtNairaK(item.amount)}`
      : fmtShiftMeta(item.coverage, item.schedule, item.amount);

  const Wrapper: React.ElementType = isHistory ? "button" : "div";
  const wrapperProps = isHistory
    ? { onClick: onOpenHistory, type: "button" as const }
    : {};

  return (
    <Wrapper
      {...wrapperProps}
      className={`block w-full rounded-2xl px-3.5 py-3 text-left ${isHistory ? "transition-colors active:bg-secondary/40" : ""}`}
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
    </Wrapper>
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

// ============ DOCTOR (Cover & Earn) ============

function DoctorCoverage({ tab, setTab }: { tab: TabId; setTab: (t: TabId) => void }) {
  const { upcoming, history } = useDispatch();

  const active = upcoming.find((c) => c.active) ?? null;
  const upcomingOnly = upcoming.filter((c) => !c.active);

  const [cancelId, setCancelId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  // Detail can be either a live coverage (active/upcoming) or a history entry.
  const detail: CoverItem | HistoryItem | null =
    upcoming.find((c) => c.id === detailId) ??
    history.find((h) => h.id === detailId) ??
    null;

  return (
    <section className="relative h-full w-full overflow-hidden bg-background">
      <CoverageHeader subtitle="Your operational coverage" tab={tab} setTab={setTab} />
      <div
        className="mx-auto mt-3 max-w-md overflow-y-auto px-5 pb-6"
        style={{ height: "calc(100% - 140px)" }}
      >
        {(tab === "active" ? (active ? 1 : 0) : tab === "upcoming" ? upcomingOnly.length : history.length) === 0 ? (
          <EmptyState tab={tab} role="cover" />
        ) : (
          <ul className="space-y-2.5">
            {tab === "active" && active && (
              <li key={active.id}>
                <CoverCard
                  item={active}
                  variant="active"
                  onCancel={() => setCancelId(active.id)}
                  onOpenDetail={() => setDetailId(active.id)}
                />
              </li>
            )}
            {tab === "upcoming" &&
              upcomingOnly.map((c) => (
                <li key={c.id}>
                  <CoverCard
                    item={c}
                    variant="upcoming"
                    onCancel={() => setCancelId(c.id)}
                    onOpenDetail={() => setDetailId(c.id)}
                  />
                </li>
              ))}
            {tab === "completed" &&
              history.map((h) => (
                <li key={h.id}>
                  <CoverCard
                    item={h}
                    variant="history"
                    onOpenDetail={() => setDetailId(h.id)}
                  />
                </li>
              ))}
          </ul>
        )}
      </div>

      <CancelFlow
        open={!!cancelId}
        onDismiss={() => setCancelId(null)}
        confirmTitle="Cancel this shift?"
        confirmBody="Frequent cancellations affect your reliability score. The requester will be notified immediately."
        primaryLabel="Keep Shift"
        secondaryLabel="Cancel Shift"
        reasonTitle="Reason for cancellation"
        reasons={["Emergency", "Illness", "Transport issue", "Schedule conflict", "Other"]}
        onCancelled={(reason) => {
          const id = cancelId;
          setCancelId(null);
          if (id) cancelUpcoming(id, reason);
        }}
      />

      <DoctorCoverageDetail
        item={detail}
        onDismiss={() => setDetailId(null)}
      />
    </section>
  );
}

function CoverCard({
  item,
  variant,
  onCancel,
  onOpenDetail,
}: {
  item: CoverItem | HistoryItem;
  variant: "active" | "upcoming" | "history";
  onCancel?: () => void;
  onOpenDetail?: () => void;
}) {
  const isHistory = variant === "history";
  const isActive = variant === "active";
  const isUpcoming = variant === "upcoming";

  const meta = `${item.coverage} · ${item.day} · ${item.start} · ${item.durationHrs}hr · ${nairaK(item.amount)}`;

  // All cards tappable — open detail. Inner buttons stopPropagation.
  const Wrapper: React.ElementType = "button";
  const wrapperProps = { onClick: onOpenDetail, type: "button" as const };

  const outcomeChip =
    isHistory && (item as HistoryItem).outcome === "cancelled" ? (
      <span
        className="ml-2 inline-flex h-5 items-center rounded-full px-2 text-[10.5px] font-medium uppercase tracking-[0.08em]"
        style={{
          background: "color-mix(in oklab, var(--color-foreground) 7%, transparent)",
          color: "color-mix(in oklab, var(--color-foreground) 60%, transparent)",
        }}
      >
        Cancelled
      </span>
    ) : null;

  return (
    <Wrapper
      {...wrapperProps}
      className="block w-full rounded-2xl px-4 py-3.5 text-left transition-colors active:bg-secondary/30"
      style={{
        background: isHistory
          ? "color-mix(in oklab, var(--color-surface-elevated) 65%, transparent)"
          : "var(--color-surface-elevated)",
        boxShadow: isHistory ? "none" : "0 4px 16px -10px rgba(0,0,0,0.12)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center">
            <span
              className="truncate text-[15.5px] font-semibold tracking-tight"
              style={{
                color: isHistory
                  ? "color-mix(in oklab, var(--color-foreground) 80%, transparent)"
                  : "var(--color-foreground)",
              }}
            >
              {item.hospital}
            </span>
            {outcomeChip}
          </div>
          <div className="text-[12.5px] text-muted-foreground">{item.area}</div>
        </div>
        {isActive && (
          <span
            className="flex shrink-0 items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.14em]"
            style={{ color: "var(--color-presence)" }}
          >
            <span
              className="relative h-1.5 w-1.5 rounded-full"
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
            Live
          </span>
        )}
      </div>

      <div
        className="mt-1.5 text-[12.5px] leading-snug"
        style={{
          color: isHistory
            ? "color-mix(in oklab, var(--color-foreground) 60%, transparent)"
            : "color-mix(in oklab, var(--color-foreground) 75%, transparent)",
        }}
      >
        {meta}
      </div>

      {item.note && (
        <div className="mt-1 text-[11.5px] leading-snug text-foreground/65">
          {item.note}
        </div>
      )}

      {isActive && (
        <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground">
          Ensure requester ends the shift before leaving the building.
        </p>
      )}

      {(isActive || isUpcoming) && (
        <div className="mt-3 flex items-center gap-2">
          {isUpcoming && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCancel?.();
              }}
              className="h-8 rounded-full px-3.5 text-[12.5px] font-medium transition-colors active:opacity-80"
              style={{
                background: "color-mix(in oklab, var(--color-foreground) 6%, transparent)",
                color: "color-mix(in oklab, var(--color-foreground) 80%, transparent)",
              }}
            >
              Cancel Coverage
            </button>
          )}
          <a
            href={`tel:${item.phone}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-medium transition-colors active:opacity-80"
            style={{
              background: isActive ? "var(--color-foreground)" : "color-mix(in oklab, var(--color-foreground) 6%, transparent)",
              color: isActive ? "var(--color-background)" : "color-mix(in oklab, var(--color-foreground) 85%, transparent)",
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
    </Wrapper>
  );
}

function DoctorHistoryDetail({
  item,
  onDismiss,
}: {
  item: HistoryItem | null;
  onDismiss: () => void;
}) {
  return (
    <AnimatePresence>
      {item && (
        <DismissSheet open onDismiss={onDismiss}>
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {item.outcome === "cancelled" ? "Cancelled coverage" : "Completed coverage"}
          </div>
          <div className="mt-2 text-[20px] font-semibold tracking-tight">
            {item.hospital}
          </div>
          <div className="text-[13px] text-muted-foreground">{item.area}</div>

          <div className="mt-4 text-[13px] leading-relaxed text-foreground/80">
            {item.coverage} · {item.day} · {item.start} · {item.durationHrs}hr
          </div>

          <div className="mt-4 space-y-2 rounded-2xl bg-secondary/60 px-4 py-3">
            <DetailRow label="Amount" value={nairaK(item.amount)} />
            <DetailRow label="Settlement" value={item.settlementStatus} />
            <DetailRow label="Completed" value={item.completedOn} />
            {item.rating !== undefined && (
              <DetailRow
                label="Rating"
                value={"★".repeat(item.rating) + "☆".repeat(5 - item.rating)}
              />
            )}
          </div>

          {item.note && (
            <p className="mt-3 text-[12.5px] text-muted-foreground">
              Note · {item.note}
            </p>
          )}
        </DismissSheet>
      )}
    </AnimatePresence>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className="text-[13.5px] font-medium tabular-nums">{value}</span>
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
