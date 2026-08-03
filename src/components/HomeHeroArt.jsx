// Generic full-bleed background illustrations for the Home screen's
// "hero" buttons (Airports, Pilot, Hangar, Flight Planning) — same visual
// language as WeatherCard's animated background: colorful art + a dark
// scrim on top carries white text. These are static (no per-user data yet,
// aside from AirportScene's weather flourish), standing in until real
// photos/avatars exist.

const ART_STYLE = { position: 'absolute', inset: 0, width: '100%', height: '100%' }

// Sky color per condition, keyed the same as WeatherAnimation's
// getCondition() return value — so the Airports button and the weather
// detail view always agree on what "cloudy" etc. looks like.
const SKY = {
  clear:     ['#5b9fdd', '#bfe3ff'],
  few:       ['#5b9fdd', '#bfe3ff'],
  scattered: ['#6c9cc9', '#c3dcef'],
  broken:    ['#7c8a99', '#b8c4cf'],
  overcast:  ['#6b7580', '#9aa4ad'],
  rain:      ['#5d6b78', '#8b98a3'],
  storm:     ['#3a4149', '#5c6570'],
  snow:      ['#8b98a3', '#d8dfe5'],
  fog:       ['#a8afb5', '#c9ced2'],
}
const CLOUD_COUNT = { clear: 0, few: 1, scattered: 2, broken: 3, overcast: 4, rain: 3, storm: 3, snow: 3, fog: 1 }

// Airport tower + runway, always the primary image — the weather (sun,
// clouds, rain, snow, lightning, fog) is just a small flourish layered on
// top of the same scene, not the main subject.
export function AirportScene({ condition = 'clear' }) {
  const [skyTop, skyBottom] = SKY[condition] || SKY.clear
  const showSun = condition === 'clear' || condition === 'few' || condition === 'scattered'
  const clouds = CLOUD_COUNT[condition] ?? 1
  const dim = condition === 'storm' ? 0.5 : 0.85

  return (
    <svg viewBox="0 0 400 90" preserveAspectRatio="xMidYMid slice" style={ART_STYLE}>
      <defs>
        <linearGradient id="apt-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={skyTop} />
          <stop offset="100%" stopColor={skyBottom} />
        </linearGradient>
        <linearGradient id="apt-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7a8f6b" />
          <stop offset="100%" stopColor="#5e7350" />
        </linearGradient>
      </defs>
      <rect width="400" height="90" fill="url(#apt-sky)" />

      {showSun && <circle cx="335" cy="22" r="13" fill="#ffd873" opacity="0.9" />}
      {Array.from({ length: clouds }).map((_, i) => (
        <ellipse key={i} cx={302 - i * 48} cy={16 + (i % 2) * 12} rx={21} ry={9} fill="#ffffff" opacity={dim} />
      ))}
      {condition === 'rain' && (
        <g stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" opacity="0.55">
          <line x1="268" y1="34" x2="264" y2="44" />
          <line x1="284" y1="32" x2="280" y2="42" />
          <line x1="300" y1="35" x2="296" y2="45" />
        </g>
      )}
      {condition === 'storm' && (
        <polygon points="288,20 280,36 288,36 282,50 298,30 289,30" fill="#ffe066" />
      )}
      {condition === 'snow' && (
        <g fill="#ffffff" opacity="0.9">
          <circle cx="266" cy="34" r="2" />
          <circle cx="282" cy="40" r="2" />
          <circle cx="298" cy="32" r="2" />
          <circle cx="290" cy="46" r="2" />
        </g>
      )}
      {condition === 'fog' && <rect x="0" y="48" width="400" height="20" fill="#ffffff" opacity="0.35" />}

      <rect y="58" width="400" height="32" fill="url(#apt-ground)" />

      {/* single runway, top-down, running left to right — inset from
          both edges equally so it clears the "Airports" side label */}
      <rect x="44" y="66" width="312" height="16" fill="#4b4f56" />

      {/* threshold "piano key" stripes at both ends */}
      <g fill="#e5e7eb" opacity="0.9">
        <rect x="50" y="67" width="10" height="2.5" />
        <rect x="50" y="71" width="10" height="2.5" />
        <rect x="50" y="75" width="10" height="2.5" />
        <rect x="50" y="79" width="10" height="2.5" />
        <rect x="340" y="67" width="10" height="2.5" />
        <rect x="340" y="71" width="10" height="2.5" />
        <rect x="340" y="75" width="10" height="2.5" />
        <rect x="340" y="79" width="10" height="2.5" />
      </g>

      {/* dashed centerline running between the two threshold marks */}
      <line x1="68" y1="74" x2="332" y2="74" stroke="#e5e7eb" strokeWidth="1.5" strokeDasharray="9 7" opacity="0.85" />
    </svg>
  )
}

export function PilotArt() {
  return (
    <svg viewBox="0 0 400 90" preserveAspectRatio="xMidYMid slice" style={ART_STYLE}>
      <defs>
        <linearGradient id="pilot-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1c2a5e" />
          <stop offset="100%" stopColor="#4a63c9" />
        </linearGradient>
      </defs>
      <rect width="400" height="90" fill="url(#pilot-bg)" />
      <circle cx="330" cy="45" r="55" fill="#ffffff" opacity="0.06" />

      {/* shoulders with captain's-stripe epaulettes — a clearer "pilot"
          cue than a plain bust silhouette */}
      <g transform="translate(50,8)">
        <path d="M8 78 Q58 52 108 78 L108 90 L8 90 Z" fill="#10173a" />
        <g fill="#f2c14e">
          <rect x="16" y="64" width="24" height="3.5" />
          <rect x="16" y="71" width="24" height="3.5" />
          <rect x="16" y="78" width="24" height="3.5" />
          <rect x="76" y="64" width="24" height="3.5" />
          <rect x="76" y="71" width="24" height="3.5" />
          <rect x="76" y="78" width="24" height="3.5" />
        </g>

        {/* head + peaked cap, clear brim and badge */}
        <circle cx="58" cy="36" r="19" fill="#10173a" />
        <ellipse cx="58" cy="26" rx="25" ry="5.5" fill="#0a0e24" />
        <path d="M35 27 a23 23 0 0 1 46 0 h-5 a18 18 0 0 0 -36 0 z" fill="#0a0e24" />
        <circle cx="58" cy="16" r="4" fill="#f2c14e" />
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
      <rect y="70" width="400" height="20" fill="#8a8f97" />

      {/* gable-roof hangar — bigger than before, not filling the whole card */}
      <polygon points="75,70 75,39 200,11 325,39 325,70" fill="#3d434c" />
      <polygon points="75,39 200,11 325,39 325,45 200,18 75,45" fill="#2a2f37" />

      {/* open hangar mouth */}
      <polygon points="128,70 128,45 200,26 292,45 292,70" fill="#0c0e12" />
    </svg>
  )
}

export function FlightPlanArt() {
  return (
    <svg viewBox="0 0 400 90" preserveAspectRatio="xMidYMid slice" style={ART_STYLE}>
      <defs>
        <linearGradient id="fp-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#e8dbb0" />
          <stop offset="100%" stopColor="#d8c68f" />
        </linearGradient>
      </defs>
      <rect width="400" height="90" fill="url(#fp-bg)" />

      {/* sectional-chart-style contour lines and grid — reads as "a map"
          without looking like the live Map button's road tiles */}
      <g stroke="#a3895a" strokeWidth="1" fill="none" opacity="0.45">
        <path d="M-10 20 Q80 0 160 24 T400 10" />
        <path d="M-10 55 Q100 35 220 58 T400 45" />
        <path d="M-10 82 Q120 66 260 84 T400 78" />
      </g>
      <g stroke="#a3895a" strokeWidth="0.75" opacity="0.3">
        <line x1="100" y1="0" x2="100" y2="90" />
        <line x1="220" y1="0" x2="220" y2="90" />
        <line x1="320" y1="0" x2="320" y2="90" />
      </g>

      {/* route line with waypoint dots */}
      <polyline points="40,68 150,32 260,52 360,18" fill="none" stroke="#1f3a5f" strokeWidth="2.5" strokeDasharray="1 7" strokeLinecap="round" opacity="0.95" />
      <circle cx="40" cy="68" r="5" fill="#1f3a5f" />
      <circle cx="150" cy="32" r="5" fill="#1f3a5f" />
      <circle cx="260" cy="52" r="5" fill="#1f3a5f" />
      <circle cx="360" cy="18" r="5" fill="#1f3a5f" />
    </svg>
  )
}
