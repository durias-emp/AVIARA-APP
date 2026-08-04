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

// A planning table seen from above: the chart itself is the surface, running
// edge to edge, with the tools you'd actually have out on it — a plotter, two
// pencils and a pair of dividers. The route is drawn last so the dotted line
// and its waypoints always sit on top of the scene, never behind a tool.
//
// The chart deliberately bleeds past all four edges rather than sitting on a
// visible desk: at the card's proportions any margin around it showed up as
// two dark wedges in the corners, which read as blemishes rather than as a
// table. Only the tools cast shadows now, which is what sells the depth.
//
// Note the tools are kept clear of the route's own path (40,68 → 150,32 →
// 260,52 → 360,18): the plotter rides above it along the top edge, the
// pencils below it bottom-left, the dividers in the open wedge on the right.
export function FlightPlanArt() {
  return (
    <svg viewBox="0 0 400 90" preserveAspectRatio="xMidYMid slice" style={ART_STYLE}>
      <defs>
        <linearGradient id="fp-paper" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f0e6c6" />
          <stop offset="100%" stopColor="#d9c68d" />
        </linearGradient>
        <linearGradient id="fp-pencil" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f0c651" />
          <stop offset="100%" stopColor="#c99a22" />
        </linearGradient>
        <filter id="fp-lift" x="-20%" y="-40%" width="140%" height="200%">
          <feDropShadow dx="0" dy="1.4" stdDeviation="1.6" floodColor="#2a1c0e" floodOpacity="0.45" />
        </filter>
      </defs>

      {/* the chart, full bleed */}
      <rect width="400" height="90" fill="url(#fp-paper)" />

      {/* fold creases — straight, the way a sectional actually folds, and
          carried past the edges so none of them stops short of one */}
      <g transform="rotate(-1.6 200 45)">
        <g stroke="#b09a67" strokeOpacity="0.5" strokeWidth="0.8">
          <line x1="132" y1="-12" x2="132" y2="102" />
          <line x1="268" y1="-12" x2="268" y2="102" />
          <line x1="-12" y1="46" x2="412" y2="46" />
        </g>
        <g stroke="#fff" strokeOpacity="0.35" strokeWidth="0.8">
          <line x1="133.5" y1="-12" x2="133.5" y2="102" />
          <line x1="269.5" y1="-12" x2="269.5" y2="102" />
          <line x1="-12" y1="47.5" x2="412" y2="47.5" />
        </g>
      </g>

      {/* compass rose on the chart */}
      <g transform="translate(210 70)" opacity="0.5">
        <circle r="10.5" fill="none" stroke="#8d7444" strokeWidth="0.9" />
        <circle r="6" fill="none" stroke="#8d7444" strokeWidth="0.6" />
        <path d="M0 -10.5 L2.6 0 L0 10.5 L-2.6 0 Z" fill="#8d7444" />
        <path d="M-10.5 0 L0 -2.2 L10.5 0 L0 2.2 Z" fill="#8d7444" opacity="0.6" />
      </g>

      {/* navigation plotter — clear plastic, riding above the route */}
      <g transform="translate(188 8) rotate(3)" filter="url(#fp-lift)">
        <rect width="142" height="12" rx="1.5" fill="#eaf4fb" fillOpacity="0.5" stroke="#fff" strokeOpacity="0.75" strokeWidth="0.8" />
        <g stroke="#24384f" strokeOpacity="0.5" strokeWidth="0.7">
          {[12, 24, 36, 48, 60, 72, 84, 96, 108, 120, 132].map(x => (
            <line key={x} x1={x} y1="0" x2={x} y2={x % 24 === 0 ? 6 : 3.5} />
          ))}
        </g>
      </g>

      {/* two pencils, bottom-left */}
      {[
        { t: 'translate(110 64) rotate(-6)' },
        { t: 'translate(114 72) rotate(3)' },
      ].map(({ t }, i) => (
        <g key={i} transform={t} filter="url(#fp-lift)">
          <polygon points="0,0 -9,3 0,6" fill="#e0b378" />
          <polygon points="-9,3 -4.5,1.5 -4.5,4.5" fill="#2f2f33" />
          <rect x="0" y="0" width="54" height="6" fill="url(#fp-pencil)" />
          <rect x="54" y="0" width="6" height="6" fill="#b9c0c8" />
          <rect x="60" y="0" width="6" height="6" rx="2" fill="#dd8377" />
        </g>
      ))}

      {/* dividers, stepping off a distance in the open wedge on the right */}
      <g filter="url(#fp-lift)">
        <g stroke="#9aa4b0" strokeWidth="3.2" strokeLinecap="round">
          <line x1="330" y1="50" x2="312" y2="77" />
          <line x1="330" y1="50" x2="349" y2="76" />
        </g>
        <line x1="312" y1="77" x2="312" y2="80.5" stroke="#3b4149" strokeWidth="1.6" strokeLinecap="round" />
        <line x1="349" y1="76" x2="349" y2="79.5" stroke="#3b4149" strokeWidth="1.6" strokeLinecap="round" />
        <rect x="327" y="38" width="6" height="11" rx="3" fill="#c9a227" />
        <circle cx="330" cy="50" r="4.2" fill="#c9a227" />
      </g>

      {/* route line with waypoint dots — always the topmost layer */}
      <polyline points="40,68 150,32 260,52 360,18" fill="none" stroke="#1f3a5f" strokeWidth="2.5" strokeDasharray="1 7" strokeLinecap="round" opacity="0.95" />
      <circle cx="40" cy="68" r="5" fill="#1f3a5f" />
      <circle cx="150" cy="32" r="5" fill="#1f3a5f" />
      <circle cx="260" cy="52" r="5" fill="#1f3a5f" />
      <circle cx="360" cy="18" r="5" fill="#1f3a5f" />
    </svg>
  )
}
