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

// A pair of aviators, outlined, on the left of the card — the right-hand
// side stays clear for the currency/medical/total-time readout that PilotRow
// lays over the top.
//
// This replaced a drawn pilot. Two attempts at a figure (a uniformed bust,
// then a restroom-sign pictogram) both read as a pirate, and the reason is
// scale rather than draughtsmanship: 64px of card height leaves a body about
// 40px tall, and at that size a peaked cap and a shirt collar collapse into
// a tricorn and a sash however they are drawn. The glasses carry the same
// "pilot" meaning in a shape that survives being small, because they are one
// recognisable outline instead of a figure whose details have to land.
//
// Drawn inside y 26–64. The card is 64px tall against a 90-unit viewBox on
// `slice`, so roughly the top and bottom 9 units are cropped at phone width;
// sitting well inside that band is what keeps the glasses whole. The left
// edge clears x 34, where the vertical "Pilot" label ends.
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

      {/* A filled silhouette rather than a stroked outline, with the lenses
          carrying nearly the whole shape: a thin brow bar across the middle
          of the top, big teardrop lenses hanging off it, a short nose piece
          between them, and a hinge nub at each outer edge.

          Light rather than dark, which the reference silhouette is not. The
          card darkens towards the left under its scrim, and the glasses sit
          in that darkest quarter — a near-black silhouette there disappears
          into the background instead of reading as a shape.

          The right lens is the left one mirrored about x=88, so the pair
          cannot drift out of symmetry when the shape is tweaked. Everything
          sits inside y 29–61: a 744px-wide desktop card shows only about
          y 28–62 of this 90-unit viewBox, so that band is what it takes to
          keep the glasses whole on a laptop as well as on a phone. */}
      {/* The helmet is the project's own logo (brand/pqrh-logo-source.jpeg,
          downscaled to 320px as public/pilot-helmet.png), drawn as light ink
          on the navy card.

          PNG rather than JPEG, and not for quality: the service worker's
          globPatterns precache js/css/html/ico/png/svg/woff2, so a .jpg here
          would ship but never reach the offline cache, and the card would
          come up empty in the air. A 320px PNG is 66kB, in line with the
          aircraft photos already precached alongside it.

          It is masked rather than filtered. The source is dark engraving on
          cream, and simply inverting it would reverse every tone: the goggle
          lenses, which read as pale glass, would go dark. Instead the image
          drives a luminance mask over a flat light fill, so the drawing keeps
          its own tonal sense and only changes colour. The transfer curve is
          steep on purpose — it drives the cream ground to zero so the card
          shows through it cleanly instead of carrying a pale rectangle.

          The masked rect covers only the helmet's own box, which is how the
          "PQRH" wordmark is dropped: it sits at roughly y 75-80 in these
          units, outside the rect, so it is never painted. */}
      <defs>
        <filter id="pilot-ink" x="0" y="0" width="100%" height="100%">
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncR type="table" tableValues="1 1 1 0.95 0.85 0.65 0.42 0.2 0.05 0 0" />
            <feFuncG type="table" tableValues="1 1 1 0.95 0.85 0.65 0.42 0.2 0.05 0 0" />
            <feFuncB type="table" tableValues="1 1 1 0.95 0.85 0.65 0.42 0.2 0.05 0 0" />
          </feComponentTransfer>
        </filter>
        <mask id="pilot-helmet" maskUnits="userSpaceOnUse" x="44" y="12" width="60.9" height="60">
          <image href="/pilot-helmet.png" x="13.89" y="-13.64" width="121.8" height="121.8" filter="url(#pilot-ink)" preserveAspectRatio="none" />
        </mask>
      </defs>
      <rect x="44" y="12" width="60.9" height="60" fill="#e8edf9" mask="url(#pilot-helmet)" />
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
