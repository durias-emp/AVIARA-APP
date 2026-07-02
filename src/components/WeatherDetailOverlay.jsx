import {
  parseFltCat, parseWind, parseVisib, parseCeiling,
  parseTemp, parseAltim, parseWx, parseObsAge, parseFetchAge, parseAirportName,
  FLTCAT,
} from '../lib/weather'
import { getCondition } from './WeatherAnimation'
import { IconRefresh } from './Icons'

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
  if ((ceilFt !== null && ceilFt < 500) || visSm < 1)  return FLTCAT.LIFR
  if ((ceilFt !== null && ceilFt < 1000) || visSm < 3) return FLTCAT.IFR
  if ((ceilFt !== null && ceilFt < 3000) || visSm < 5) return FLTCAT.MVFR
  return FLTCAT.VFR
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

// ── Main component ─────────────────────────────────────────────
export default function WeatherDetailOverlay({
  wx, icao, loading, error, isStale,
  closing, cardRect,
  onClose, onRefresh, onCopyMetar, copied, onOpenPicker,
}) {
  const metar = wx?.metar ?? null
  const { type, isNight } = getCondition(metar)
  const cat = metar ? parseFltCat(metar) : null
  const hazards = getHazards(metar)
  const summary = pilotSummary(metar, cat)
  const tafPeriods = parseTafPeriods(wx?.taf)

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
          position: 'relative', zIndex: 2, padding: '52px 20px 48px',
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
            minHeight: 210, display: 'flex', flexDirection: 'column',
            justifyContent: 'flex-end', paddingBottom: 18, paddingTop: 18,
          }}>
            {metar ? (
              <>
                {/* Airport name row with VFR pill on the right */}
                <div style={{
                  display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between', marginBottom: 6,
                }}>
                  <div style={{
                    fontSize: 20, fontWeight: 600,
                    color: 'rgba(255,255,255,0.72)',
                  }}>
                    {parseAirportName(metar) ?? icao}
                  </div>
                  {cat && <GlassPill>{cat.label}</GlassPill>}
                </div>

                {/* Temp row */}
                <div style={{ marginBottom: 4 }}>
                  <span style={{
                    fontSize: 108, fontWeight: 200, lineHeight: 0.88,
                    letterSpacing: '-3px', color: '#fff',
                    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
                  }}>
                    {parseTemp(metar).replace('°C', '')}°
                  </span>
                </div>

                {/* Condition label sits below temperature */}
                <div style={{
                  fontSize: 22, fontWeight: 600, marginBottom: 18,
                  color: 'rgba(255,255,255,0.82)',
                }}>
                  {conditionLabel}
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

          {metar && (
            <>
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
                      <GlassPill style={{ fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {parseObsAge(metar)}
                      </GlassPill>
                    )}
                  </div>
                  <div style={{
                    fontSize: 12, color: 'rgba(255,255,255,0.65)', lineHeight: 1.45,
                  }}>
                    {summary}
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
                    value: parseWind(metar),
                    sub: metar.wgst ? `${metar.wgst} kt gusts` : 'steady',
                  },
                  {
                    label: 'Visibility',
                    value: parseVisib(metar),
                    sub: parseWx(metar) ?? 'unrestricted',
                  },
                  {
                    label: 'Ceiling',
                    value: parseCeiling(metar),
                    sub: cat?.label === 'MVFR' ? 'MVFR limiter'
                       : cat?.label === 'IFR'  ? 'IFR limiter'
                       : cat?.label === 'LIFR' ? 'LIFR limiter'
                       : 'above minimums',
                  },
                  {
                    label: 'Altimeter',
                    value: parseAltim(metar),
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
                    <div style={{
                      fontSize: 12, fontWeight: 700,
                      color: 'rgba(255,255,255,0.56)',
                    }}>
                      Next {tafPeriods.length * 3}+ hr
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

              {/* ── Raw METAR ── */}
              {metar.rawOb && (
                <div style={{ ...GLASS, padding: '16px 18px' }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginBottom: 14,
                  }}>
                    <div style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>
                      Raw METAR
                    </div>
                    <button
                      onClick={() => onCopyMetar(metar.rawOb)}
                      style={{
                        border: 'none', borderRadius: 999, padding: '7px 14px',
                        color: 'white', fontWeight: 700, fontSize: 12,
                        background: copied
                          ? 'rgba(255,255,255,0.25)'
                          : 'rgba(255,255,255,0.14)',
                        cursor: 'pointer', fontFamily: 'inherit',
                      }}
                    >
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <p style={{
                    margin: 0, fontSize: 12,
                    color: 'rgba(255,255,255,0.72)',
                    fontFamily: '"SF Mono", ui-monospace, Menlo, Consolas, monospace',
                    lineHeight: 1.55, wordBreak: 'break-all',
                  }}>
                    {metar.rawOb}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
