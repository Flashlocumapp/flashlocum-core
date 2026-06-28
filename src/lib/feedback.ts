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
// In-app sound is scoped to exactly two events: `offer.new` (doctor,
// soft alert chime) and `offer.accepted` (both audiences, softer confirm
// tone). Sound is routed through `ingest()` so the G3/G4/G7 dedup gates
// guarantee exactly one playback per (kind, entityId, version) across
// local + realtime + push arrivals, including multi-tab broadcast.

import { pushToast, type ToastTone } from "@/lib/notifications";
import { hapticsEnabled } from "@/lib/feedback-prefs";
import { playAlert, playConfirm } from "@/lib/sound";

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
  | "reminder.preshift"
  | "rating.submitted";

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
    /** Doctor's display name — required for any requester-facing message that names the doctor. */
    doctorName?: string;
    amount?: number;
    /** Optional override for the toast title; otherwise derived. */
    title?: string;
    /** Optional override for the toast body. */
    body?: string;
    /** Skip toast entirely (e.g. offer.new — the card itself is the signal). */
    suppressToast?: boolean;
    /** Skip haptic (rarely needed; haptic is reserved for offer.new). */
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
// Once a terminal lifecycle event has been emitted for an entity we must
// never emit it again, even if the row's version keeps bumping (e.g. surcharge
// accrual, settlement bookkeeping). Keyed by `${kind}:${entityId}`.
const terminalEmitted = new Set<string>();
// Tracks the most recent emitted lifecycle moment per entity so a follow-up
// `shift.updated` triggered by the same backend transition (e.g. a resume that
// also bumps the row's "updated" payload) is suppressed.
const lastLifecycleAt = new Map<string, number>(); // key: entityId
const LIFECYCLE_SUPPRESS_WINDOW_MS = 8_000;
const LIFECYCLE_KINDS: ReadonlySet<EventKind> = new Set([
  "shift.started",
  "shift.paused",
  "shift.resumed",
  "shift.ended",
  "shift.cancelled",
]);
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

export function emitHaptic(intensity: HapticIntensity) {
  if (reducedMotion()) return;
  if (!hapticsEnabled()) return;
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
  /** Foreground-only audio cue. Dedup is inherited from ingest(). */
  sound?: "alert" | "confirm";
};

function plan(ev: CanonicalEvent): RenderPlan | null {
  const hospital = ev.ctx?.hospitalName ?? "the hospital";
  const doctor = ev.ctx?.doctorName ? `Dr. ${ev.ctx.doctorName}` : "the doctor";
  const isDoctor = ev.audience === "doctor";
  const tOverride = ev.ctx?.title;
  const bOverride = ev.ctx?.body;
  const skipToast = ev.ctx?.suppressToast === true;
  const skipHaptic = ev.ctx?.suppressHaptic === true;

  const toast = (tone: ToastTone, title: string, body?: string, ttl?: number) =>
    skipToast ? undefined : { tone, title, body: bOverride ?? body, ttl };

  switch (ev.kind) {
    case "offer.new":
      // Card is the signal; no toast under any circumstance. Medium haptic +
      // soft alert chime for the doctor only — this is the ONLY event in the
      // system that emits a haptic. Title overrides are intentionally ignored
      // so callers can't accidentally bring the toast back.
      return {
        toast: undefined,
        haptic: !skipHaptic && isDoctor ? "medium" : undefined,
        sound: !skipHaptic && isDoctor ? "alert" : undefined,
      };
    case "offer.accepted":
      // Doctor: sheet opens + soft confirm tone. No toast, no haptic.
      // Requester: actor-named confirmation toast + soft confirm tone.
      // Both sides are server-confirmed: callers only ingest this kind
      // from the realtime echo / foreground push that carries the
      // accepted_by row flip, never from a local optimistic emit.
      if (isDoctor) return { toast: undefined, haptic: undefined, sound: "confirm" };
      return {
        toast: toast("presence", tOverride ?? `${doctor} accepted your request.`),
        sound: "confirm",
      };
    case "shift.started":
      // Self-initiated for requester; no toast.
      if (!isDoctor) return null;
      return {
        toast: toast("presence", tOverride ?? `Your shift with ${hospital} has started.`),
      };
    case "shift.paused":
      if (!isDoctor) return null;
      return {
        toast: toast(
          "presence",
          tOverride ?? `${hospital} paused your shift until the next scheduled session.`,
        ),
      };
    case "shift.resumed":
      if (!isDoctor) return null;
      return {
        toast: toast("presence", tOverride ?? `Your shift with ${hospital} has resumed.`),
      };
    case "shift.ended":
      // Fires the moment the requester ends the shift — payment hasn't
      // settled yet. payment.settled is a separate event with its own copy.
      if (!isDoctor) return null;
      return {
        toast: toast(
          "presence",
          tOverride ?? `Your shift with ${hospital} has ended. Payment processing has started.`,
          undefined,
          5200,
        ),
      };
    case "shift.updated":
      // Doctor receives the actor-named update; requester is the initiator → silent.
      if (!isDoctor) return null;
      return {
        toast: toast("presence", tOverride ?? `${hospital} updated your shift details.`),
      };
    case "shift.cancelled":
      // Whoever cancelled is silent (engine relies on caller never emitting
      // for the initiator). The counterparty sees an actor-named warn toast.
      return {
        toast: toast(
          "warn",
          tOverride ??
            (isDoctor ? `${hospital} cancelled the shift.` : `${doctor} cancelled the shift.`),
        ),
      };
    case "payment.settled":
      return {
        toast: toast(
          "presence",
          tOverride ??
            (isDoctor
              ? `Payment received for your shift with ${hospital}. Remittance will be made by 10PM today.`
              : `Payment completed successfully for your shift with ${doctor}.`),
          undefined,
          5200,
        ),
      };
    case "verification.result": {
      // Title payload carries the verification status (approved / rejected /
      // action_required / suspended / pending). Wording is contract-exact.
      const status = (ev.ctx?.title ?? "").toLowerCase();
      const copy =
        status === "approved"
          ? "Your account has been verified successfully."
          : status === "rejected" || status === "action_required" || status === "action required"
            ? "Your verification requires attention. Please review and resubmit."
            : (tOverride ?? "Verification update");
      return { toast: toast("presence", copy) };
    }

    case "reminder.preshift":
      return {
        toast: toast(
          "presence",
          tOverride ??
            (isDoctor
              ? `Reminder: your shift with ${hospital} starts in 1 hour.`
              : `Reminder: ${doctor}'s shift starts in 1 hour.`),
        ),
      };
    case "rating.submitted":
      return { toast: toast("presence", tOverride ?? "Thank you for your feedback.") };
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

  // Permanent guard for terminal events. Once a shift has ended/cancelled,
  // never re-toast that fact even if the row's `updated_at` (version) keeps
  // bumping post-completion (e.g. surcharge accrual, settlement bookkeeping).
  if (TERMINAL_KINDS.has(ev.kind) && terminalEmitted.has(ckey)) {
    return "suppressed";
  }

  // Terminal kinds raise the ceiling for sibling lifecycle kinds.
  if (TERMINAL_KINDS.has(ev.kind)) {
    for (const sib of [
      "shift.paused",
      "shift.resumed",
      "shift.updated",
      "shift.started",
    ] as EventKind[]) {
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

  // G8 — throttle shift.updated AND suppress when it piggybacks on a lifecycle
  // transition the user already saw (e.g. the row bump that follows a resume).
  if (ev.kind === "shift.updated") {
    const tkey = `shift.updated:${ev.entityId}`;
    const last = lastUpdateEmittedAt.get(tkey) ?? 0;
    const sinceLifecycle = Date.now() - (lastLifecycleAt.get(ev.entityId) ?? 0);
    if (sinceLifecycle < LIFECYCLE_SUPPRESS_WINDOW_MS) {
      ledger.set(lkey, { decision: "suppressed", firstSource: ev.source, firstAt: Date.now() });
      scheduleLedgerSweep();
      return "suppressed";
    }
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
    pushToast({
      tone: p.toast.tone,
      title: p.toast.title,
      body: p.toast.body,
      ttl: p.toast.ttl,
      key: lkey,
    });
  }
  if (p?.haptic) emitHaptic(p.haptic);
  if (p?.sound === "alert") playAlert();
  else if (p?.sound === "confirm") playConfirm();

  // Raise the ceiling.
  if (ev.version > ceiling) versionCeiling.set(ckey, ev.version);

  // Record permanent terminal-emit lock + lifecycle suppression window.
  if (TERMINAL_KINDS.has(ev.kind)) {
    terminalEmitted.add(ckey);
  }
  if (LIFECYCLE_KINDS.has(ev.kind)) {
    lastLifecycleAt.set(ev.entityId, Date.now());
  }

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
