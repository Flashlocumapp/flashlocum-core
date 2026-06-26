// Client-side 1-hour pre-shift reminder scheduler.
//
// Server-side push (via `/api/public/hooks/shift-reminders`) only fires for
// users who have granted push permission and registered a device token. When
// either user is actively inside the app — but without push — they would
// receive nothing. This module schedules an in-process timer for every
// confirmed shift the current user is party to and fires through the canonical
// feedback engine at T-60min, so foreground users always see the reminder.
//
// Dedup with server push is handled by the feedback ledger: the canonical
// event uses `entityId = requestId` and `version = startTs`, so an identical
// push delivered moments later coalesces (G4/G5).
//
// Lifecycle:
//   - Mount once at app shell load (mountPreshiftReminderScheduler()).
//   - Subscribes to coverage-remote snapshots; re-evaluates timers on every
//     snapshot change, on tab focus / visibility change.
//   - Skips rows already past T-60, already fired this session, or in a
//     non-confirmed status (broadcasting / completed / cancelled / expired).

import { subscribeCoverageRemote } from "@/lib/coverage-remote";
import { getCurrentUserIdSync, onUserIdChange } from "@/lib/coverage-remote";
import { fromLocal, ingest } from "@/lib/feedback";
import type { NetRequest } from "@/lib/network";

const REMINDER_LEAD_MS = 60 * 60 * 1000; // 1 hour
const MAX_SCHEDULE_AHEAD_MS = 7 * 24 * 60 * 60 * 1000; // skip beyond 7 days

type TimerKey = string; // `${requestId}:${startTs}`

const timers = new Map<TimerKey, ReturnType<typeof setTimeout>>();
const firedKeys = new Set<TimerKey>();

function keyFor(id: string, startTs: number): TimerKey {
  return `${id}:${startTs}`;
}

function isConfirmedActive(r: NetRequest): boolean {
  return r.status === "accepted" || r.status === "active" || r.status === "paused";
}

function applyReminder(r: NetRequest, isDoctor: boolean) {
  ingest(
    fromLocal({
      kind: "reminder.preshift",
      entityId: r.id,
      audience: isDoctor ? "doctor" : "requester",
      version: r.startTs ?? Date.now(),
      ctx: {
        hospitalName: r.hospital,
        // doctorName isn't on NetRequest; fallback to a generic label
        doctorName: "Your doctor",
      },
    }),
  );
}

function scheduleOne(r: NetRequest, uid: string) {
  if (!r.startTs) return;
  if (!isConfirmedActive(r)) return;
  const isRequester = r.requesterSessionId === uid;
  const isDoctor = r.acceptedBy === uid;
  if (!isRequester && !isDoctor) return;

  const fireAt = r.startTs - REMINDER_LEAD_MS;
  const delay = fireAt - Date.now();
  const key = keyFor(r.id, r.startTs);

  // Already fired this session — leave it. The feedback ledger handles
  // any back-end push that arrives later.
  if (firedKeys.has(key)) return;

  // Past the lead window already — never schedule retroactively, that
  // would surprise the user mid-shift.
  if (delay <= 0) return;

  // Too far out — defer; next snapshot tick will pick it up when closer.
  if (delay > MAX_SCHEDULE_AHEAD_MS) return;

  // Already scheduled — leave the existing timer in place (same key →
  // same fire moment).
  if (timers.has(key)) return;

  const t = setTimeout(() => {
    timers.delete(key);
    firedKeys.add(key);
    applyReminder(r, isDoctor);
  }, delay);
  timers.set(key, t);
}

function reconcileTimers(rows: NetRequest[]) {
  const uid = getCurrentUserIdSync();
  if (!uid) {
    clearAll();
    return;
  }

  // Build the set of keys that SHOULD remain scheduled given current rows.
  const valid = new Set<TimerKey>();
  for (const r of rows) {
    if (!r.startTs) continue;
    if (!isConfirmedActive(r)) continue;
    const involved = r.requesterSessionId === uid || r.acceptedBy === uid;
    if (!involved) continue;
    valid.add(keyFor(r.id, r.startTs));
  }

  // Cancel timers that no longer apply (status changed away from
  // accepted/active/paused, row vanished, or startTs was edited).
  for (const [key, t] of timers) {
    if (!valid.has(key)) {
      clearTimeout(t);
      timers.delete(key);
    }
  }

  // Schedule any new/applicable rows.
  for (const r of rows) scheduleOne(r, uid);
}

function clearAll() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
}

let mounted = false;
let lastRows: NetRequest[] = [];

/**
 * Idempotent mount. Safe to call from React StrictMode / multiple shells —
 * a second call is a no-op.
 */
export function mountPreshiftReminderScheduler(): () => void {
  if (mounted) return () => undefined;
  mounted = true;

  const unsubSnapshot = subscribeCoverageRemote({
    onSnapshot: (rows) => {
      lastRows = rows;
      reconcileTimers(rows);
    },
    onEvent: () => {
      // Snapshot subscription drives the reconcile; events don't need
      // their own path because every event upserts the snapshot.
    },
  });

  const onVisible = () => {
    if (typeof document === "undefined") return;
    if (document.visibilityState === "visible") reconcileTimers(lastRows);
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisible);
  }

  const unsubUser = onUserIdChange(() => reconcileTimers(lastRows));

  return () => {
    mounted = false;
    unsubSnapshot();
    unsubUser();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisible);
    }
    clearAll();
    firedKeys.clear();
  };
}
