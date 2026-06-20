// Stylized map. Renders stethoscope markers for online doctor sessions.
// One shared visual language across Request Coverage and Cover & Earn.

// Marker positions can be either:
//   - synthesized (top/left in 0..1, used by the stylized fallback map)
//   - absolute geo (lat/lng — preferred for the live Google Map so markers
//     stay anchored to real-world coordinates and never re-anchor when the
//     camera center pans to a newly selected hospital).
export type Marker = {
  top: number;
  left: number;
  key: string;
  lat?: number | null;
  lng?: number | null;
};

export function MapBackground({
  variant = "presence",
  markers,
}: {
  variant?: "presence" | "stethoscope" | "empty";
  markers?: Marker[];
} = {}) {
  // Default single self-marker for the doctor's own home screen.
  const resolved: Marker[] =
    markers ??
    (variant === "stethoscope"
      ? [{ top: 0.38, left: 0.5, key: "self" }]
      : variant === "presence"
        ? [
            { top: 0.22, left: 0.3, key: "p1" },
            { top: 0.38, left: 0.62, key: "p2" },
            { top: 0.54, left: 0.22, key: "p3" },
            { top: 0.3, left: 0.78, key: "p4" },
            { top: 0.62, left: 0.7, key: "p5" },
            { top: 0.46, left: 0.48, key: "p6" },
          ]
        : []);

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ background: "var(--color-map)" }}
    >
      <svg
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="none"
        viewBox="0 0 400 800"
      >
        <g
          stroke="var(--color-map-ink)"
          strokeWidth="1.2"
          fill="none"
          opacity="0.9"
        >
          <path d="M-20 220 C 80 200, 160 260, 260 220 S 420 240, 460 210" />
          <path d="M-20 420 C 100 400, 180 460, 280 430 S 420 440, 460 420" />
          <path d="M60 -20 C 80 120, 40 260, 90 400 S 120 660, 100 820" />
          <path d="M280 -20 C 260 140, 320 260, 290 420 S 320 660, 300 820" />
        </g>
        <g
          stroke="var(--color-map-ink)"
          strokeWidth="0.6"
          fill="none"
          opacity="0.55"
        >
          <path d="M-20 120 L 460 140" />
          <path d="M-20 320 L 460 340" />
          <path d="M-20 540 L 460 560" />
          <path d="M-20 680 L 460 700" />
          <path d="M160 -20 L 180 820" />
          <path d="M380 -20 L 400 820" />
        </g>
        <rect
          x="180"
          y="260"
          width="80"
          height="80"
          rx="8"
          fill="var(--color-map-ink)"
          opacity="0.35"
        />
        <rect
          x="40"
          y="500"
          width="100"
          height="60"
          rx="6"
          fill="var(--color-map-ink)"
          opacity="0.3"
        />
      </svg>

      {resolved.map((m, i) => (
        <Stethoscope
          key={m.key}
          top={m.top}
          left={m.left}
          delay={(i % 6) * 0.25}
        />
      ))}

      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2"
        style={{
          background:
            "linear-gradient(to top, color-mix(in oklab, var(--color-background) 30%, transparent), transparent)",
        }}
      />
    </div>
  );
}

function Stethoscope({
  top,
  left,
  delay,
}: {
  top: number;
  left: number;
  delay: number;
}) {
  return (
    <div
      className="absolute"
      style={{
        top: `${top * 100}%`,
        left: `${left * 100}%`,
        transform: "translate(-50%, -50%)",
      }}
    >
      <div className="relative">
        <span
          className="absolute -inset-3 rounded-full"
          style={{
            background: "var(--color-presence)",
            opacity: 0.18,
            animation: "presence-pulse 2.4s ease-out infinite",
            animationDelay: `${delay}s`,
          }}
        />
        <div
          className="relative flex h-11 w-11 items-center justify-center rounded-full shadow-[0_6px_18px_-6px_rgba(0,0,0,0.35)]"
          style={{
            background: "var(--color-surface-elevated)",
            border: "1.5px solid var(--color-presence)",
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path
              d="M6 3v6a4 4 0 008 0V3"
              stroke="var(--color-presence)"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
            <path
              d="M10 14v2a4 4 0 008 0v-2"
              stroke="var(--color-presence)"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
            <circle cx="18" cy="11" r="1.6" fill="var(--color-presence)" />
          </svg>
        </div>
      </div>
    </div>
  );
}
