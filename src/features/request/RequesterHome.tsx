import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { GoogleMapBackground, type PlaceMapMarker } from "@/components/GoogleMapBackground";
import type { Marker } from "@/components/MapBackground";
import { setImmersive } from "@/lib/immersion";
import { fmtElapsed } from "@/lib/format";
import { CancelFlow } from "@/components/CancelFlow";
import { EditShiftSheet, type EditableShift } from "@/components/EditShiftSheet";
import { TimeField12h } from "@/components/TimeField12h";
import { RatingPill } from "@/components/RatingPill";
import { ReliabilityPill } from "@/components/ReliabilityPill";
import { TrustInfoPopover } from "@/components/TrustInfoPopover";
import { pushToast } from "@/lib/notifications";
import { hospitalEntityId } from "@/features/cover/dispatch";
import {
  onlineDoctors,
  pauseRequest,
  publishRequest,
  removeRequest,
  resumeRequest,
  updateRequest,
  cancelRequest as netCancel,
  useNetwork,
} from "@/lib/network";
import { computeCoveragePricing, coverageKindFromLabel } from "@/lib/pricing";
import { useDoctorIdentity } from "@/lib/doctor-identity";
import {
  fetchHospitalSuggestions,
  fetchPlaceDetails,
  isInLagos,
  type PlaceSuggestion,
} from "@/lib/google-maps";
import { rememberRecentLocation, useRecentLocations } from "@/lib/recent-locations";


export function RequesterHome({ active = true }: { active?: boolean }) {
  return <HomeScreen active={active} />;
}

type CoverageId = "standard" | "24h" | "weekend" | "home";
type Stage = "collapsed" | "search" | "configure" | "match" | "dispatch" | "accepted";

type Recent = { placeId?: string; name: string; area: string; lat?: number; lng?: number };


const COVERAGE: { id: CoverageId; label: string }[] = [
  { id: "standard", label: "Standard" },
  { id: "home", label: "Home Care" },
];

const COVERAGE_SUBTEXT: Partial<Record<CoverageId, string>> = {
  standard: "For hospitals, clinics, facilities, and medical centers.",
  home: "For private residences and personal in-home care.",
};

const NOTE_PLACEHOLDER = "Female doctor needed; accommodation available; Mon, Tue, Weds";

/* ---------------------- Draft (real timing) ---------------------- */

type Draft = {
  startDate: string; // yyyy-mm-dd
  startTime: string; // HH:MM (24h)
  endTime: string; // HH:MM (24h)
  note: string;
};

function makeInitialDraft(coverage: CoverageId): Draft {
  const today = new Date().toISOString().slice(0, 10);
  if (coverage === "weekend") {
    // Auto Sat→Mon, 48h block; user can still adjust start time.
    const d = new Date();
    const diff = (6 - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    return {
      startDate: d.toISOString().slice(0, 10),
      startTime: "20:00",
      endTime: "06:00",
      note: "",
    };
  }
  if (coverage === "home") {
    return { startDate: today, startTime: "22:00", endTime: "06:00", note: "" };
  }
  if (coverage === "24h") {
    return { startDate: today, startTime: "08:00", endTime: "08:00", note: "" };
  }
  return { startDate: today, startTime: "08:00", endTime: "18:00", note: "" };
}

/* ---------------------- Pricing ---------------------- */

type PricingContext = { coverage: CoverageId; draft: Draft; days: number };

function computePricing({ coverage, draft, days }: PricingContext) {
  return computeCoveragePricing(
    coverageKindFromLabel(COVERAGE_SHORT[coverage]),
    draft.startTime,
    draft.endTime,
    days,
  );
}

function formatNaira(n: number) {
  return "₦" + n.toLocaleString("en-NG");
}



const COVERAGE_SHORT: Record<CoverageId, string> = {
  standard: "Standard",
  "24h": "24-Hour",
  weekend: "Weekend Call",
  home: "Home Care",
};

/* ---------------------- Timing derivation ---------------------- */

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Weds", "Thu", "Fri", "Sat"];

function fmtAmPm(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  const hr = ((h + 11) % 12) + 1;
  return `${String(hr).padStart(2, "0")}:${String(m).padStart(2, "0")} ${period}`;
}

function dayLabel(coverage: CoverageId, draft: Draft, days: number): string {
  if (coverage === "weekend") return "Sat & Sun";
  if (!draft.startDate) return "";
  const start = new Date(draft.startDate);
  const startWd = WEEKDAY_SHORT[start.getDay()] ?? "";
  if (coverage === "24h" || days <= 1) return startWd;
  const end = new Date(start);
  end.setDate(end.getDate() + days - 1);
  const endWd = WEEKDAY_SHORT[end.getDay()] ?? "";
  return `${startWd}–${endWd}`;
}

function durationHrsOf(coverage: CoverageId, draft: Draft, days: number): number {
  if (coverage === "24h") return 24 * Math.max(1, days);
  if (coverage === "weekend") return 48;
  // standard / home — derive from start/end + days
  const [sh, sm] = draft.startTime.split(":").map(Number);
  const [eh, em] = draft.endTime.split(":").map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60; // overnight
  const perDay = mins / 60;
  return Math.round(perDay * Math.max(1, days));
}

/** Absolute window for the scheduled shift, derived from date + start + duration. */
function shiftWindow(coverage: CoverageId, draft: Draft, days: number) {
  const startTs = new Date(`${draft.startDate}T${draft.startTime}:00`).getTime();
  const durHrs = durationHrsOf(coverage, draft, days);
  const endTs = startTs + durHrs * 3_600_000;
  const end = new Date(endTs);
  const endHHMM = `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
  return { startTs, endTs, durHrs, endHHMM };
}

function compressedSummary(coverage: CoverageId, draft: Draft, days: number): string {
  return `${COVERAGE_SHORT[coverage]} · ${dayLabel(coverage, draft, days)} · ${fmtAmPm(draft.startTime)}`;
}

/* ---------------------- Home ---------------------- */

function HomeScreen({ active }: { active: boolean }) {
  const [stage, setStage] = useState<Stage>("collapsed");
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState<Recent | null>(null);
  const [searchOrigin, setSearchOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [coverage, setCoverageRaw] = useState<CoverageId>("standard");
  const [days, setDays] = useState(1);
  const [draft, setDraft] = useState<Draft>(() => makeInitialDraft("standard"));
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);

  // Pause the in-flight request whenever requester is editing (configure / match).
  useEffect(() => {
    if (!activeRequestId) return;
    if (stage === "configure" || stage === "match") {
      pauseRequest(activeRequestId);
    }
  }, [stage, activeRequestId]);

  // Immersive flow — hide bottom tabs once the requester engages the sheet.
  useEffect(() => {
    setImmersive(active && stage !== "collapsed");
    return () => setImmersive(false);
  }, [active, stage]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setSearchOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 300_000 },
    );
  }, []);

  const setCoverage = (c: CoverageId) => {
    setCoverageRaw(c);
    setDraft((d) => ({ ...makeInitialDraft(c), note: d.note }));
    if (c === "24h") setDays(1);
    else if (c === "standard" || c === "home") setDays((d) => (d < 1 || d > 7 ? 1 : d));
  };

  const patchDraft = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  // Live Places suggestions for hospital search.
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || location?.name === q) {
      setSuggestions([]);
      setSuggestLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setSuggestLoading(true);
    const t = setTimeout(() => {
      fetchHospitalSuggestions(q, searchOrigin, ctrl.signal)
        .then((s) => {
          if (ctrl.signal.aborted) return;
          // Keep prior suggestions visible if the new query returned nothing
          // transiently — avoids a flash of "No matching hospitals."
          if (s.length > 0) setSuggestions(s);
        })
        .catch(() => {
          /* keep prior suggestions on transient errors */
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setSuggestLoading(false);
        });
    }, 140);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [query, location?.name, searchOrigin]);

  const recents: Recent[] = useRecentLocations();

  const selectLocation = (r: Recent) => {
    setLocation(r);
    setQuery(r.name);
    setStage("configure");
  };

  const selectSuggestion = async (s: PlaceSuggestion) => {
    // Hard-restrict to Lagos. If coords are present and out of bounds, reject
    // immediately; otherwise resolve via Place Details and validate there.
    if (s.lat != null && s.lng != null && !isInLagos(s.lat, s.lng)) {
      pushToast({ tone: "warn", title: "FlashLocum is only available in Lagos right now." });
      return;
    }
    setQuery(s.primary);
    setSuggestions([]);
    if (s.lat != null && s.lng != null) {
      setLocation({
        placeId: s.placeId,
        name: s.primary,
        area: s.secondary,
        lat: s.lat,
        lng: s.lng,
      });
      setStage("configure");
    }
    try {
      const details = await fetchPlaceDetails(s.placeId);
      if (!details) return;
      if (!isInLagos(details.lat, details.lng)) {
        setLocation(null);
        setStage("search");
        pushToast({ tone: "warn", title: "FlashLocum is only available in Lagos right now." });
        return;
      }
      setLocation({
        placeId: details.placeId,
        name: details.name || s.primary,
        area: details.address || s.secondary,
        lat: details.lat,
        lng: details.lng,
      });
      setStage("configure");
    } catch {
      pushToast({ tone: "warn", title: "Couldn't load that location. Try again." });
    }
  };

  const net = useNetwork();
  const markers: Marker[] = useMemo(
    () =>
      onlineDoctors(net).map((d) => ({
        top: d.top,
        left: d.left,
        key: d.sessionId,
      })),
    [net],
  );

  const mapCenter =
    location?.lat != null && location?.lng != null
      ? { lat: location.lat, lng: location.lng }
      : null;
  const placeMarkers: PlaceMapMarker[] = location?.lat != null && location?.lng != null
    ? [{ key: location.placeId ?? location.name, title: location.name, lat: location.lat, lng: location.lng }]
    : suggestions
        .filter((s) => s.lat != null && s.lng != null)
        .map((s) => ({ key: s.placeId, title: s.primary, lat: s.lat!, lng: s.lng! }));

  // Requester's own trust scope — use most recent hospital they booked for
  // (doctors' ratings & reliability accumulate against that hospital name).
  const selfHospitalName = location?.name ?? recents[0]?.name ?? null;
  const selfEntityId = selfHospitalName ? hospitalEntityId(selfHospitalName) : null;

  return (
    <section className="relative h-full w-full overflow-hidden">
      <GoogleMapBackground active={active} markers={markers} center={mapCenter} placeMarkers={placeMarkers} />

      {/* Top floating trust card — calm rating + reliability for the requester */}
      {stage === "collapsed" && (
        <header className="absolute inset-x-0 top-0 z-30 safe-top pointer-events-none">
          <div className="mx-auto flex max-w-md justify-center px-4 pt-3">
            <div
              className="pointer-events-auto inline-flex items-center gap-3 rounded-full px-4 py-2 shadow-[0_4px_18px_-4px_rgba(0,0,0,0.18)]"
              style={{
                background: "var(--color-surface-elevated)",
                border: "1px solid color-mix(in oklab, var(--color-foreground) 10%, transparent)",
              }}
            >
              <RatingPill entityId={selfEntityId} role="requester" inline />
              <span
                aria-hidden
                className="h-3 w-px"
                style={{ background: "color-mix(in oklab, var(--color-foreground) 14%, transparent)" }}
              />
              <ReliabilityPill entityId={selfEntityId} inline />
              <TrustInfoPopover align="end" className="ml-0.5" />
            </div>
          </div>
        </header>
      )}




      {/* Match-stage: compressed shift summary with subtle reopen affordance */}
      <AnimatePresence>
        {stage === "match" && location && (
          <motion.div
            key="context-bar"
            initial={{ y: -16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -16, opacity: 0 }}
            transition={{ type: "spring", stiffness: 280, damping: 32 }}
            className="absolute left-3 right-3 z-30 mt-16 flex min-h-12 items-center gap-2 rounded-2xl bg-surface-elevated pl-2 pr-4 py-2 text-left shadow-[0_4px_18px_rgba(0,0,0,0.10)] safe-top"
          >
            <button
              onClick={() => setStage("configure")}
              aria-label="Refine request"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors active:bg-secondary"
              style={{ color: "color-mix(in oklab, var(--color-foreground) 60%, transparent)" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path
                  d="M6 6l12 12M18 6L6 18"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <button
              onClick={() => setStage("configure")}
              className="flex flex-1 items-center gap-2 truncate text-left"
            >
              <span className="truncate text-[13px] font-medium leading-none tabular-nums">
                {compressedSummary(coverage, draft, days)}
              </span>
            </button>
          </motion.div>
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
            draft={draft}
            location={location}
            requestId={activeRequestId}
            setRequestId={setActiveRequestId}
          />
        ) : stage === "match" ? (
          <SettlementSheet
            key="settlement"
            pricing={computePricing({ coverage, draft, days })}

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
            suggestions={suggestions}
            suggestLoading={suggestLoading}
            onPickRecent={selectLocation}
            onPickSuggestion={selectSuggestion}
            location={location}
            coverage={coverage}
            setCoverage={setCoverage}
            days={days}
            setDays={setDays}
            draft={draft}
            patchDraft={patchDraft}
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
  suggestions,
  suggestLoading,
  onPickRecent,
  onPickSuggestion,
  location,
  coverage,
  setCoverage,
  days,
  setDays,
  draft,
  patchDraft,
  onAdvance,
}: {
  stage: Stage;
  setStage: (s: Stage) => void;
  query: string;
  setQuery: (v: string) => void;
  recents: Recent[];
  suggestions: PlaceSuggestion[];
  suggestLoading: boolean;
  onPickRecent: (r: Recent) => void;
  onPickSuggestion: (s: PlaceSuggestion) => void;
  location: Recent | null;
  coverage: CoverageId;
  setCoverage: (c: CoverageId) => void;
  days: number;
  setDays: (n: number) => void;
  draft: Draft;
  patchDraft: (p: Partial<Draft>) => void;
  onAdvance: () => void;
}) {
  const isCollapsed = stage === "collapsed";
  const isSearch = stage === "search";
  const isConfigure = stage === "configure";

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.velocity.y < -300 || info.offset.y < -60) {
      if (isCollapsed) setStage("search");
    } else if (info.velocity.y > 300 || info.offset.y > 60) {
      if (isSearch) setStage("collapsed");
      else if (isConfigure) setStage("collapsed");
    }
  };

  // Adaptive: collapsed = fixed compact; search = content-fit; configure = tall.
  const sheetClass = isConfigure ? "h-[86vh]" : isCollapsed ? "h-[132px]" : "max-h-[72vh]";

  return (
    <>
      {/* Tap-outside backdrop — collapses search OR configure */}
      <AnimatePresence>
        {(isSearch || isConfigure) && (
          <motion.div
            key="sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 z-10 bg-foreground/10"
            onClick={() => setStage("collapsed")}
            aria-hidden
          />
        )}
      </AnimatePresence>

      <motion.section
        initial={false}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.04}
        dragMomentum={false}
        onDragEnd={handleDragEnd}
        className={`absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-3xl shadow-[0_-12px_40px_-12px_rgba(0,0,0,0.18)] ${sheetClass}`}
        style={{ background: "var(--color-surface-elevated)" }}
      >
        <button
          aria-label="Toggle"
          onClick={() => setStage(isCollapsed ? "search" : "collapsed")}
          className="flex w-full shrink-0 justify-center pt-3 pb-2"
        >
          <span className="h-1.5 w-10 rounded-full bg-muted-foreground/25" />
        </button>

        <div className="flex flex-1 flex-col overflow-hidden px-5 pb-5 pt-1">
          {/* Search field */}
          <button
            onClick={() => isCollapsed && setStage("search")}
            className="flex h-14 shrink-0 items-center gap-3 rounded-2xl bg-secondary px-4 text-left"
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              className="text-muted-foreground"
            >
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
              <path
                d="M20 20l-3.5-3.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
            {isCollapsed ? (
              <span className="text-[15px] leading-none text-foreground/85">
                Where is coverage needed?
              </span>
            ) : (
              <input
                autoFocus={isSearch}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => isConfigure && setStage("search")}
                placeholder="Where is coverage needed?"
                className="h-full flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
              />
            )}
          </button>

          {/* Body — adaptive; live Places suggestions + recents */}
          <div className="mt-3 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {isSearch && suggestions.length > 0 && (
              <ul className="space-y-0.5 pb-1">
                {suggestions.map((s) => (
                  <li key={s.placeId}>
                    <button
                      onClick={() => onPickSuggestion(s)}
                      className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left active:bg-accent"
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="text-muted-foreground">
                          <path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z" stroke="currentColor" strokeWidth="1.6" />
                          <circle cx="12" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.6" />
                        </svg>
                      </span>
                      <span className="flex-1 min-w-0">
                        <div className="truncate text-[15px] font-medium">{s.primary}</div>
                        <div className="truncate text-[12.5px] text-muted-foreground">{s.secondary}</div>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {isSearch && suggestions.length === 0 && query.trim().length >= 2 && (
              suggestLoading ? (
                <ul className="space-y-0.5 pb-1" aria-busy="true">
                  {[0, 1, 2].map((i) => (
                    <li key={i} className="flex items-center gap-3 rounded-xl px-2 py-2.5">
                      <span className="h-9 w-9 rounded-full bg-secondary animate-pulse" />
                      <span className="flex-1 min-w-0 space-y-1.5">
                        <span className="block h-3 w-2/3 rounded bg-secondary animate-pulse" />
                        <span className="block h-2.5 w-1/2 rounded bg-secondary/70 animate-pulse" />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="px-2 py-3 text-[12.5px] text-muted-foreground">
                  No matching hospitals.
                </div>
              )
            )}

            {isSearch && suggestions.length === 0 && query.trim().length < 2 && recents.length > 0 && (
              <ul className="space-y-0.5 pb-1">
                {recents.slice(0, 3).map((r) => (
                  <li key={r.name}>
                    <button
                      onClick={() => onPickRecent(r)}
                      className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left active:bg-accent"
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

            {isConfigure && location && (
              <ConfigureBody
                location={location}
                coverage={coverage}
                setCoverage={setCoverage}
                days={days}
                setDays={setDays}
                draft={draft}
                patchDraft={patchDraft}
                onAdvance={onAdvance}
              />
            )}
          </div>
        </div>
      </motion.section>
    </>
  );
}

/* ---------------------- Configure body ---------------------- */

function ConfigureBody({
  location,
  coverage,
  setCoverage,
  days,
  setDays,
  draft,
  patchDraft,
  onAdvance,
}: {
  location: Recent;
  coverage: CoverageId;
  setCoverage: (c: CoverageId) => void;
  days: number;
  setDays: (n: number) => void;
  draft: Draft;
  patchDraft: (p: Partial<Draft>) => void;
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

      {/* Calm operational subtext for the active coverage type */}
      {COVERAGE_SUBTEXT[coverage] && (
        <p className="-mt-2 px-1 text-[12px] leading-snug text-muted-foreground">
          {COVERAGE_SUBTEXT[coverage]}
        </p>
      )}

      {/* Dynamic fields — switch fluidly per coverage type */}
      <AnimatePresence mode="wait">
        <motion.div
          key={coverage}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}
        >
          <CoverageFields
            coverage={coverage}
            days={days}
            setDays={setDays}
            draft={draft}
            patchDraft={patchDraft}
          />
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
            <path
              d="M5 12h14M13 6l6 6-6 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

/* ---------------------- Coverage-specific fields ---------------------- */

function dateBounds(): { min: string; max: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = new Date();
  const max = new Date(today);
  max.setDate(max.getDate() + 6);
  return { min: fmt(today), max: fmt(max) };
}

function CoverageFields({
  coverage: _coverage,
  days,
  setDays,
  draft,
  patchDraft,
}: {
  coverage: CoverageId;
  days: number;
  setDays: (n: number) => void;
  draft: Draft;
  patchDraft: (p: Partial<Draft>) => void;
}) {
  const bounds = dateBounds();
  // Clamp start date into the 7-day operational window if it drifts.
  useEffect(() => {
    if (draft.startDate < bounds.min) patchDraft({ startDate: bounds.min });
    else if (draft.startDate > bounds.max) patchDraft({ startDate: bounds.max });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.startDate]);

  return (
    <Fields>
      <Row>
        <CtrlField
          label="Start date"
          type="date"
          value={draft.startDate}
          min={bounds.min}
          max={bounds.max}
          onChange={(v) => patchDraft({ startDate: v })}
        />
        <TimeField12h
          label="Start time"
          value={draft.startTime}
          onChange={(v) => patchDraft({ startTime: v })}
        />
      </Row>
      <Row>
        <TimeField12h
          label="End time"
          value={draft.endTime}
          onChange={(v) => patchDraft({ endTime: v })}
        />
        <DaysStepper value={days} setValue={setDays} />
      </Row>
      <NoteField value={draft.note} onChange={(v) => patchDraft({ note: v })} />
    </Fields>
  );
}

function Fields({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2.5">{children}</div>;
}
function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2.5">{children}</div>;
}

function CtrlField({
  label,
  type,
  value,
  onChange,
  readOnly,
  min,
  max,
}: {
  label: string;
  type: "date" | "time";
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  min?: string;
  max?: string;
}) {
  return (
    <label className="flex flex-col gap-1 rounded-xl bg-secondary/60 px-3 py-2">
      <span className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </span>
      <input
        type={type}
        value={value}
        readOnly={readOnly}
        min={min}
        max={max}
        onChange={(e) => {
          const v = e.target.value;
          if (type === "date") {
            if (min && v < min) {
              pushToast({
                tone: "info",
                title: "Coverage requests start from today.",
              });
              onChange?.(min);
              return;
            }
            if (max && v > max) {
              pushToast({
                tone: "info",
                title: "Coverage requests are limited to 7 days maximum.",
              });
              onChange?.(max);
              return;
            }
          }
          onChange?.(v);
        }}
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
  onCap,
}: {
  label: string;
  value: number;
  setValue: (n: number) => void;
  min: number;
  max: number;
  unit: (n: number) => string;
  onCap?: () => void;
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
          onClick={() => {
            if (value >= max) {
              onCap?.();
              return;
            }
            setValue(Math.min(max, value + 1));
          }}
          className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-elevated text-foreground/70 active:scale-95"
        >
          +
        </button>
      </div>
    </div>
  );
}

function DaysStepper({ value, setValue }: { value: number; setValue: (n: number) => void }) {
  return (
    <Stepper
      label="Coverage Length"
      value={value}
      setValue={setValue}
      min={1}
      max={7}
      unit={(n) => (n === 1 ? "day" : "days")}
      onCap={() =>
        pushToast({
          tone: "info",
          title: "Coverage requests are limited to 7 days maximum.",
        })
      }
    />
  );
}

function NoteField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 rounded-xl bg-secondary/60 px-3 py-2">
      <span className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        Note (optional)
      </span>
      <textarea
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={NOTE_PLACEHOLDER}
        className="resize-none bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground/55"
      />
    </label>
  );
}

/* ---------------------- Settlement sheet ---------------------- */

function SettlementSheet({
  pricing,
  onConfirm,
}: {
  pricing: { amount: number; explanation: string };
  onConfirm: () => void;
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
          Coverage
        </div>

        <div className="mt-2 text-[34px] font-semibold leading-none tracking-tight tabular-nums">
          {formatNaira(pricing.amount)}
        </div>

        <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
          {pricing.explanation}
        </p>

        <button
          onClick={onConfirm}
          className="mt-6 h-13 w-full rounded-full bg-primary py-4 text-[14.5px] font-semibold text-primary-foreground active:opacity-90"
        >
          Request Coverage
        </button>
      </div>
    </motion.section>
  );
}

/* ---------------------- Dispatch overlay (post-request) ---------------------- */

const DOCTOR_PHONE = "+2348012345678";

function DispatchOverlay({
  stage,
  setStage,
  coverage,
  days,
  draft,
  location,
  requestId,
  setRequestId,
}: {
  stage: "dispatch" | "accepted";
  setStage: (s: Stage) => void;
  coverage: CoverageId;
  days: number;
  draft: Draft;
  location: Recent | null;
  requestId: string | null;
  setRequestId: (id: string | null) => void;
}) {
  const [ambient, setAmbient] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [notified, setNotified] = useState<string | null>(null);
  const notifiedRef = useRef<number | null>(null);
  const publishedRef = useRef(false);
  // Tracks the request id this dispatch session actually owns. Prevents
  // stale `requestId` values (left over from a previous flow) from being
  // misread as a new doctor acceptance.
  const ownedIdRef = useRef<string | null>(null);
  const net = useNetwork();
  const acceptedRequest = requestId ? net.requests[requestId] : undefined;
  const acceptedSid = acceptedRequest?.acceptedBy;
  const doctorIdentity = useDoctorIdentity(acceptedSid ?? null);
  const acceptedDoctorRatingId = doctorIdentity.ratingId;
  const acceptedDoctorName = doctorIdentity.fullName;
  const acceptedInitials = doctorIdentity.initials;
  const acceptedMdcn = doctorIdentity.mdcn;
  const acceptedSelfie = doctorIdentity.selfieUrl;

  const paused = cancelOpen || editOpen;
  const pricing = computePricing({ coverage, draft, days });

  const dayStr = dayLabel(coverage, draft, days);
  const startStr = fmtAmPm(draft.startTime);
  const win = shiftWindow(coverage, draft, days);
  // For weekend/24h, end is fully derived from start + fixed duration.
  // For standard/home, draft.endTime drives it.
  const endStr =
    coverage === "weekend" || coverage === "24h" ? fmtAmPm(win.endHHMM) : fmtAmPm(draft.endTime);
  const durationHrs = win.durHrs;
  const acceptedMeta = `${COVERAGE_SHORT[coverage]} · ${dayStr} · ${endStr && endStr !== startStr ? `${startStr} - ${endStr}` : startStr} · ${durationHrs}hr · ${formatNaira(pricing.amount)}`;

  // Publish OR resume into the shared network when entering dispatch.
  useEffect(() => {
    if (stage !== "dispatch") return;
    const cur = requestId ? net.requests[requestId] : undefined;
    const canReuseRequest = cur?.status === "broadcasting" || cur?.status === "paused";
    if (cur && canReuseRequest) {
      // Coming back from configure: sync any edits then resume.
      updateRequest(cur.id, {
        hospital: location?.name ?? cur.hospital,
        area: location?.area ?? cur.area,
        coverage: COVERAGE_SHORT[coverage],
        day: dayStr,
        start: startStr,
        end: endStr,
        durationHrs,
        amount: pricing.amount,
        note: draft.note?.trim() || undefined,
        startTs: win.startTs,
        endTs: win.endTs,
        days: Math.max(1, days),
      });
      resumeRequest(cur.id);
      ownedIdRef.current = cur.id;
      return;
    }
    // Stale or missing id (e.g. left over from a completed/cancelled flow)
    // — discard it and publish a fresh request so the requester is never
    // attached to a previous doctor acceptance.
    if (cur && !canReuseRequest) {
      setRequestId(null);
    }
    if (publishedRef.current) return;
    publishedRef.current = true;
    const req = publishRequest({
      hospital: location?.name ?? "Coverage",
      area: location?.area ?? "",
      coverage: COVERAGE_SHORT[coverage],
      day: dayStr,
      start: startStr,
      end: endStr,
      durationHrs,
      amount: pricing.amount,
      feePct: 15,
      phone: DOCTOR_PHONE,
      note: draft.note?.trim() || undefined,
      startTs: win.startTs,
      endTs: win.endTs,
      days: Math.max(1, days),
      dayIndex: 1,
    });
    ownedIdRef.current = req.id;
    setRequestId(req.id);
    if (location?.name) rememberRecentLocation(location);
    const t = window.setTimeout(() => setAmbient(true), 2800);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  // Pause / resume broadcasting whenever the cancel or edit sheet is open.
  useEffect(() => {
    if (!requestId) return;
    if (paused) pauseRequest(requestId);
    else if (stage === "dispatch") resumeRequest(requestId);
  }, [paused, requestId, stage]);

  // React to acceptance OR doctor-side cancellation. Only ever act on the
  // request this dispatch session actually owns — never on a leftover id.
  useEffect(() => {
    if (!requestId || requestId !== ownedIdRef.current) return;
    const r = net.requests[requestId];
    if (!r) return;
    if (
      stage === "dispatch" &&
      r.status === "accepted" &&
      !!r.acceptedBy
    ) {
      setStage("accepted");
    }
    if (stage === "accepted" && r.status === "cancelled") {
      setStage("collapsed");
      setRequestId(null);
      ownedIdRef.current = null;
    }
  }, [net, requestId, stage, setStage, setRequestId]);

  // Swipe-down on accepted card returns user to Home.
  const handleAcceptedDrag = (_: unknown, info: PanInfo) => {
    if (info.velocity.y > 280 || info.offset.y > 90) setStage("collapsed");
  };

  // Edit sheet: start/end (12h) → coverage length auto-derived.
  const [editInitial, setEditInitial] = useState<EditableShift>({
    startTime: draft.startTime,
    endTime: draft.endTime,
    durationHrs,
    note: draft.note ?? "",
  });

  const openEdit = () => {
    setEditInitial({
      startTime: draft.startTime,
      endTime: draft.endTime,
      durationHrs,
      note: draft.note ?? "",
    });
    setEditOpen(true);
  };

  const handleSaveEdit = (next: EditableShift, changed: keyof EditableShift | "multiple") => {
    setEditOpen(false);
    const label: Record<keyof EditableShift | "multiple", string> = {
      startTime: "Coverage start time updated",
      endTime: "Coverage end time updated",
      durationHrs: "Coverage length updated",
      note: "Coverage notes updated",
      multiple: "Coverage details updated",
    };
    if (notifiedRef.current) window.clearTimeout(notifiedRef.current);
    setNotified(`${label[changed]} · Dr. notified`);
    notifiedRef.current = window.setTimeout(() => setNotified(null), 2600);

    if (requestId) {
      const cur = net.requests[requestId];
      // Preserve Coverage Length (days) across edits. Per-day duration comes
      // from the sheet (derived from start/end); total = perDay × days.
      const bookedDays = Math.max(1, cur?.days ?? days);
      const perDay = Math.max(1, next.durationHrs);
      const totalDur = perDay * bookedDays;
      const baseDateStr = draft.startDate;
      const newStartTs = new Date(`${baseDateStr}T${next.startTime}:00`).getTime();
      const newEndTs = newStartTs + totalDur * 3_600_000;
      // Re-price across ALL booked days so multi-day totals stay correct.
      const kind = coverageKindFromLabel(cur?.coverage ?? COVERAGE_SHORT[coverage]);
      const repriced = computeCoveragePricing(kind, next.startTime, next.endTime, bookedDays);
      updateRequest(requestId, {
        note: next.note?.trim() || undefined,
        start: fmtAmPm(next.startTime),
        end: fmtAmPm(next.endTime),
        durationHrs: totalDur,
        amount: repriced.amount,
        startTs: newStartTs,
        endTs: newEndTs,
        days: bookedDays,
      });
    }
  };


  // Pre-acceptance cancel: remove silently (no notification, no history).
  const handleCancelPreAccept = () => {
    if (requestId) removeRequest(requestId);
    ownedIdRef.current = null;
    setRequestId(null);
    setCancelOpen(false);
    setStage("collapsed");
  };

  // Post-acceptance cancel: notify doctor + record history.
  const handleCancelPostAccept = () => {
    if (requestId) netCancel(requestId);
    ownedIdRef.current = null;
    setRequestId(null);
    setCancelOpen(false);
    setStage("collapsed");
  };

  return (
    <>
      {stage === "dispatch" ? (
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

          <div className="flex flex-col px-6 pb-7 pt-2">
            <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              {location?.name ?? "Coverage"}
            </div>
            <h2 className="mt-2 text-[22px] font-semibold leading-tight tracking-tight">
              {paused ? "Search paused" : "Medical Officer Found"}
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              {paused
                ? "We'll resume connecting in a moment"
                : "Connecting to available doctors nearby"}
            </p>

            <ConnectionPulse className="mt-6" paused={paused} />

            <AnimatePresence>
              {ambient && !paused && (
                <motion.div
                  key="ambient"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.4 }}
                  className="mt-5 text-center text-[12px] text-muted-foreground"
                >
                  Checking nearby availability…
                </motion.div>
              )}
            </AnimatePresence>

            <div className="mt-6 flex items-center gap-2.5">
              <button
                onClick={() => setStage("configure")}
                className="flex-1 rounded-full bg-secondary/70 py-3 text-[13px] font-medium text-foreground/80 active:opacity-90"
              >
                Edit Request
              </button>
              <button
                onClick={() => setCancelOpen(true)}
                className="flex-1 rounded-full bg-secondary/40 py-3 text-[13px] font-medium text-foreground/70 active:opacity-90"
              >
                Cancel Request
              </button>
            </div>
            <span className="sr-only">{formatNaira(pricing.amount)}</span>
          </div>

          {/* Pre-acceptance: skip reason → silent cancel. */}
          <CancelFlow
            open={cancelOpen}
            onDismiss={() => setCancelOpen(false)}
            onCancelled={handleCancelPreAccept}
            skipReason
          />
        </motion.section>
      ) : (
        // Accepted state — dismissible (tap outside / swipe down → Home)
        <motion.div
          key="accepted-wrap"
          className="absolute inset-0 z-20 flex items-end"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            className="absolute inset-0 bg-foreground/15"
            onClick={() => setStage("collapsed")}
            aria-hidden
          />
          <motion.section
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 280, damping: 34 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.35 }}
            dragMomentum={false}
            onDragEnd={handleAcceptedDrag}
            className="relative z-10 w-full rounded-t-3xl shadow-[0_-12px_40px_-12px_rgba(0,0,0,0.18)]"
            style={{ background: "var(--color-surface-elevated)" }}
          >
            <div className="flex w-full shrink-0 justify-center pt-3 pb-2">
              <span className="h-1.5 w-10 rounded-full bg-muted-foreground/25" />
            </div>

            <div className="flex flex-col px-6 pb-7 pt-2">
              <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Doctor accepted
              </div>

              <div className="mt-3 flex items-center gap-3 rounded-2xl bg-secondary/50 px-3.5 py-3">
                <span className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-[13px] font-semibold">
                  {acceptedSelfie ? (
                    <img src={acceptedSelfie} alt="" className="h-full w-full object-cover" />
                  ) : (
                    acceptedInitials
                  )}
                  <span
                    className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full"
                    style={{
                      background: "var(--color-presence)",
                      boxShadow: "0 0 0 2px var(--color-surface-elevated)",
                    }}
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-medium">{acceptedDoctorName}</div>
                  <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                    <span>{acceptedMdcn}</span>
                    <span>·</span>
                    <RatingPill entityId={acceptedDoctorRatingId} role="doctor" inline />
                    <span>·</span>
                    <ReliabilityPill entityId={acceptedDoctorRatingId} inline />
                  </div>
                  <div className="mt-0.5 truncate text-[12.5px] text-foreground/70 tabular-nums">
                    {requestId && net.requests[requestId]
                      ? `${net.requests[requestId].coverage} · ${net.requests[requestId].day} · ${net.requests[requestId].start}${net.requests[requestId].end && net.requests[requestId].end !== net.requests[requestId].start ? ` - ${net.requests[requestId].end}` : ""} · ${net.requests[requestId].durationHrs}hr · ${formatNaira(net.requests[requestId].amount)}`
                      : acceptedMeta}
                  </div>
                </div>
              </div>

              <AnimatePresence>
                {notified && (
                  <motion.div
                    key={notified}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="mt-3 flex items-center gap-2 rounded-xl bg-secondary/40 px-3 py-2 text-[12px] text-foreground/75"
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: "var(--color-presence)" }}
                    />
                    {notified}
                  </motion.div>
                )}
              </AnimatePresence>

              <p className="mt-3.5 text-[12px] leading-relaxed text-muted-foreground">
                Remember to start shift under Upcoming Coverage once the doctor arrives.
              </p>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <button
                  onClick={openEdit}
                  className="rounded-full bg-secondary/70 py-3 text-[12.5px] font-medium text-foreground/85 active:opacity-90"
                >
                  Edit Shift
                </button>
                <button
                  onClick={() => setCancelOpen(true)}
                  className="rounded-full bg-secondary/40 py-3 text-[12.5px] font-medium text-foreground/75 active:opacity-90"
                >
                  Cancel Shift
                </button>
                <a
                  href={`tel:${DOCTOR_PHONE}`}
                  className="flex items-center justify-center gap-1.5 rounded-full bg-foreground py-3 text-[12.5px] font-semibold text-background active:opacity-90"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M5 4h3l2 5-2.5 1.5a11 11 0 005 5L14 13l5 2v3a2 2 0 01-2 2A14 14 0 013 6a2 2 0 012-2z"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Call
                </a>
              </div>
            </div>

            <CancelFlow
              open={cancelOpen}
              onDismiss={() => setCancelOpen(false)}
              confirmTitle="Cancel this shift?"
              confirmBody={`${acceptedDoctorName} is already assigned. Keeping it preserves continuity.`}
              primaryLabel="Keep Shift"
              secondaryLabel="Cancel Shift"
              onCancelled={handleCancelPostAccept}
            />

            <EditShiftSheet
              open={editOpen}
              initial={editInitial}
              onDismiss={() => setEditOpen(false)}
              onSave={handleSaveEdit}
            />
          </motion.section>
        </motion.div>
      )}
    </>
  );
}

function ConnectionPulse({ className, paused }: { className?: string; paused?: boolean }) {
  // Keeps fmtElapsed bundled even when nothing renders it directly.
  void fmtElapsed;
  return (
    <div className={`relative h-10 w-full ${className ?? ""}`}>
      <div className="absolute inset-x-2 top-1/2 h-px -translate-y-1/2 bg-foreground/15" />
      <span
        className="absolute left-2 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full"
        style={{ background: "var(--color-foreground)" }}
      />
      <span
        className="absolute right-2 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full"
        style={{ background: "var(--color-presence)" }}
      />
      <motion.span
        className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full"
        style={{
          background: "var(--color-presence)",
          boxShadow: "0 0 12px color-mix(in oklab, var(--color-presence) 60%, transparent)",
        }}
        initial={{ left: "8px", opacity: 0 }}
        animate={
          paused
            ? { left: "50%", opacity: 0.5 }
            : { left: "calc(100% - 16px)", opacity: [0, 1, 1, 0] }
        }
        transition={
          paused ? { duration: 0.3 } : { duration: 2.4, ease: "easeInOut", repeat: Infinity }
        }
      />
    </div>
  );
}
