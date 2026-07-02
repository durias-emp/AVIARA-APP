import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { get, put } from '../lib/db'
import AirportPickerModal from './AirportPickerModal'
import {
  loadWeather, parseFltCat, parseWind, parseVisib, parseCeiling,
  parseTemp, parseDewp, parseAltim, parseWx, parseObsAge, parseFetchAge, parseAirportName,
} from '../lib/weather'
import WeatherAnimation, { getCondition, textColor } from './WeatherAnimation'
import { IconRefresh } from './Icons'
import WeatherDetailOverlay from './WeatherDetailOverlay'

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

export default function WeatherCard({ compact = false, onOpenChange }) {
  const [icao, setIcao]         = useState('')
  const [pickerOpen, setPicker] = useState(false)
  const [wx, setWx]             = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [copied, setCopied]   = useState(false)

  // Overlay open state
  const cardRef   = useRef(null)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [overlayClosing, setOverlayClosing] = useState(false)
  const [cardRect, setCardRect] = useState(null)

  function handleCardOpen() {
    if (cardRef.current) {
      const r = cardRef.current.getBoundingClientRect()
      setCardRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    }
    setOverlayClosing(false)
    setOverlayOpen(true)
    onOpenChange?.(true)
  }

  function handleOverlayClose() {
    setOverlayClosing(true)
    onOpenChange?.(false)
    setTimeout(() => {
      setOverlayOpen(false)
      setOverlayClosing(false)
    }, 210)
  }

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
      } catch { /* clipboard fallback failed silently */ }
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
      else setPicker(true)
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

  async function confirmAirport(id) {
    await put('settings', { key: 'homeAirport', value: id })
    setIcao(id)
    setPicker(false)
  }

  const { type, isNight } = getCondition(wx?.metar ?? null)
  const fg = textColor(type, isNight)
  const fgMuted = fg === '#ffffff' ? 'rgba(255,255,255,0.65)' : 'rgba(20,40,60,0.55)'
  const cat = wx?.metar ? parseFltCat(wx.metar) : null
  // eslint-disable-next-line react-hooks/purity
  const isStale = wx?.error || (wx?.fetchedAt && Date.now() - wx.fetchedAt > 3600000)

  // ── Compact banner ───────────────────────────────────────────
  if (compact) {
    // No airport yet: show placeholder card
    if (!icao && !pickerOpen) {
      return (
        <div
          onClick={() => setPicker(true)}
          style={{
            borderRadius: 22, background: 'var(--bg-card)', border: '0.5px solid var(--border)',
            height: 72, display: 'flex', alignItems: 'center', padding: '0 20px', gap: 12,
            cursor: 'pointer',
          }}
        >
          <div style={{ fontSize: 22 }}>⛅</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Set Home Airport</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>Tap to add live weather</div>
          </div>
          {pickerOpen && <AirportPickerModal current={icao} onConfirm={confirmAirport} onClose={() => setPicker(false)} />}
        </div>
      )
    }

    const { type: cType } = getCondition(wx?.metar ?? null)
    const showCardRain = cType === 'rain' || cType === 'storm'

    return (
      <>
        {/* Compact clickable card */}
        <div
          ref={cardRef}
          onClick={handleCardOpen}
          style={{
            position: 'relative', overflow: 'hidden', borderRadius: 22,
            boxShadow: '0 18px 38px rgba(0,0,0,0.22)',
            cursor: 'pointer',
            minHeight: 136,
            WebkitTapHighlightColor: 'transparent',
            userSelect: 'none',
          }}
        >
          <WeatherAnimation metar={wx?.metar ?? null} />

          {/* CSS rain layer for rain/storm conditions */}
          {showCardRain && <div className="home-card-rain" />}

          {/* Readability scrim */}
          <div style={{
            position: 'absolute', inset: 0, zIndex: 0,
            background: 'linear-gradient(108deg, rgba(0,0,0,0.52) 0%, rgba(0,0,0,0.28) 55%, rgba(0,0,0,0.04) 100%)',
          }} />

          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              alignItems: 'flex-end', padding: '20px 18px 20px',
            }}>
              {/* Left — temp + airport */}
              <div>
                <div style={{ fontSize: 52, fontWeight: 180, color: fg, letterSpacing: '-2px', lineHeight: 0.9 }}>
                  {wx?.metar ? parseTemp(wx.metar) : loading ? '…' : '—'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
                  <span
                    onClick={e => { e.stopPropagation(); setPicker(true) }}
                    style={{
                      fontSize: 14, fontWeight: 800, color: fg,
                      fontFamily: 'monospace', letterSpacing: '0.06em', cursor: 'pointer',
                    }}
                  >
                    {icao || '—'}
                  </span>
                  {cat && (
                    <span style={{
                      fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', color: 'rgba(255,255,255,0.9)',
                      background: 'rgba(15,24,34,0.34)',
                      border: '1px solid rgba(255,255,255,0.22)',
                      boxShadow: 'inset 0 1px rgba(255,255,255,0.14)',
                      backdropFilter: 'blur(8px)',
                      padding: '4px 9px', borderRadius: 20,
                    }}>{cat.label}</span>
                  )}
                </div>
                {wx?.metar && parseAirportName(wx.metar) && (
                  <div style={{ fontSize: 12, fontWeight: 600, color: fgMuted, marginTop: 6 }}>
                    {parseAirportName(wx.metar)}
                  </div>
                )}
              </div>

              {/* Right — wind/ceiling/vis */}
              <div style={{
                textAlign: 'right', display: 'flex',
                flexDirection: 'column', alignItems: 'flex-end', gap: 4,
              }}>
                <button
                  onClick={e => { e.stopPropagation(); refresh(icao) }}
                  disabled={loading}
                  style={{
                    background: 'none', border: 'none', padding: 4, cursor: 'pointer',
                    color: fgMuted, display: 'flex', alignItems: 'center',
                    animation: loading ? 'spin-ccw 1s linear infinite' : 'none',
                    marginBottom: 4,
                  }}
                >
                  <IconRefresh size={14} />
                </button>
                {wx?.metar ? (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 700, color: fg }}>{parseWind(wx.metar)}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: fgMuted }}>{parseCeiling(wx.metar)}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: fgMuted }}>{parseVisib(wx.metar)} vis</div>
                  </>
                ) : loading ? (
                  <div style={{ fontSize: 12, color: fgMuted }}>Loading…</div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        {/* Full-screen overlay portal */}
        {overlayOpen && createPortal(
          <WeatherDetailOverlay
            wx={wx}
            icao={icao}
            loading={loading}
            error={error}
            isStale={isStale}
            closing={overlayClosing}
            cardRect={cardRect}
            onClose={handleOverlayClose}
            onRefresh={() => refresh(icao)}
            onCopyMetar={copyMetar}
            copied={copied}
            onOpenPicker={() => setPicker(true)}
          />,
          document.body
        )}

        {/* Airport picker modal */}
        {pickerOpen && <AirportPickerModal current={icao} onConfirm={confirmAirport} onClose={() => setPicker(false)} />}
      </>
    )
  }

  // ── Weather hero ─────────────────────────────────────────────
  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      borderRadius: 'var(--r-xl)',
      minHeight: loading || error ? 120 : 340,
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
                onClick={() => setPicker(true)}
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
              background: 'rgba(0,0,0,0.38)',
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
