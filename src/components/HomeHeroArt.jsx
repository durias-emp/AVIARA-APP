// Generic full-bleed background illustrations for the Home screen's
// "hero" buttons (Pilot, Hangar, Flight Planning) — same visual language
// as WeatherCard's animated background: colorful art + a dark scrim on
// top carries white text. These are static (no per-user data yet),
// standing in until real photos/avatars exist.

const ART_STYLE = { position: 'absolute', inset: 0, width: '100%', height: '100%' }

export function PilotArt() {
  return (
    <svg viewBox="0 0 400 90" preserveAspectRatio="xMidYMid slice" style={ART_STYLE}>
      <defs>
        <linearGradient id="pilot-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2d3f7c" />
          <stop offset="100%" stopColor="#5673d6" />
        </linearGradient>
      </defs>
      <rect width="400" height="90" fill="url(#pilot-bg)" />
      <circle cx="330" cy="45" r="55" fill="#ffffff" opacity="0.06" />
      <circle cx="330" cy="45" r="34" fill="#ffffff" opacity="0.08" />
      {/* pilot bust silhouette with cap */}
      <g transform="translate(64,10)">
        <path d="M40 76 Q0 62 0 84 L80 84 Q80 62 40 76 Z" fill="#161c38" />
        <circle cx="40" cy="30" r="19" fill="#161c38" />
        <rect x="12" y="16" width="56" height="8" rx="4" fill="#0d1226" />
        <path d="M17 18 a23 23 0 0 1 46 0 h-6 a17 17 0 0 0 -34 0 z" fill="#0d1226" />
        <circle cx="40" cy="12" r="3" fill="#f5c518" />
      </g>
    </svg>
  )
}

export function HangarArt() {
  return (
    <svg viewBox="0 0 400 90" preserveAspectRatio="xMidYMid slice" style={ART_STYLE}>
      <defs>
        <linearGradient id="hgr-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5b9fdd" />
          <stop offset="100%" stopColor="#bfe3ff" />
        </linearGradient>
      </defs>
      <rect width="400" height="90" fill="url(#hgr-sky)" />
      <ellipse cx="80" cy="20" rx="26" ry="10" fill="#ffffff" opacity="0.8" />
      <ellipse cx="340" cy="26" rx="20" ry="8" fill="#ffffff" opacity="0.6" />
      <rect y="68" width="400" height="22" fill="#8a8f97" />
      {/* quonset-style hangar building */}
      <path d="M110 68 L110 42 Q210 -8 310 42 L310 68 Z" fill="#343a42" />
      <path d="M172 68 L172 48 Q210 30 248 48 L248 68 Z" fill="#0f1216" />
      <path d="M140 68 L140 36 M172 68 L172 24 M210 68 L210 18 M248 68 L248 24 M280 68 L280 36"
        stroke="#22262c" strokeWidth="2" fill="none" opacity="0.6" />
    </svg>
  )
}

export function FlightPlanArt() {
  return (
    <svg viewBox="0 0 400 90" preserveAspectRatio="xMidYMid slice" style={ART_STYLE}>
      <defs>
        <linearGradient id="fp-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1f6f5c" />
          <stop offset="100%" stopColor="#2f9c80" />
        </linearGradient>
      </defs>
      <rect width="400" height="90" fill="url(#fp-bg)" />
      {/* faint chart grid */}
      <g stroke="#ffffff" strokeWidth="1" opacity="0.12">
        <line x1="0" y1="22" x2="400" y2="22" />
        <line x1="0" y1="45" x2="400" y2="45" />
        <line x1="0" y1="68" x2="400" y2="68" />
        <line x1="90" y1="0" x2="90" y2="90" />
        <line x1="200" y1="0" x2="200" y2="90" />
        <line x1="310" y1="0" x2="310" y2="90" />
      </g>
      {/* route line with waypoint dots */}
      <polyline points="50,66 150,30 250,50 350,20" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeDasharray="1 7" strokeLinecap="round" opacity="0.9" />
      <circle cx="50" cy="66" r="5" fill="#ffffff" />
      <circle cx="150" cy="30" r="5" fill="#ffffff" />
      <circle cx="250" cy="50" r="5" fill="#ffffff" />
      <circle cx="350" cy="20" r="5" fill="#ffffff" />
    </svg>
  )
}
