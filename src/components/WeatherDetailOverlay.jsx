import { DotLottieReact } from '@lottiefiles/dotlottie-react'
import {
  parseFltCat, parseWind, parseVisib, parseCloudLayers,
  parseTemp, parseAltim, parseWx, parseObsAge, parseFetchAge, parseTafAge, parseAirportName,
  FLTCAT, catFromCeilingVis, colorizeTaf,
} from '../lib/weather'
import { getCondition } from './WeatherAnimation'
import { lottieForCondition } from './LottieWeather'
import { IconRefresh, CopyIconButton } from './Icons'
import { usePilotProfile } from '../context/PilotProfile'

// ── Sky gradient per condition (matches WeatherAnimation themes) ──
const SKY = {
  clear:     { day: ['#1a91f0','#2fb0fa','#5ec8f8'], night: ['#060e28','#0c1840','#102050'] },
  few:       { day: ['#1e98f5','#3db4ff','#7dcfff'], night: ['#081028','#0e1d45','#182e60'] },
  scattered: { day: ['#4288cc','#5aa4de','#86c0ef'], night: ['#0c1d38','#152840','#1e3858'] },
  broken:    { day: ['#607890','#7890a4','#90a8bc'], night: ['#14202c','#1c2c3c','#24384c'] },
  overcast:  { day: ['#58687a','#6a7c8e','#7e909e'], night: ['#141c24','#1c2630','#24303c'] },
  rain:      { day: ['#344e64','#3e5c74','#4e6e84'], night: ['#141e28','#1c2a36','#243242'] },
  storm:     { day: ['#161e2c','#1c2436','#222c42'], night: ['#080c14','#0e121e','#141828'] },
  snow:      { day: ['#a8bfd4','#bdd0e2','#d4e6f4'], night: ['#243040','#2e3c50','#3a4c62'] },
  fog:       { day: ['#7a8c98','#8e9faa','#a2b2bc'], night: ['#181e24','#222830','#2c343e'] },
}

function skyGradient(type, isNight) {
  const t = SKY[type] ?? SKY.clear
  const s = isNight ? t.night : t.day
  return `linear-gradient(180deg, ${s[0]} 0%, ${s[1]} 55%, ${s[2]} 100%)`
}

function skyBottomColor(type, isNight) {
  const t = SKY[type] ?? SKY.clear
  const s = isNight ? t.night : t.day
  return s[2]
}

// ── Glass panel style ──────────────────────────────────────────
const GLASS = {
  background: 'rgba(12,20,30,0.36)',
  border: '1px solid rgba(255,255,255,0.18)',
  boxShadow: 'inset 0 1px rgba(255,255,255,0.12), 0 8px 24px rgba(0,0,0,0.22)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  borderRadius: 22,
}

// ── Helpers ────────────────────────────────────────────────────
function getHazards(metar) {
  if (!metar) return []
  const pills = []
  const wx = (metar.wxString ?? '').toUpperCase()
  if (wx.match(/\bRA\b|DZ|SH/)) pills.push('RAIN')
  if (wx.includes('TS'))         pills.push('TSTORM')
  if (wx.match(/\bFG\b|\bBR\b/)) pills.push('LOW VIS')
  if (metar.wgst && Number(metar.wgst) > 15) pills.push('GUSTS')
  const cld = metar.clouds?.find(c => c.cover === 'BKN' || c.cover === 'OVC')
  if (cld && Number(cld.base) < 3000) pills.push('LOW CIG')
  return pills
}

function pilotSummary(metar, cat) {
  if (!metar || !cat) return null
  const wx = (metar.wxString ?? '').toLowerCase()
  const cld = metar.clouds?.find(c => c.cover === 'BKN' || c.cover === 'OVC')
  const ceilFt = cld ? Number(cld.base) : null
  const vis = parseFloat(metar.visib ?? '99')
  const limiter = ceilFt !== null && vis >= 3
    ? `Ceiling at ${ceilFt.toLocaleString()} ft is the limiting factor.`
    : ceilFt !== null && vis < 3
    ? `Low ceiling and visibility both limiting.`
    : vis < 3
    ? `Visibility ${vis} SM is the limiting factor.`
    : ''
  const wxNote = wx ? `, ${wx}` : ''
  switch (cat.label) {
    case 'VFR':  return `Clear conditions for VFR flight. ${limiter}`.trim()
    case 'MVFR': return `Marginal VFR${wxNote}. ${limiter}`.trim()
    case 'IFR':  return `IFR conditions — instrument rating required. ${limiter}`.trim()
    case 'LIFR': return `Low IFR — exercise extreme caution. ${limiter}`.trim()
    default:     return null
  }
}

function decisionHeadline(cat) {
  switch (cat?.label) {
    case 'VFR':  return 'Go conditions'
    case 'MVFR': return 'Marginal VFR'
    case 'IFR':  return 'IFR conditions'
    case 'LIFR': return 'Low IFR'
    default:     return 'Weather data'
  }
}

function deriveTafCat(f) {
  const cld = f.clouds?.find(c => c.cover === 'BKN' || c.cover === 'OVC')
  const ceilFt = cld ? Number(cld.base) : null
  const raw = f.visib ?? '10'
  const visSm = raw === '6+' || raw === 'P6SM' ? 10 : parseFloat(raw) || 10
  return catFromCeilingVis(ceilFt, visSm)
}

function parseTafPeriods(taf) {
  const fcsts = Array.isArray(taf?.fcst) ? taf.fcst
    : Array.isArray(taf?.fcsts) ? taf.fcsts : []
  return fcsts.slice(0, 5).map((f, i) => {
    const date = f.timeFrom ? new Date(f.timeFrom * 1000) : null
    const label = date ? `${String(date.getUTCHours()).padStart(2,'0')}Z` : '—'
    const cat = FLTCAT[f.fltCat] ?? deriveTafCat(f)
    const topCloud = f.clouds?.find(c => c.cover === 'BKN' || c.cover === 'OVC')
                  ?? f.clouds?.[0]
    const wx = f.wxString ?? (topCloud?.cover ?? 'CLR')
    return { label: i === 0 ? 'Now' : label, cat, wx }
  })
}

// ── Trend — is the TAF outlook improving, deteriorating, or steady
// compared to current conditions? Ranked by flight-category severity
// (higher rank = more restrictive), same FLTCAT grading used everywhere else.
const CAT_RANK = { VFR: 0, MVFR: 1, IFR: 2, LIFR: 3 }

function deriveTrend(currentCat, periods) {
  const future = periods.filter(p => p.label !== 'Now' && p.cat)
  if (!currentCat || !future.length) return null
  const curRank = CAT_RANK[currentCat.label] ?? 0
  const lastCat = future[future.length - 1].cat
  const lastRank = CAT_RANK[lastCat.label] ?? 0
  if (lastRank > curRank) return { label: 'Deteriorating', arrow: '↘', color: lastCat.color }
  if (lastRank < curRank) return { label: 'Improving', arrow: '↗', color: FLTCAT.VFR.color }
  return { label: 'Steady', arrow: '→', color: 'rgba(255,255,255,0.72)' }
}

// ── Glass pill ─────────────────────────────────────────────────
function GlassPill({ children, style }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      minHeight: 28, borderRadius: 999, padding: '0 12px',
      fontSize: 12, fontWeight: 800, color: 'rgba(255,255,255,0.9)',
      background: 'rgba(12,20,30,0.36)',
      border: '1px solid rgba(255,255,255,0.22)',
      boxShadow: 'inset 0 1px rgba(255,255,255,0.14)',
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
      ...style,
    }}>{children}</span>
  )
}

// ── "Copied" chip — smoothly fades/slides in next to a copy button,
// then fades back out when `show` flips false (the element stays mounted
// so the exit gets the same transition as the entrance). ────────────
function CopiedChip({ show }) {
  return (
    <span aria-hidden={!show} style={{
      display: 'inline-flex', alignItems: 'center',
      fontSize: 11, fontWeight: 800, letterSpacing: '0.02em',
      padding: '5px 10px', borderRadius: 999,
      color: '#fff',
      background: 'rgba(52,199,89,0.9)',
      opacity: show ? 1 : 0,
      transform: show ? 'translateY(0) scale(1)' : 'translateY(-4px) scale(0.94)',
      transition: 'opacity 0.22s ease, transform 0.22s ease',
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
    }}>
      Copied
    </span>
  )
}

// ── Raw text row — one METAR or TAF block within the shared card ──
// `colorize` splits the text into its forecast groups and colors each line
// by flight category (same grading as the VFR/MVFR/IFR/LIFR chip), matching
// how apps like ForeFlight color-code raw TAF text.
function RawTextRow({ title, text, onCopy, copiedText, last, colorize, age }) {
  if (!text) return null
  const lines = colorize ? colorizeTaf(text) : null
  const copied = copiedText === text
  return (
    <div style={{ marginBottom: last ? 0 : 16 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', marginBottom: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>
            {title}
          </span>
          {age && <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.6)' }}>{age}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CopiedChip show={copied} />
          <CopyIconButton onCopy={() => onCopy(text)} copied={copied} onDark />
        </div>
      </div>
      {lines ? (
        <div style={{
          fontSize: 12,
          fontFamily: '"SF Mono", ui-monospace, Menlo, Consolas, monospace',
          lineHeight: 1.65,
        }}>
          {lines.map((l, i) => (
            <div key={i} style={{ color: l.color }}>{l.text}</div>
          ))}
        </div>
      ) : (
        <p style={{
          margin: 0, fontSize: 12,
          color: 'rgba(255,255,255,0.72)',
          fontFamily: '"SF Mono", ui-monospace, Menlo, Consolas, monospace',
          lineHeight: 1.55,
        }}>
          {text}
        </p>
      )}
    </div>
  )
}

// ── Combined METAR + TAF card ────────────────────────────────────
function RawTextCard({ metarText, tafText, metarAge, tafAge, onCopy, copiedText }) {
  if (!metarText && !tafText) return null
  return (
    <div style={{ ...GLASS, padding: '16px 18px', marginBottom: 12 }}>
      <RawTextRow title="Raw METAR" text={metarText} age={metarAge} onCopy={onCopy} copiedText={copiedText} last={!tafText} />
      <RawTextRow title="Raw TAF" text={tafText} age={tafAge} onCopy={onCopy} copiedText={copiedText} last colorize />
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────
export default function WeatherDetailOverlay({
  wx, icao, loading, error, isStale,
  closing, cardRect,
  onClose, onRefresh, onCopyMetar, copiedText, onOpenPicker,
}) {
  const { profile } = usePilotProfile()
  const units = profile ?? {}
  const metar = wx?.metar ?? null
  const { type, isNight } = getCondition(metar)
  const cat = metar ? parseFltCat(metar) : null
  const hazards = getHazards(metar)
  const summary = pilotSummary(metar, cat)
  const tafPeriods = parseTafPeriods(wx?.taf)
  const trend = deriveTrend(cat, tafPeriods)
  const cloudLayers = parseCloudLayers(metar, units)

  const conditionLabel = parseWx(metar) ?? (type.charAt(0).toUpperCase() + type.slice(1))

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        overflowY: 'auto',
        overflowX: 'hidden',
        WebkitOverflowScrolling: 'touch',
        overscrollBehavior: 'none',
        backgroundColor: skyBottomColor(type, isNight),
      }}
    >
      {/* Content wrapper — matches app shell width */}
      <div style={{ width: '100%', minHeight: '100%', position: 'relative' }}>

        {/* Sky backdrop inside the content wrapper so it expands with content height */}
        <div style={{
          position: 'absolute', inset: 0,
          background: skyGradient(type, isNight),
          overflow: 'hidden',
          zIndex: 0,
          pointerEvents: 'none',
        }}>
          <div className="wd-cloud-bank wd-bank-back" />
          <div className="wd-cloud-bank wd-bank-mid" />
          <div className="wd-cloud-bank wd-bank-front" />
          <div className="wd-cloud-wisp wd-wisp-one" />
          <div className="wd-cloud-wisp wd-wisp-two" />
          {(type === 'rain' || type === 'storm') && (
            <>
              <div className="wd-rain-curtain" />
              <div className="wd-rain-sheet" />
              <div className="wd-atmospheric-haze wd-haze-high" />
              <div className="wd-atmospheric-haze wd-haze-low" />
            </>
          )}
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, height: '60%',
            background: 'linear-gradient(to bottom, transparent 0%, rgba(4,9,15,0.55) 100%)',
          }} />
        </div>

        {/* Scrollable content column */}
        <div style={{
          position: 'relative', zIndex: 2, padding: 'calc(52px + env(safe-area-inset-top)) 20px calc(48px + env(safe-area-inset-bottom))',
        }}>

          {/* ── Top bar ── */}
          <div style={{
            display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', marginBottom: 0,
          }}>
            {/* Back */}
            <button onClick={onClose} style={{
              width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
              background: 'rgba(255,255,255,0.14)',
              border: '1px solid rgba(255,255,255,0.22)',
              backdropFilter: 'blur(12px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: 'white',
            }}>
              <svg width={21} height={21} viewBox="0 0 24 24" fill="none">
                <path d="M15 18L9 12l6-6" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {/* ICAO + label */}
            <div style={{ textAlign: 'center' }}>
              <div style={{
                fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.6)',
                textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2,
              }}>
                Home airport
              </div>
              <div
                onClick={onOpenPicker}
                style={{
                  fontSize: 30, fontWeight: 800, color: '#fff',
                  letterSpacing: '-0.5px', lineHeight: 1,
                  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
                  cursor: 'pointer',
                }}
              >
                {icao || '—'}
              </div>
            </div>

            {/* Refresh */}
            <button onClick={onRefresh} disabled={loading} style={{
              width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
              background: 'rgba(255,255,255,0.14)',
              border: '1px solid rgba(255,255,255,0.22)',
              backdropFilter: 'blur(12px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: loading ? 'default' : 'pointer', color: 'white',
              animation: loading ? 'spin-ccw 1s linear infinite' : 'none',
            }}>
              <IconRefresh size={20} />
            </button>
          </div>

          {/* ── Hero ── */}
          <div style={{
            position: 'relative',
            minHeight: 210, display: 'flex', flexDirection: 'column',
            alignItems: 'center', textAlign: 'center',
            justifyContent: 'flex-end', paddingBottom: 26, paddingTop: 18,
          }}>
            {/* Weather icon animation — sits behind the temperature as a soft
                background flourish, same idea as the compact card's preview,
                not a foreground graphic competing with the numbers */}
            {metar && (
              <div style={{
                position: 'absolute', top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                width: 220, height: 220, zIndex: 0,
                pointerEvents: 'none', opacity: 0.85,
              }}>
                <DotLottieReact
                  key={lottieForCondition(type, isNight)}
                  src={lottieForCondition(type, isNight)}
                  loop autoplay
                  style={{ width: '100%', height: '100%' }}
                />
              </div>
            )}

            <div style={{ position: 'relative', zIndex: 1 }}>
              {metar ? (
                <>
                  {/* Flight category pill sits above the temperature — color-coded
                      per the standard VFR/MVFR/IFR/LIFR scheme so it reads at a glance */}
                  {cat && (
                    <div style={{ marginBottom: 16 }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        minHeight: 28, borderRadius: 999, padding: '0 14px',
                        fontSize: 13, fontWeight: 800, letterSpacing: '0.06em',
                        color: '#fff', background: cat.color,
                        boxShadow: `0 2px 10px ${cat.color}66`,
                      }}>{cat.label}</span>
                    </div>
                  )}

                  {/* Temp — the headline number, bold and tight */}
                  <div style={{ marginBottom: 8 }}>
                    <span style={{
                      fontSize: 108, fontWeight: 800, lineHeight: 0.85,
                      letterSpacing: '-5px', color: '#fff',
                      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
                    }}>
                      {parseTemp(metar, units).replace(units.unitTemperature ?? '°C', '')}°
                    </span>
                  </div>

                  {/* Condition label right below temperature */}
                  <div style={{
                    fontSize: 22, fontWeight: 600, marginBottom: 14,
                    color: 'rgba(255,255,255,0.82)',
                  }}>
                    {conditionLabel}
                  </div>

                  {/* Airport name below condition */}
                  <div style={{
                    fontSize: 20, fontWeight: 600,
                    color: 'rgba(255,255,255,0.72)',
                  }}>
                    {parseAirportName(metar) ?? icao}
                  </div>
                </>
              ) : loading ? (
                <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 15 }}>
                  Fetching weather…
                </div>
              ) : error ? (
                <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 15 }}>{error}</div>
              ) : null}
            </div>
          </div>

          {metar && (
            <>
              {/* ── Raw METAR / Raw TAF — first cards below the hero ── */}
              <RawTextCard
                metarText={metar.rawOb} tafText={wx?.taf?.rawTAF}
                metarAge={parseObsAge(metar)} tafAge={parseTafAge(wx?.taf)}
                onCopy={onCopyMetar} copiedText={copiedText}
              />

              {/* ── Pilot readout ── */}
              {summary && (
                <div style={{ ...GLASS, padding: '11px 14px', marginBottom: 12 }}>
                  <div style={{
                    display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', gap: 10, marginBottom: 5,
                  }}>
                    <div style={{
                      fontSize: 13, fontWeight: 700, color: '#fff', letterSpacing: '-0.1px',
                    }}>
                      {decisionHeadline(cat)}
                    </div>
                    {parseObsAge(metar) && (
                      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {parseObsAge(metar)}
                      </span>
                    )}
                  </div>
                  <div style={{
                    fontSize: 12, color: 'rgba(255,255,255,0.65)', lineHeight: 1.45,
                  }}>
                    {summary}
                  </div>
                </div>
              )}

              {/* ── TAF outlook ── */}
              {tafPeriods.length > 0 && (
                <div style={{ ...GLASS, marginBottom: 12, padding: '16px 18px' }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginBottom: 14,
                  }}>
                    <div style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>
                      TAF Outlook
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {trend && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 3,
                          fontSize: 11, fontWeight: 800, color: trend.color,
                        }}>
                          {trend.arrow} {trend.label}
                        </span>
                      )}
                      <div style={{
                        fontSize: 12, fontWeight: 700,
                        color: 'rgba(255,255,255,0.56)',
                      }}>
                        Next {tafPeriods.length * 3}+ hr
                      </div>
                    </div>
                  </div>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${Math.min(tafPeriods.length, 4)}, 1fr)`,
                    gap: 8,
                  }}>
                    {tafPeriods.slice(0, 4).map((period, i) => (
                      <div key={i} style={{
                        background: 'rgba(12,20,30,0.34)',
                        border: '1px solid rgba(255,255,255,0.16)',
                        borderRadius: 18, padding: '12px 10px',
                        backdropFilter: 'blur(10px)',
                        WebkitBackdropFilter: 'blur(10px)',
                        minHeight: 84,
                      }}>
                        <div style={{
                          fontSize: 11, fontWeight: 700,
                          color: 'rgba(255,255,255,0.56)', marginBottom: 10,
                        }}>
                          {period.label}
                        </div>
                        <div style={{
                          fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 6,
                        }}>
                          {period.cat?.label ?? '—'}
                        </div>
                        <div style={{
                          fontSize: 11, fontWeight: 600,
                          color: 'rgba(255,255,255,0.56)',
                        }}>
                          {period.wx}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Metric grid ── */}
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr',
                gap: 10, marginBottom: 12,
              }}>
                {[
                  {
                    label: 'Wind',
                    value: parseWind(metar, units),
                    sub: metar.wgst ? `${metar.wgst} kt gusts` : 'steady',
                  },
                  {
                    label: 'Visibility',
                    value: parseVisib(metar, units),
                    sub: parseWx(metar) ?? 'unrestricted',
                  },
                  {
                    label: 'Spread',
                    value: (metar.temp != null && metar.dewp != null)
                       ? `${(metar.temp - metar.dewp).toFixed(0)}°`
                       : '—',
                    sub: (metar.temp != null && metar.dewp != null)
                       ? (metar.temp - metar.dewp <= 3 ? 'narrow — fog risk' : 'wide — low fog risk')
                       : '—',
                  },
                  {
                    label: 'Altimeter',
                    value: parseAltim(metar, units),
                    sub: 'inHg · local QNH',
                  },
                ].map(({ label, value, sub }) => (
                  <div key={label} style={{
                    ...GLASS,
                    minHeight: 100, borderRadius: 20,
                    padding: '14px 16px',
                    display: 'flex', flexDirection: 'column',
                  }}>
                    <div style={{
                      fontSize: 11, fontWeight: 700,
                      color: 'rgba(255,255,255,0.56)',
                      textTransform: 'uppercase', letterSpacing: '0.06em',
                    }}>
                      {label}
                    </div>
                    <div style={{
                      fontSize: 20, fontWeight: 700, color: '#fff',
                      lineHeight: 1, marginTop: 'auto', paddingTop: 10,
                      letterSpacing: '-0.3px',
                    }}>
                      {value}
                    </div>
                    {sub && (
                      <div style={{
                        fontSize: 12, fontWeight: 600,
                        color: 'rgba(255,255,255,0.5)', marginTop: 5,
                      }}>
                        {sub}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* ── Cloud layers — every reported layer, not just the ceiling ── */}
              <div style={{ ...GLASS, padding: '16px 18px', marginBottom: 12 }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: '#fff', marginBottom: 12 }}>
                  Cloud Layers
                </div>
                {cloudLayers.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {cloudLayers.map((l, i) => {
                      const isCeiling = l.cover === 'BKN' || l.cover === 'OVC'
                      return (
                        <div key={i} style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '9px 12px', borderRadius: 12,
                          background: 'rgba(12,20,30,0.34)',
                          border: '1px solid rgba(255,255,255,0.14)',
                        }}>
                          <span style={{
                            fontSize: 11, fontWeight: 800, letterSpacing: '0.04em',
                            color: isCeiling ? cat?.color ?? '#fff' : 'rgba(255,255,255,0.7)',
                            minWidth: 34,
                          }}>
                            {l.cover}
                          </span>
                          <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>
                            {l.label}
                          </span>
                          {isCeiling && (
                            <span style={{
                              marginLeft: 'auto', fontSize: 10, fontWeight: 700,
                              color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase',
                            }}>
                              ceiling
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)' }}>
                    {metar?.cover === 'CAVOK' ? 'CAVOK — no significant cloud' : 'Clear — no layers reported'}
                  </div>
                )}
              </div>

              {/* ── Hazard pills ── */}
              {hazards.length > 0 && (
                <div style={{
                  display: 'flex', gap: 8, marginBottom: 12,
                  flexWrap: 'wrap',
                }}>
                  {hazards.map(h => (
                    <GlassPill key={h} style={{ padding: '0 14px', letterSpacing: '0.04em' }}>
                      {h}
                    </GlassPill>
                  ))}
                </div>
              )}

              {/* ── Stale warning ── */}
              {isStale && (
                <div style={{
                  ...GLASS, marginBottom: 12,
                  padding: '10px 16px', borderRadius: 14,
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                      stroke="#FFD60A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <line x1="12" y1="9" x2="12" y2="13" stroke="#FFD60A" strokeWidth="1.5" strokeLinecap="round"/>
                    <line x1="12" y1="17" x2="12.01" y2="17" stroke="#FFD60A" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                  <span style={{ fontSize: 12, color: '#FFD60A', fontWeight: 600 }}>
                    Cached · {parseFetchAge(wx?.fetchedAt)}
                  </span>
                </div>
              )}

            </>
          )}
        </div>
      </div>
    </div>
  )
}
