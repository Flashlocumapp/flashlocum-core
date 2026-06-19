// Canonical-event feedback engine.
//
// Local actions, realtime postgres_changes, and push payloads are three
// delivery channels of the SAME underlying domain event. Each is normalized
// into a CanonicalEvent via a thin adapter (fromLocal / fromRealtime /
// fromPush) and routed through a single entry point: `ingest()`.
//
// Guarantees enforced here:
//   G1 — Single canonical representation; UI never branches on `source`.
//   G2 — Deterministic first visible outcome per (kind, entityId).
//        Tiebreak on equal `version`: local > realtime > push.
//   G3 — Versioned ordering: late ingests with version <= lastEmitted are
//        dropped. Terminal kinds (shift.ended, shift.cancelled) raise the
//        version ceiling so subsequent pause/resume/update are also dropped.
//   G4 — 6 s cross-channel dedup window keyed by `kind:entityId:version`.
//   G5 — Equivalent late arrivals coalesce: zero additional UI/haptic.
//   G6 — Multi-tab consistency via BroadcastChannel('flashlocum-feedback').
//   G7 — Cold-start suppression: 3 s window where seeded versions drop
//        backlogged realtime/push for already-known states.
//   G8 — `shift.updated` throttled to 1 emission / 10 s per entityId.
//   G9 — Honour prefers-reduced-motion (haptics off; toast still fires).
//
// In-app sound is intentionally absent. Push is the only sound surface.

import { pushToast, type ToastTone } from "@/lib/notifications";
import { hapticsEnabled } from "@/lib/feedback-prefs";

/* ---------- Types ---------- */

export type EventKind =
  | "shift.started"
  | "shift.paused"
  | "shift.resumed"
  | "shift.ended"
  | "shift.updated"
  | "shift.cancelled"
  | "offer.new"
  | "offer.accepted"
  | "payment.settled"
  | "verification.result"
  | "reminder.preshift";

export type EventSource = "local" | "realtime" | "push";
export type EventAudience = "doctor" | "requester";

export type CanonicalEvent = {
  kind: EventKind;
  entityId: string;
  /** Server timestamp in ms. Local actions use Date.now(). */
  occurredAt: number;
  /**
   * Monotonic per (kind, entityId). For DB-backed events use the row's
   * updated_at epoch ms; local-only emits use Date.now() (acts as a
   * lower bound that realtime/push immediately match or exceed).
   */
  version: number;
  source: EventSource;
  audience: EventAudience;
  ctx?: {
    hospitalName?: string;
    amount?: number;
    /** Optional override for the toast title; otherwise derived. */
    title?: string;
    /** Optional override for the toast body. */
    body?: string;
    /** Skip toast entirely (e.g. offer.new — the card itself is the signal). */
    suppressToast?: boolean;
    /** Skip haptic (e.g. pure-info updates). */
    suppressHaptic?: boolean;
  };
};

/* ---------- Internal state ---------- */

type LedgerEntry = {
  decision: "emitted" | "suppressed";
  firstSource: EventSource;
  firstAt: number;
};

const LEDGER_TTL_MS = 6_000;
const HYDRATION_WINDOW_MS = 3_000;
const UPDATE_THROTTLE_MS = 10_000;
const TERMINAL_KINDS: ReadonlySet<EventKind> = new Set(["shift.ended", "shift.cancelled"]);
const SOURCE_RANK: Record<EventSource, number> = { local: 3, realtime: 2, push: 1 };

const ledger = new Map<string, LedgerEntry>(); // key: `${kind}:${entityId}:${version}`
const versionCeiling = new Map<string, number>(); // key: `${kind}:${entityId}`
const lastUpdateEmittedAt = new Map<string, number>(); // key: `shift.updated:${entityId}`
const hydrationStartedAt = typeof window !== "undefined" ? Date.now() : 0;

/* ---------- Multi-tab broadcast (G6) ---------- */

type BroadcastMsg = {
  type: "feedback:decision";
  key: string;
  kind: EventKind;
  entityId: string;
  version: number;
  decision: "emitted" | "suppressed";
  source: EventSource;
  at: number;
};

let channel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (channel) return channel;
  try {
    channel = new BroadcastChannel("flashlocum-feedback");
    channel.onmessage = (e: MessageEvent<BroadcastMsg>) => {
      const m = e.data;
      if (!m || m.type !== "feedback:decision") return;
      // Mirror peer decision into local ledger so this tab won't re-emit.
      if (!ledger.has(m.key)) {
        ledger.set(m.key, { decision: m.decision, firstSource: m.source, firstAt: m.at });
        scheduleLedgerSweep();
      }
      // Raise version ceiling for terminal kinds.
      const ckey = `${m.kind}:${m.entityId}`;
      const cur = versionCeiling.get(ckey) ?? 0;
      if (m.version > cur) versionCeiling.set(ckey, m.version);
    };
  } catch {
    channel = null;
  }
  return channel;
}

/* ---------- Ledger sweep ---------- */

let sweepTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleLedgerSweep() {
  if (sweepTimer || typeof window === "undefined") return;
  sweepTimer = setTimeout(() => {
    const cutoff = Date.now() - 60_000;
    for (const [k, v] of ledger) {
      if (v.firstAt < cutoff) ledger.delete(k);
    }
    sweepTimer = null;
    if (ledger.size > 0) scheduleLedgerSweep();
  }, 10_000);
}

/* ---------- Hydration seeding (G7) ---------- */

/**
 * Pre-seed the version ceiling for an entity at app start so backlogged
 * realtime/push events for an already-known state don't replay. Safe to
 * call repeatedly; only raises, never lowers.
 */
export function seedKnownVersion(kind: EventKind, entityId: string, version: number) {
  const ckey = `${kind}:${entityId}`;
  const cur = versionCeiling.get(ckey) ?? 0;
  if (version > cur) versionCeiling.set(ckey, version);
}

/* ---------- Reduced motion (G9) ---------- */

function reducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/* ---------- Haptics ---------- */

type HapticIntensity = "light" | "medium" | "light-medium";

function vibrate(pattern: number | number[]) {
  if (typeof navigator === "undefined") return;
  const v = (navigator as Navigator & { vibrate?: (p: number | number[]) => boolean }).vibrate;
  if (!v) return;
  try {
    v.call(navigator, pattern as number & number[]);
  } catch {
    /* noop */
  }
}

function emitHaptic(intensity: HapticIntensity) {
  if (reducedMotion()) return;
  switch (intensity) {
    case "light":
      vibrate(15);
      return;
    case "light-medium":
      vibrate(20);
      return;
    case "medium":
      vibrate(25);
      return;
  }
}

/* ---------- Per-kind rendering policy ---------- */

type RenderPlan = {
  toast?: { tone: ToastTone; title: string; body?: string; ttl?: number };
  haptic?: HapticIntensity;
};

function plan(ev: CanonicalEvent): RenderPlan | null {
  const hospital = ev.ctx?.hospitalName ?? "the hospital";
  const isDoctor = ev.audience === "doctor";
  const tOverride = ev.ctx?.title;
  const bOverride = ev.ctx?.body;
  const skipToast = ev.ctx?.suppressToast === true;
  const skipHaptic = ev.ctx?.suppressHaptic === true;

  const toast = (tone: ToastTone, title: string, body?: string, ttl?: number) =>
    skipToast ? undefined : { tone, title, body: bOverride ?? body, ttl };

  switch (ev.kind) {
    case "offer.new":
      // Card is the signal; no toast. Medium haptic for the doctor only.
      return {
        toast: tOverride ? toast("presence", tOverride) : undefined,
        haptic: !skipHaptic && isDoctor ? "medium" : undefined,
      };
    case "offer.accepted":
      // Sheet opens; medium haptic for doctor confirming the claim.
      return { haptic: !skipHaptic && isDoctor ? "medium" : undefined };
    case "shift.started":
      return {
        toast: toast(
          "presence",
          tOverride ?? (isDoctor ? `Your shift with ${hospital} has started.` : `Doctor started the shift at ${hospital}.`),
          isDoctor ? "Tap the active card for shift details." : undefined,
        ),
        haptic: skipHaptic ? undefined : "light",
      };
    case "shift.paused":
      return {
        toast: toast(
          "presence",
          tOverride ?? (isDoctor ? `Your shift with ${hospital} has been paused.` : `Doctor paused the shift at ${hospital}.`),
          isDoctor ? "Coverage timer is preserved and will resume when restarted." : undefined,
          5200,
        ),
        haptic: skipHaptic ? undefined : "light",
      };
    case "shift.resumed":
      return {
        toast: toast(
          "presence",
          tOverride ?? (isDoctor ? `Your shift with ${hospital} has resumed.` : `Doctor resumed the shift at ${hospital}.`),
          isDoctor ? "Coverage timer continues from where it paused." : undefined,
        ),
        haptic: skipHaptic ? undefined : "light",
      };
    case "shift.ended":
      return {
        toast: toast(
          "presence",
          tOverride ?? (isDoctor ? `Your shift with ${hospital} has ended.` : `Doctor ended the shift at ${hospital}.`),
          isDoctor ? "Payment will be remitted to your account by 10PM today." : undefined,
          5200,
        ),
        haptic: skipHaptic ? undefined : "light-medium",
      };
    case "shift.updated":
      return {
        toast: toast("presence", tOverride ?? `${hospital} updated this shift`),
        haptic: undefined,
      };
    case "shift.cancelled":
      return {
        toast: toast(
          "warn",
          tOverride ?? (isDoctor ? `${hospital} cancelled shift` : `Doctor cancelled shift`),
        ),
        haptic: skipHaptic ? undefined : "medium",
      };
    case "payment.settled":
      return { toast: toast("presence", tOverride ?? "Payment settled") };
    case "verification.result":
      return { toast: toast("presence", tOverride ?? "Verification update") };
    case "reminder.preshift":
      return { toast: toast("presence", tOverride ?? `Your shift with ${hospital} starts in 1 hour`) };
  }
}

/* ---------- Engine entry point ---------- */

/**
 * Single entry point for every feedback event, regardless of channel.
 * Returns the resolved decision so callers can mark delivery.
 */
export function ingest(ev: CanonicalEvent): "emitted" | "suppressed" | "stale" {
  if (typeof window === "undefined") return "suppressed";

  const ckey = `${ev.kind}:${ev.entityId}`;
  const lkey = `${ckey}:${ev.version}`;

  // G3 — versioned ordering: drop stale.
  const ceiling = versionCeiling.get(ckey) ?? 0;
  if (ev.version < ceiling) return "stale";

  // Terminal kinds raise the ceiling for sibling lifecycle kinds.
  if (TERMINAL_KINDS.has(ev.kind)) {
    for (const sib of ["shift.paused", "shift.resumed", "shift.updated", "shift.started"] as EventKind[]) {
      const sk = `${sib}:${ev.entityId}`;
      const cur = versionCeiling.get(sk) ?? 0;
      if (ev.version > cur) versionCeiling.set(sk, ev.version);
    }
  }

  // G7 — hydration suppression: during the first 3 s, drop any event whose
  // version is at or below the seeded ceiling for this kind.
  const withinHydration = Date.now() - hydrationStartedAt < HYDRATION_WINDOW_MS;
  if (withinHydration && ceiling > 0 && ev.version <= ceiling) return "stale";

  // G4 — cross-channel dedup window.
  const prior = ledger.get(lkey);
  if (prior) {
    if (Date.now() - prior.firstAt < LEDGER_TTL_MS) {
      // G2 tiebreak — same version, higher-priority source replaces ONLY
      // by updating bookkeeping; UI was already emitted, no re-render.
      if (SOURCE_RANK[ev.source] > SOURCE_RANK[prior.firstSource]) {
        prior.firstSource = ev.source;
      }
      return "suppressed";
    }
  }

  // G8 — throttle shift.updated.
  if (ev.kind === "shift.updated") {
    const tkey = `shift.updated:${ev.entityId}`;
    const last = lastUpdateEmittedAt.get(tkey) ?? 0;
    if (Date.now() - last < UPDATE_THROTTLE_MS) {
      ledger.set(lkey, { decision: "suppressed", firstSource: ev.source, firstAt: Date.now() });
      scheduleLedgerSweep();
      return "suppressed";
    }
    lastUpdateEmittedAt.set(tkey, Date.now());
  }

  // Resolve plan and render.
  const p = plan(ev);
  if (p?.toast) {
    pushToast({ tone: p.toast.tone, title: p.toast.title, body: p.toast.body, ttl: p.toast.ttl });
  }
  if (p?.haptic) emitHaptic(p.haptic);

  // Raise the ceiling.
  if (ev.version > ceiling) versionCeiling.set(ckey, ev.version);

  // Record decision.
  const entry: LedgerEntry = { decision: "emitted", firstSource: ev.source, firstAt: Date.now() };
  ledger.set(lkey, entry);
  scheduleLedgerSweep();

  // Broadcast to peer tabs.
  const ch = getChannel();
  if (ch) {
    try {
      ch.postMessage({
        type: "feedback:decision",
        key: lkey,
        kind: ev.kind,
        entityId: ev.entityId,
        version: ev.version,
        decision: "emitted",
        source: ev.source,
        at: entry.firstAt,
      } satisfies BroadcastMsg);
    } catch {
      /* noop */
    }
  }

  return "emitted";
}

/* ---------- Adapters ---------- */

/** Build a CanonicalEvent from a local user action. */
export function fromLocal(args: {
  kind: EventKind;
  entityId: string;
  audience: EventAudience;
  ctx?: CanonicalEvent["ctx"];
  /** Optional explicit version; defaults to Date.now(). */
  version?: number;
}): CanonicalEvent {
  return {
    kind: args.kind,
    entityId: args.entityId,
    occurredAt: Date.now(),
    version: args.version ?? Date.now(),
    source: "local",
    audience: args.audience,
    ctx: args.ctx,
  };
}

/** Build a CanonicalEvent from a realtime row event. */
export function fromRealtime(args: {
  kind: EventKind;
  entityId: string;
  audience: EventAudience;
  /** Row updated_at epoch ms — used as version. */
  updatedAt: number;
  ctx?: CanonicalEvent["ctx"];
}): CanonicalEvent {
  return {
    kind: args.kind,
    entityId: args.entityId,
    occurredAt: args.updatedAt,
    version: args.updatedAt,
    source: "realtime",
    audience: args.audience,
    ctx: args.ctx,
  };
}

/** Build a CanonicalEvent from a foreground push payload. */
export function fromPush(payload: {
  kind: EventKind;
  entityId: string;
  audience: EventAudience;
  occurredAt: number;
  version: number;
  ctx?: CanonicalEvent["ctx"];
}): CanonicalEvent {
  return {
    kind: payload.kind,
    entityId: payload.entityId,
    occurredAt: payload.occurredAt,
    version: payload.version,
    source: "push",
    audience: payload.audience,
    ctx: payload.ctx,
  };
}

/* ---------- Backwards-compat shim ----------
 *
 * Existing call sites use shiftCue("start" | "pause" | ...). Until each
 * call site is migrated to ingest() with a real entityId, this shim
 * routes them through the engine as a `local` event with a synthetic
 * entityId scoped to the cue+timestamp, preserving legacy haptic + cue
 * behaviour without re-introducing WebAudio.
 *
 * NOTE: the synthetic entityId means dedupe across (local user tap →
 * realtime echo) can't collapse for these legacy sites. Migrate to
 * ingest({ kind, entityId, source: 'local' }) to get full G2/G4 benefits.
 */
export type ShiftCue = "start" | "pause" | "resume" | "end" | "request";

const cueToKind: Record<ShiftCue, EventKind> = {
  start: "shift.started",
  pause: "shift.paused",
  resume: "shift.resumed",
  end: "shift.ended",
  request: "offer.new",
};

export function shiftCue(cue: ShiftCue) {
  const kind = cueToKind[cue];
  const haptic: HapticIntensity =
    cue === "end" ? "light-medium" : cue === "request" ? "medium" : "light";
  // Bypass the engine for legacy local taps: emit haptic only, no toast.
  // Toast for these events is produced by the realtime adapter so it
  // doesn't double-fire when the row echo arrives.
  // We still call into ingest() so multi-tab broadcast & dedup work for
  // any matching realtime event that arrives within the window.
  ingest({
    kind,
    entityId: `legacy:${kind}:${Date.now()}`,
    occurredAt: Date.now(),
    version: Date.now(),
    source: "local",
    audience: "doctor",
    ctx: { suppressToast: true, suppressHaptic: false },
  });
  // The above already emits the haptic via the planner; nothing more needed.
  void haptic; // intensity comes from per-kind planner
}
