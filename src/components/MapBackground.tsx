// Lightweight stylized map. Not a real map yet — calm, spatial, alive.
export function MapBackground() {
  const dots = [
    { top: "22%", left: "30%", d: 0 },
    { top: "38%", left: "62%", d: 0.4 },
    { top: "54%", left: "22%", d: 0.9 },
    { top: "30%", left: "78%", d: 1.3 },
    { top: "62%", left: "70%", d: 0.2 },
    { top: "46%", left: "48%", d: 1.1 },
  ];
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: "var(--color-map)" }}>
      {/* roads */}
      <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 400 800">
        <g stroke="var(--color-map-ink)" strokeWidth="1.2" fill="none" opacity="0.9">
          <path d="M-20 220 C 80 200, 160 260, 260 220 S 420 240, 460 210" />
          <path d="M-20 420 C 100 400, 180 460, 280 430 S 420 440, 460 420" />
          <path d="M60 -20 C 80 120, 40 260, 90 400 S 120 660, 100 820" />
          <path d="M280 -20 C 260 140, 320 260, 290 420 S 320 660, 300 820" />
        </g>
        <g stroke="var(--color-map-ink)" strokeWidth="0.6" fill="none" opacity="0.55">
          <path d="M-20 120 L 460 140" />
          <path d="M-20 320 L 460 340" />
          <path d="M-20 540 L 460 560" />
          <path d="M-20 680 L 460 700" />
          <path d="M160 -20 L 180 820" />
          <path d="M380 -20 L 400 820" />
        </g>
        {/* park / block */}
        <rect x="180" y="260" width="80" height="80" rx="8" fill="var(--color-map-ink)" opacity="0.35" />
        <rect x="40" y="500" width="100" height="60" rx="6" fill="var(--color-map-ink)" opacity="0.3" />
      </svg>

      {/* presence indicators */}
      {dots.map((p, i) => (
        <div
          key={i}
          className="absolute drift"
          style={{ top: p.top, left: p.left, animationDelay: `${p.d}s` }}
        >
          <div className="relative h-3 w-3">
            <div className="presence-pulse absolute inset-0 rounded-full" />
            <div
              className="absolute inset-0 rounded-full"
              style={{ background: "var(--color-presence)", boxShadow: "0 0 0 3px rgba(255,255,255,0.6)" }}
            />
          </div>
        </div>
      ))}

      {/* subtle vignette toward the bottom for sheet legibility */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2"
        style={{ background: "linear-gradient(to top, color-mix(in oklab, var(--color-background) 30%, transparent), transparent)" }}
      />
    </div>
  );
}
