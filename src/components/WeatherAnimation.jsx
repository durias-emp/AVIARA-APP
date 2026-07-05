// Maps METAR data to a visual condition + gradient
export function getCondition(metar) {
  if (!metar) return { type: 'clear', isNight: false }

  const wx = (metar.wxString || '').toUpperCase()
  const cover = (metar.cover || '').toUpperCase()
  const hour = new Date().getHours()
  const isNight = hour < 6 || hour >= 20

  if (wx.includes('TS'))                        return { type: 'storm',    isNight }
  if (wx.match(/\bSN\b|[-+]SN/))               return { type: 'snow',     isNight }
  if (wx.match(/RA|DZ|SH/))                     return { type: 'rain',     isNight }
  if (wx.match(/\bFG\b|\bBR\b|\bHZ\b|\bMI\b/)) return { type: 'fog',      isNight }
  if (cover === 'OVC')                           return { type: 'overcast', isNight }
  if (cover === 'BKN')                           return { type: 'broken',   isNight }
  if (cover === 'SCT')                           return { type: 'scattered',isNight }
  if (cover === 'FEW')                           return { type: 'few',      isNight }
  return { type: 'clear', isNight }
}

// Sky gradients — rich, layered like Apple Weather
const THEMES = {
  clear:     { day:  ['#1a91f0','#2fb0fa','#6dd0ff'], night: ['#060e28','#0c1840','#102050'] },
  few:       { day:  ['#1e98f5','#3db4ff','#7dcfff'], night: ['#081028','#0e1d45','#182e60'] },
  scattered: { day:  ['#4288cc','#5aa4de','#86c0ef'], night: ['#0c1d38','#152840','#1e3858'] },
  broken:    { day:  ['#607890','#7890a4','#90a8bc'], night: ['#14202c','#1c2c3c','#24384c'] },
  overcast:  { day:  ['#58687a','#6a7c8e','#7e909e'], night: ['#141c24','#1c2630','#24303c'] },
  rain:      { day:  ['#344e64','#3e5c74','#4e6e84'], night: ['#141e28','#1c2a36','#243242'] },
  storm:     { day:  ['#161e2c','#1c2436','#222c42'], night: ['#080c14','#0e121e','#141828'] },
  snow:      { day:  ['#a8bfd4','#bdd0e2','#d4e6f4'], night: ['#243040','#2e3c50','#3a4c62'] },
  fog:       { day:  ['#7a8c98','#8e9faa','#a2b2bc'], night: ['#181e24','#222830','#2c343e'] },
}

export function gradient(type, isNight) {
  const t = THEMES[type] || THEMES.clear
  const s = isNight ? t.night : t.day
  return `linear-gradient(180deg, ${s[0]} 0%, ${s[1]} 55%, ${s[2]} 100%)`
}

export function textColor(type, isNight) {
  if (!isNight && (type === 'snow' || type === 'fog')) return '#1a2a36'
  return '#ffffff'
}

// ── Sun ──────────────────────────────────────────────────────
function Sun() {
  return (
    <div style={{ position: 'absolute', top: 26, right: 36, width: 58, height: 58 }}>
      {/* Outer atmosphere haze */}
      <div style={{
        position: 'absolute',
        inset: -28,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(255,210,60,0.2) 0%, transparent 68%)',
        animation: 'sun-glow-pulse 5s ease-in-out infinite',
      }} />
      {/* Mid corona */}
      <div style={{
        position: 'absolute',
        inset: -12,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(255,225,90,0.28) 0%, transparent 65%)',
        animation: 'sun-glow-pulse 4s ease-in-out infinite',
        animationDelay: '0.5s',
      }} />
      {/* Sun disc */}
      <div style={{
        position: 'absolute', inset: 0,
        borderRadius: '50%',
        background: 'radial-gradient(circle at 38% 36%, #fff8e0 0%, #ffe555 35%, #ffcc00 75%, #f5a800 100%)',
        boxShadow: '0 0 20px 6px rgba(255,215,50,0.55), 0 0 42px 16px rgba(255,195,0,0.25)',
      }} />
    </div>
  )
}

// ── Moon ─────────────────────────────────────────────────────
function Moon() {
  return (
    <div style={{ position: 'absolute', top: 26, right: 34, width: 68, height: 68 }}>
      {/* Soft glow */}
      <div style={{
        position: 'absolute',
        inset: -20,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(190,210,255,0.25) 0%, transparent 65%)',
        animation: 'moon-glow 5s ease-in-out infinite',
      }} />
      {/* Moon disc */}
      <div style={{
        position: 'absolute', inset: 0,
        borderRadius: '50%',
        background: 'radial-gradient(circle at 40% 38%, #f0f4ff 0%, #d4dcf0 45%, #b8c4e0 100%)',
        boxShadow: '0 0 18px 5px rgba(180,205,255,0.4)',
        overflow: 'hidden',
      }}>
        {/* Crescent shadow */}
        <div style={{
          position: 'absolute',
          top: -8, right: -18,
          width: 66, height: 66,
          borderRadius: '50%',
          background: 'rgba(20,32,72,0.58)',
        }} />
        {/* Subtle surface detail */}
        <div style={{ position: 'absolute', top: 18, left: 14, width: 14, height: 14, borderRadius: '50%', background: 'rgba(160,180,220,0.3)' }} />
        <div style={{ position: 'absolute', top: 30, left: 26, width: 8,  height: 8,  borderRadius: '50%', background: 'rgba(160,180,220,0.25)' }} />
      </div>
    </div>
  )
}

// ── Stars ─────────────────────────────────────────────────────
const STAR_DATA = Array.from({ length: 18 }, (_, i) => ({
  top:   `${((i * 37 + 13) % 72)}%`,
  left:  `${((i * 61 + 7)  % 98)}%`,
  size:  i % 5 === 0 ? 2.5 : i % 3 === 0 ? 2 : 1.5,
}))

function Stars() {
  return (
    <>
      {STAR_DATA.map((s, i) => (
        <div key={i} style={{
          position: 'absolute',
          top: s.top, left: s.left,
          width: s.size, height: s.size,
          borderRadius: '50%',
          background: 'white',
          opacity: 0.8,
        }} />
      ))}
    </>
  )
}

// ── Clouds ───────────────────────────────────────────────────
// SVG-based cloud puffs with radial gradient highlights + underbelly shadow
function CloudBlob({ w = 200, tinted = false }) {
  const h = Math.round(w * 0.60)
  const uid = `cb${w}${tinted ? 1 : 0}`

  // Puff highlight: bright top-left, fades to transparent at edges
  // so overlapping puffs blend seamlessly (no hard borders)
  const hiColor  = tinted ? 'rgba(210,225,245,1)'   : 'rgba(255,255,255,1)'
  const midColor = tinted ? 'rgba(192,210,235,0.95)' : 'rgba(246,250,255,0.96)'
  const edgeStop = tinted ? 'rgba(175,198,228,0)'    : 'rgba(225,238,255,0)'
  const shadowC  = tinted ? 'rgba(120,150,185,0.52)' : 'rgba(148,178,215,0.48)'

  // [cx_frac, cy_frac, r_frac] — shape the cauliflower top
  const puffs = [
    [0.09, 0.68, 0.14],
    [0.20, 0.54, 0.21],
    [0.34, 0.41, 0.27],
    [0.50, 0.34, 0.32],
    [0.66, 0.42, 0.26],
    [0.80, 0.53, 0.21],
    [0.91, 0.63, 0.14],
    [0.42, 0.60, 0.19],
    [0.60, 0.61, 0.17],
    [0.27, 0.65, 0.16],
  ]

  return (
    <div>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible', display: 'block' }}>
        <defs>
          {/* Puff gradient — light source top-left, fades to transparent */}
          <radialGradient id={`${uid}-p`} cx="30%" cy="25%" r="76%" fx="30%" fy="25%">
            <stop offset="0%"   stopColor={hiColor} />
            <stop offset="42%"  stopColor={midColor} />
            <stop offset="86%"  stopColor={edgeStop} />
            <stop offset="100%" stopColor={edgeStop} />
          </radialGradient>
          {/* Underbelly shadow */}
          <radialGradient id={`${uid}-s`} cx="50%" cy="100%" r="58%">
            <stop offset="0%"   stopColor={shadowC} />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>
        </defs>

        {/* Shadow ellipse beneath cloud */}
        <ellipse
          cx={w * 0.50} cy={h * 0.90}
          rx={w * 0.43} ry={h * 0.15}
          fill={`url(#${uid}-s)`}
          opacity={0.85}
        />

        {/* Cloud puffs — each scales in from its own centre, staggered */}
        {puffs.map(([cxf, cyf, rf], i) => (
          <circle key={i}
            cx={w * cxf} cy={h * cyf} r={w * rf}
            fill={`url(#${uid}-p)`}
            style={{
              transformOrigin: `${w * cxf}px ${h * cyf}px`,
              animation: `cloud-puff-in 0.65s cubic-bezier(0.34, 1.56, 0.64, 1) both`,
              animationDelay: `${i * 0.07}s`,
            }}
          />
        ))}
      </svg>
    </div>
  )
}

const CLOUD_LAYERS = [
  { scale: 1.25, opacity: 0.92, top: '8%',  dur: 20, dir: 'cloud-slide',   floatDur: 9,  startFrac: 0.0  },
  { scale: 0.88, opacity: 0.88, top: '32%', dur: 15, dir: 'cloud-slide-r', floatDur: 7,  startFrac: 0.5  },
  { scale: 1.08, opacity: 0.80, top: '18%', dur: 24, dir: 'cloud-slide',   floatDur: 11, startFrac: 0.65 },
  { scale: 0.72, opacity: 0.95, top: '46%', dur: 17, dir: 'cloud-slide-r', floatDur: 8,  startFrac: 0.25 },
]

function Clouds({ count = 2, tinted = false }) {
  return (
    <>
      {CLOUD_LAYERS.slice(0, count).map((layer, i) => (
        // Outer div: one-shot entry (fade + rise). Opacity starts at 0 during delay.
        <div key={i} style={{
          position: 'absolute',
          top: layer.top,
          animation: `cloud-layer-in 1.6s cubic-bezier(0.16, 1, 0.3, 1) both`,
          animationDelay: `${i * 0.35}s`,
        }}>
          {/* Inner div: continuous slide + float */}
          <div style={{
            opacity: layer.opacity,
            animation: `${layer.dir} ${layer.dur}s linear infinite, cloud-float ${layer.floatDur}s ease-in-out infinite`,
            animationDelay: `${-(layer.dur * layer.startFrac)}s, ${i * 1.2}s`,
            willChange: 'transform',
          }}>
            <CloudBlob w={Math.round(190 * layer.scale)} tinted={tinted} />
          </div>
        </div>
      ))}
    </>
  )
}

// ── Rain ─────────────────────────────────────────────────────
// Single-element CSS background-position animation — compositor-only, zero DOM overhead
function Rain({ heavy = false }) {
  const color = heavy ? 'rgba(150,195,255,0.55)' : 'rgba(180,215,255,0.42)'
  const spacing = heavy ? '18px 28px' : '22px 36px'
  const dur = heavy ? '0.38s' : '0.55s'
  return (
    <div style={{
      position: 'absolute', inset: 0,
      backgroundImage: `repeating-linear-gradient(
        170deg,
        transparent 0px, transparent 8px,
        ${color} 8px, ${color} 10px
      )`,
      backgroundSize: spacing,
      animation: `wdRainVeil ${dur} linear infinite`,
      opacity: 0.85,
    }} />
  )
}

// ── Snow ─────────────────────────────────────────────────────
const SNOW_FLAKES = Array.from({ length: 28 }, (_, i) => ({
  left:  `${(i / 28) * 106 - 3}%`,
  size:  3 + (i % 4) * 2,
  opacity: 0.6 + (i % 3) * 0.15,
  dur:   3.5 + (i % 7) * 0.6,
  delay: (i * 0.22) % 4,
}))

function Snow() {
  return (
    <>
      {SNOW_FLAKES.map((f, i) => (
        <div key={i} style={{
          position: 'absolute',
          top: 0, left: f.left,
          width: f.size, height: f.size,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.9)',
          boxShadow: '0 0 3px rgba(255,255,255,0.6)',
          animation: `snow-drift ${f.dur}s ease-in-out infinite`,
          animationDelay: `${f.delay}s`,
          opacity: f.opacity,
        }} />
      ))}
    </>
  )
}

// ── Fog ──────────────────────────────────────────────────────
const FOG_BANDS = [
  { top: '18%', height: 32, dur: 14, delay: 0,   opacity: 0.5 },
  { top: '34%', height: 24, dur: 19, delay: -4,  opacity: 0.4 },
  { top: '50%', height: 36, dur: 12, delay: -2,  opacity: 0.45},
  { top: '64%', height: 28, dur: 16, delay: -7,  opacity: 0.38},
  { top: '76%', height: 20, dur: 22, delay: -10, opacity: 0.35},
]

function Fog() {
  return (
    <>
      {FOG_BANDS.map((b, i) => (
        <div key={i} style={{
          position: 'absolute',
          top: b.top,
          left: '-25%', right: '-25%',
          height: b.height * 3,
          background: `radial-gradient(ellipse 60% 50% at 50% 50%, rgba(255,255,255,0.85) 0%, transparent 100%)`,
          animation: `fog-layer ${b.dur}s ease-in-out infinite`,
          animationDelay: `${b.delay}s`,
          opacity: b.opacity,
        }} />
      ))}
    </>
  )
}

// ── Lightning ─────────────────────────────────────────────────
function Lightning() {
  return (
    <>
      {/* Ambient flash */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'rgba(210,230,255,0.7)',
        animation: 'lightning-flash 5s ease-in-out infinite',
        animationDelay: '1.2s',
        pointerEvents: 'none',
      }} />
      {/* Bolt SVG */}
      <svg
        style={{
          position: 'absolute', top: '15%', left: '42%',
          width: 28, height: 60,
          animation: 'lightning-bolt 5s ease-in-out infinite',
          animationDelay: '1.2s',
          filter: 'drop-shadow(0 0 6px rgba(200,230,255,0.9))',
        }}
        viewBox="0 0 28 60" fill="none">
        <path d="M18 2L4 34h10l-4 24L24 26H14L18 2Z" fill="rgba(255,255,255,0.95)" />
      </svg>
    </>
  )
}

// ── Main exported component ───────────────────────────────────
export default function WeatherAnimation({ metar }) {
  const { type, isNight } = getCondition(metar)
  const bg = gradient(type, isNight)

  const showSun      = !isNight && (type === 'clear' || type === 'few')
  const showMoon     = isNight  && (type === 'clear' || type === 'few' || type === 'scattered')
  const showStars    = isNight  && (type !== 'overcast' && type !== 'storm')
  const cloudCount   = { clear: 1, few: 1, scattered: 2, broken: 3, overcast: 4 }[type] ?? 0
  const cloudTinted  = type === 'broken' || type === 'overcast' || type === 'storm'
  const showRain     = type === 'rain' || type === 'storm'
  const showSnow     = type === 'snow'
  const showFog      = type === 'fog'
  const showLightning = type === 'storm'

  // Storm adds extra dark cloud layers
  const stormExtraClouds = type === 'storm' ? 4 : 0

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: bg,
      overflow: 'hidden',
      transition: 'background 2s ease',
    }}>
      {showStars    && <Stars />}
      {showMoon     && <Moon />}
      {showSun      && <Sun />}

      {/* Background cloud layer (slower, lighter) */}
      {cloudCount > 0 && (
        <Clouds count={Math.min(cloudCount, 2)} tinted={cloudTinted || isNight} />
      )}

      {/* Storm bonus clouds */}
      {stormExtraClouds > 0 && <Clouds count={4} tinted />}

      {showFog      && <Fog />}
      {showRain     && <Rain heavy={type === 'storm'} />}
      {showSnow     && <Snow />}
      {showLightning && <Lightning />}
    </div>
  )
}
