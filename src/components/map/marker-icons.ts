// Shared marker SVG generators. Returns raw data URLs that both the web
// (google.maps.Icon.url) and native (@capacitor/google-maps iconUrl) impls
// can consume directly. Sizes are returned alongside so each impl can wire
// scaledSize / anchor for its respective API.

export type MarkerArt = {
  url: string;
  size: number;
};

export function doctorMarkerArt(scale = 1): MarkerArt {
  const size = Math.max(20, Math.round(56 * scale));
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56">
  <circle cx="28" cy="28" r="22" fill="#3a8a5e" fill-opacity="0.18">
    <animate attributeName="r" values="16;22;16" dur="2.4s" repeatCount="indefinite"/>
    <animate attributeName="fill-opacity" values="0.28;0.08;0.28" dur="2.4s" repeatCount="indefinite"/>
  </circle>
  <circle cx="28" cy="28" r="14" fill="#ffffff" stroke="#3a8a5e" stroke-width="1.8"/>
  <g stroke="#3a8a5e" stroke-width="1.8" fill="none" stroke-linecap="round" transform="translate(19 18)">
    <path d="M3 1v6a4 4 0 008 0V1"/>
    <path d="M7 11v2a4 4 0 008 0v-2"/>
    <circle cx="15" cy="9" r="1.6" fill="#3a8a5e" stroke="none"/>
  </g>
</svg>`.trim();
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    size,
  };
}

export function requesterDotMarkerArt(): MarkerArt {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <circle cx="24" cy="24" r="20" fill="#3b82f6" fill-opacity="0.18">
    <animate attributeName="r" values="12;20;12" dur="2.6s" repeatCount="indefinite"/>
    <animate attributeName="fill-opacity" values="0.32;0.06;0.32" dur="2.6s" repeatCount="indefinite"/>
  </circle>
  <circle cx="24" cy="24" r="10" fill="#ffffff"/>
  <circle cx="24" cy="24" r="7" fill="#3b82f6"/>
</svg>`.trim();
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    size: 48,
  };
}
