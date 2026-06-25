import { useState, useEffect, useCallback } from 'react'
import { get, put } from '../lib/db'
import {
  loadWeather, parseFltCat, parseWind, parseVisib, parseCeiling,
  parseTemp, parseDewp, parseAltim, parseWx, parseObsAge, parseFetchAge, parseAirportName,
} from '../lib/weather'
import WeatherAnimation, { getCondition, textColor } from './WeatherAnimation'
import { IconRefresh } from './Icons'
function IconEdit({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

const GRID_ICONS = {
  wind: (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none"><path d="M9.59 4.59A2 2 0 1 1 11 8H2M12.59 19.41A2 2 0 1 0 14 16H2M17.73 7.73A2.5 2.5 0 1 1 19.5 12H2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
  ),
  eye: (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="1.5"/><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5"/></svg>
  ),
  cloud: (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none"><path d="M18 10h-.27A6 6 0 1 0 6 13h12a4 4 0 0 0 0-8v.27" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
  ),
  therm: (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
  ),
}

export default function WeatherCard({ compact = false }) {
  const [icao, setIcao]       = useState('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState('')
  const [wx, setWx]           = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [copied, setCopied]   = useState(false)

  function copyMetar(text) {
    const doFallback = () => {
      try {
        const el = document.createElement('textarea')
        el.value = text
        el.style.cssText = 'position:fixed;opacity:0'
        document.body.appendChild(el)
        el.select()
        document.execCommand('copy')
        document.body.removeChild(el)
        setCopied(true)
        setTimeout(() => setCopied(false), 1800)
      } catch {}
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1800)
      }).catch(doFallback)
    } else {
      doFallback()
    }
  }

  useEffect(() => {
    get('settings', 'homeAirport').then(row => {
      if (row?.value) setIcao(row.value)
      else setEditing(true)
    })
  }, [])

  const refresh = useCallback(async (id) => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const result = await loadWeather(id)
      setWx(result)
      if (result.error) setError('Offline — showing cached data')
    } catch {
      setError('Could not load weather. Tap ↺ to retry.')
    } finally {
      setLoading(false)
    }
  }, [])

  // On icao change: show cache instantly, only fetch if stale (>30 min) or no data
  useEffect(() => {
    if (!icao) return
    get('weather', icao).then(cached => {
      if (cached) {
        setWx(cached)
        const stale = !cached.fetchedAt || Date.now() - cached.fetchedAt > 1800000
        if (stale) refresh(icao)
      } else {
        refresh(icao)
      }
    })
  }, [icao, refresh])

  async function saveAirport() {
    const id = draft.trim().toUpperCase()
    if (id.length < 3) return
    await put('settings', { key: 'homeAirport', value: id })
    setIcao(id)
    setEditing(false)
    setDraft('')
  }

  const { type, isNight } = getCondition(wx?.metar ?? null)
  const fg = textColor(type, isNight)
  const fgMuted = fg === '#ffffff' ? 'rgba(255,255,255,0.65)' : 'rgba(20,40,60,0.55)'
  const cat = wx?.metar ? parseFltCat(wx.metar) : null
  const isStale = wx?.error || (wx?.fetchedAt && Date.now() - wx.fetchedAt > 3600000)

  // ── Airport picker ──────────────────────────────────────────
  if (editing) {
    return (
      <div style={{
        borderRadius: 'var(--r-xl)',
        boxShadow: 'var(--shadow-md)',
        background: 'var(--bg-card)',
        display: 'flex', flexDirection: 'column',
        justifyContent: 'center',
        padding: '28px 20px',
      }}>
        <div>
          <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Set Home Airport</p>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
            Enter an ICAO code to see live weather here.
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              autoFocus maxLength={4}
              placeholder="e.g. KLAX"
              value={draft}
              onChange={e => setDraft(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && saveAirport()}
              style={{
                flex: 1, padding: '11px 14px',
                borderRadius: 10,
                border: '1px solid var(--border-strong)',
                background: 'var(--bg-card-2)',
                color: 'var(--text)',
                fontSize: 17,
                fontFamily: 'monospace',
                letterSpacing: '0.12em',
                outline: 'none',
              }}
            />
            <button
              onClick={saveAirport}
              disabled={draft.trim().length < 3}
              style={{
                padding: '11px 20px', borderRadius: 10, border: 'none',
                background: 'var(--accent)',
                color: '#fff', fontWeight: 700, fontSize: 15,
                cursor: draft.trim().length < 3 ? 'default' : 'pointer',
                opacity: draft.trim().length < 3 ? 0.45 : 1,
              }}
            >Set</button>
          </div>
        </div>
      </div>
    )
  }

  // ── Compact banner ───────────────────────────────────────────
  if (compact) {
    if (editing) {
      return (
        <div style={{
          borderRadius: 16, background: 'var(--bg-card)', border: '0.5px solid var(--border)',
          height: 72, display: 'flex', alignItems: 'center', padding: '0 16px', gap: 10,
        }}>
          <input
            autoFocus maxLength={4} placeholder="ICAO (e.g. KMIA)"
            value={draft} onChange={e => setDraft(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && saveAirport()}
            style={{
              flex: 1, padding: '8px 12px', borderRadius: 8,
              border: '1px solid var(--border-strong)', background: 'var(--bg-card-2)',
              color: 'var(--text)', fontSize: 15, fontFamily: 'monospace',
              letterSpacing: '0.1em', outline: 'none',
            }}
          />
          <button onClick={saveAirport} disabled={draft.trim().length < 3} style={{
            padding: '8px 16px', borderRadius: 8, border: 'none',
            background: 'var(--accent)', color: '#fff', fontWeight: 700, fontSize: 14,
            cursor: draft.trim().length < 3 ? 'default' : 'pointer',
            opacity: draft.trim().length < 3 ? 0.4 : 1,
          }}>Set</button>
        </div>
      )
    }
    return (
      <div style={{
        position: 'relative', overflow: 'hidden', borderRadius: 20,
        boxShadow: 'var(--shadow-sm)',
      }}>
        <WeatherAnimation metar={wx?.metar ?? null} />
        {/* Readability overlay — dark on left where text lives */}
        <div style={{
          position: 'absolute', inset: 0, zIndex: 0,
          background: 'linear-gradient(105deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.3) 55%, rgba(0,0,0,0.05) 100%)',
        }} />
        <div style={{ position: 'relative', zIndex: 1 }}>

          {/* Card body */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', padding: '16px 18px 18px' }}>

            {/* Left — temp on top, then airport */}
            <div>
              <div style={{ fontSize: 52, fontWeight: 700, color: fg, letterSpacing: '-2px', lineHeight: 1 }}>
                {wx?.metar ? parseTemp(wx.metar) : loading ? '…' : '—'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <span
                  onClick={() => { setEditing(true); setDraft(icao) }}
                  style={{ fontSize: 14, fontWeight: 700, color: fg, fontFamily: 'monospace', letterSpacing: '0.06em', cursor: 'pointer' }}>
                  {icao || '—'}
                </span>
                {cat && (
                  <span style={{
                    fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color: '#fff',
                    background: cat.color, padding: '3px 9px', borderRadius: 20,
                    boxShadow: `0 2px 6px ${cat.color}55`,
                  }}>{cat.label}</span>
                )}
              </div>
              {wx?.metar && parseAirportName(wx.metar) && (
                <div style={{ fontSize: 11, color: fgMuted, marginTop: 3 }}>
                  {parseAirportName(wx.metar)}
                </div>
              )}
            </div>

            {/* Right — stats + refresh */}
            <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
              <button onClick={() => refresh(icao)} disabled={loading} style={{
                background: 'none', border: 'none', padding: 4, cursor: 'pointer',
                color: fgMuted, display: 'flex', alignItems: 'center',
                animation: loading ? 'spin-ccw 1s linear infinite' : 'none', marginBottom: 6,
              }}>
                <IconRefresh size={14} />
              </button>
              {wx?.metar ? (
                <>
                  <div style={{ fontSize: 13, fontWeight: 600, color: fg }}>{parseWind(wx.metar)}</div>
                  <div style={{ fontSize: 11, color: fgMuted }}>{parseCeiling(wx.metar)}</div>
                  <div style={{ fontSize: 11, color: fgMuted }}>{parseVisib(wx.metar)} vis</div>
                </>
              ) : loading ? (
                <div style={{ fontSize: 12, color: fgMuted }}>Loading…</div>
              ) : null}
            </div>

          </div>

        </div>
      </div>
    )
  }

  // ── Weather hero ─────────────────────────────────────────────
  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      borderRadius: 'var(--r-xl)',
      minHeight: loading || error ? 120 : 340,
      transition: 'min-height 0.4s ease',
      boxShadow: 'var(--shadow-md)',
    }}>
      <WeatherAnimation metar={wx?.metar ?? null} />

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', minHeight: 'inherit' }}>

        {/* Top row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '18px 20px 0' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                onClick={() => { setEditing(true); setDraft(icao) }}
                style={{ fontSize: 24, fontWeight: 800, letterSpacing: '0.06em', color: fg, fontFamily: 'monospace', cursor: 'pointer' }}>
                {icao}
              </span>
              <button onClick={() => refresh(icao)} disabled={loading}
                style={{
                  background: 'none', border: 'none', padding: 2,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: loading ? 'default' : 'pointer', color: fgMuted,
                  animation: loading ? 'spin-ccw 1s linear infinite' : 'none',
                }}>
                <IconRefresh size={15} />
              </button>
            </div>
            {wx?.metar && parseAirportName(wx.metar) && (
              <div style={{ fontSize: 12, color: fgMuted, marginTop: 1, letterSpacing: '-0.1px' }}>
                {parseAirportName(wx.metar)}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {cat && (
              <span style={{
                fontSize: 12, fontWeight: 800, letterSpacing: '0.08em',
                color: '#fff',
                background: cat.color,
                padding: '5px 12px', borderRadius: 20,
                boxShadow: `0 2px 8px ${cat.color}66`,
              }}>{cat.label}</span>
            )}
          </div>
        </div>

        {/* Loading / error states */}
        {(loading || error) && !wx?.metar && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', color: 'rgba(255,255,255,0.8)', fontSize: 14 }}>
            {loading ? 'Fetching weather…' : error}
          </div>
        )}

        {/* Temperature hero */}
        {wx?.metar && (
          <>
            <div style={{ padding: '4px 20px 0' }}>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <span style={{
                  fontSize: 72, fontWeight: 100, letterSpacing: '-4px',
                  color: fg, lineHeight: 1,
                  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
                }}>
                  {parseTemp(wx.metar).replace('°C', '')}
                </span>
                <div style={{ paddingBottom: 10, marginLeft: 4 }}>
                  <span style={{ fontSize: 28, fontWeight: 300, color: fg }}>°C</span>
                  {parseWx(wx.metar) && (
                    <div style={{ fontSize: 11, color: fgMuted, marginTop: 2 }}>{parseWx(wx.metar)}</div>
                  )}
                </div>
              </div>
              <div style={{ marginTop: 4 }}>
                <span style={{ fontSize: 12, color: fgMuted }}>Dewpoint </span>
                <span style={{ fontSize: 14, fontWeight: 500, color: fg }}>{parseDewp(wx.metar)}</span>
              </div>
            </div>

            {/* Bottom panel — data row + footer + METAR unified */}
            <div style={{
              background: 'rgba(0,0,0,0.22)',
              backdropFilter: 'blur(12px)',
              marginTop: 'auto',
              padding: '12px 16px 14px',
            }}>
              {/* Data row */}
              <div style={{ display: 'flex', marginBottom: 12, gap: 4 }}>
                {[
                  { icon: GRID_ICONS.wind,  label: 'WIND',    value: parseWind(wx.metar) },
                  { icon: GRID_ICONS.eye,   label: 'VIS',     value: parseVisib(wx.metar) },
                  { icon: GRID_ICONS.cloud, label: 'CEILING', value: parseCeiling(wx.metar) },
                  { icon: GRID_ICONS.therm, label: 'ALT',     value: parseAltim(wx.metar) },
                ].map(({ icon, label, value }) => (
                  <div key={label} style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2, color: fgMuted }}>
                      {icon}
                      <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.06em' }}>{label}</span>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: fg, letterSpacing: '-0.2px', fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {value}
                    </div>
                  </div>
                ))}
              </div>

              {/* Timestamps */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: wx.metar.rawOb ? 8 : 0 }}>
                <span style={{ fontSize: 11, color: fgMuted }}>Observed {parseObsAge(wx.metar)}</span>
                {isStale
                  ? <span style={{ fontSize: 11, color: '#FFD60A', fontWeight: 500 }}>Cached · {parseFetchAge(wx.fetchedAt)}</span>
                  : <span style={{ fontSize: 11, color: fgMuted }}>Updated {parseFetchAge(wx.fetchedAt)}</span>
                }
              </div>

              {/* Raw METAR */}
              {wx.metar.rawOb && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <p style={{ flex: 1, fontSize: 10, color: fgMuted, fontFamily: 'monospace', lineHeight: 1.6, wordBreak: 'break-all', margin: 0 }}>
                    {wx.metar.rawOb}
                  </p>
                  <button
                    onClick={() => copyMetar(wx.metar.rawOb)}
                    title="Copy METAR"
                    style={{
                      flexShrink: 0, marginTop: 1,
                      background: copied ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.15)',
                      border: '1px solid rgba(255,255,255,0.2)',
                      borderRadius: 6, padding: '4px 6px',
                      cursor: 'pointer', color: copied ? 'rgba(255,255,255,0.9)' : fgMuted,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'background 0.2s, color 0.2s',
                      minWidth: 28,
                    }}>
                    {copied ? (
                      <svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                        <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    ) : (
                      <svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                        <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="1.5"/>
                      </svg>
                    )}
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
