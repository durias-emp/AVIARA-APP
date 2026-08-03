import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { get, put } from '../lib/db'
import AirportPickerModal from './AirportPickerModal'
import {
  loadWeather, parseFltCat, parseWind, parseVisib, parseCeiling,
  parseTemp, parseDewp, parseAltim, parseWx, parseObsAge, parseFetchAge, parseAirportName,
} from '../lib/weather'
import WeatherAnimation, { getCondition, textColor } from './WeatherAnimation'
import LottieWeather, { USE_LOTTIE_WEATHER } from './LottieWeather'
import { IconRefresh } from './Icons'
import WeatherDetailOverlay from './WeatherDetailOverlay'
import { usePilotProfile } from '../context/PilotProfile'

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

// One right-aligned metric row (wind / ceiling / visibility) with a tiny icon.
// The icon is tinted to match the card's foreground text so it always contrasts
// with whatever weather background is behind it (white on dark skies, dark on
// light snow/fog days).
function WxMetric({ icon, value, fg, color, weight, size }) {
  const filter = fg === '#ffffff' ? 'brightness(0) invert(1)' : 'brightness(0)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5 }}>
      <span style={{ fontSize: size, fontWeight: weight, color }}>{value}</span>
      <img src={icon} alt="" width={size} height={size} style={{ filter, opacity: 0.9, flexShrink: 0 }} />
    </div>
  )
}

export default function WeatherCard({ compact = false, onOpenChange }) {
  const { profile } = usePilotProfile()
  const units = profile ?? {}
  const [icao, setIcao]         = useState('')
  const [pickerOpen, setPicker] = useState(false)
  const [wx, setWx]             = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  // Tracks the exact string last copied (not just a boolean) so the METAR and
  // TAF copy buttons, which can both be on screen at once. Each show their
  // own "copied" state instead of lighting up together.
  const [copiedText, setCopiedText] = useState(null)

  // Overlay open state
  const cardRef   = useRef(null)
  const [overlayOpen, setOverlayOpen] = useState(false)

  function handleCardOpen() {
    setOverlayOpen(true)
    onOpenChange?.(true)
  }

  function handleOverlayClose() {
    setOverlayOpen(false)
    onOpenChange?.(false)
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
        setCopiedText(text)
        setTimeout(() => setCopiedText(null), 1800)
      } catch { /* clipboard fallback failed silently */ }
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setCopiedText(text)
        setTimeout(() => setCopiedText(null), 1800)
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

  // Always shows the spin immediately, even if `id` isn't ready yet (e.g. a
  // tap right after mount, before the homeAirport lookup resolves). Falls
  // back to re-reading the saved airport rather than silently no-op'ing.
  const refresh = useCallback(async (id) => {
    setLoading(true)
    setError(null)
    try {
      let targetId = id
      if (!targetId) {
        const row = await get('settings', 'homeAirport')
        targetId = row?.value
      }
      if (!targetId) {
        setError('No home airport set.')
        return
      }
      const result = await loadWeather(targetId)
      setWx(result)
      if (result.error) setError('Offline, showing cached data')
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

  // Keep weather from ever going stale for hours: re-fetch on a timer while the
  // app is open, and immediately on return to foreground if the last fetch is
  // older than the interval (covers the phone being locked/backgrounded).
  useEffect(() => {
    if (!icao) return
    const REFRESH_MS = 30 * 60 * 1000 // 30 min. METARs update hourly, this stays ahead of it

    const id = setInterval(() => refresh(icao), REFRESH_MS)

    function onVisible() {
      if (document.visibilityState !== 'visible') return
      get('weather', icao).then(cached => {
        const stale = !cached?.fetchedAt || Date.now() - cached.fetchedAt > REFRESH_MS
        if (stale) refresh(icao)
      })
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
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
          {USE_LOTTIE_WEATHER
            ? <LottieWeather metar={wx?.metar ?? null} />
            : <WeatherAnimation metar={wx?.metar ?? null} />}

          {/* CSS rain layer for rain/storm conditions */}
          {showCardRain && <div className="home-card-rain" />}

          {/* Readability scrim */}
          <div style={{
            position: 'absolute', inset: 0, zIndex: 0,
            background: 'linear-gradient(108deg, rgba(0,0,0,0.52) 0%, rgba(0,0,0,0.28) 55%, rgba(0,0,0,0.04) 100%)',
          }} />

          <div style={{ position: 'relative', zIndex: 1 }}>
            {/* VFR pill: top-right of the card */}
            {cat && (
              <span style={{
                position: 'absolute', top: 16, right: 18, zIndex: 2,
                fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', color: '#fff',
                background: cat.color,
                boxShadow: `0 2px 8px ${cat.color}66`,
                padding: '4px 9px', borderRadius: 20,
              }}>{cat.label}</span>
            )}
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              alignItems: 'flex-end', padding: '20px 18px 20px',
            }}>
              {/* Left: temp + airport */}
              <div>
                <div style={{ fontSize: 52, fontWeight: 800, color: fg, letterSpacing: '-2px', lineHeight: 0.9 }}>
                  {wx?.metar ? parseTemp(wx.metar, units) : loading ? '…' : '—'}
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
                </div>
                {wx?.metar && parseAirportName(wx.metar) && (
                  <div style={{ fontSize: 12, fontWeight: 600, color: fgMuted, marginTop: 6 }}>
                    {parseAirportName(wx.metar)}
                  </div>
                )}
              </div>

              {/* Right: wind/ceiling/vis */}
              <div style={{
                textAlign: 'right', display: 'flex',
                flexDirection: 'column', alignItems: 'flex-end', gap: 4,
              }}>
                {wx?.metar ? (
                  <>
                    <WxMetric icon="/wind.png"       value={parseWind(wx.metar, units)}        fg={fg} color={fg} weight={700} size={13} />
                    <WxMetric icon="/cloud.png"      value={parseCeiling(wx.metar, units)}     fg={fg} color={fgMuted} weight={600} size={12} />
                    <WxMetric icon="/visibility.png" value={`${parseVisib(wx.metar, units)} vis`} fg={fg} color={fgMuted} weight={600} size={12} />
                    <WxMetric icon="/droplet.png"    value={`${parseDewp(wx.metar, units)} dp`} fg={fg} color={fgMuted} weight={600} size={12} />
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
            onClose={handleOverlayClose}
            onRefresh={() => refresh(icao)}
            onCopyMetar={copyMetar}
            copiedText={copiedText}
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
                <IconRefresh size={15} onDark={fg === '#ffffff'} />
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
                  {parseTemp(wx.metar, units).replace(units.unitTemperature ?? '°C', '')}
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
                <span style={{ fontSize: 14, fontWeight: 500, color: fg }}>{parseDewp(wx.metar, units)}</span>
              </div>
            </div>

            {/* Bottom panel: data row + footer + METAR unified */}
            <div style={{
              background: 'rgba(0,0,0,0.38)',
              marginTop: 'auto',
              padding: '12px 16px 14px',
            }}>
              {/* Data row */}
              <div style={{ display: 'flex', marginBottom: 12, gap: 4 }}>
                {[
                  { icon: GRID_ICONS.wind,  label: 'WIND',    value: parseWind(wx.metar, units) },
                  { icon: GRID_ICONS.eye,   label: 'VIS',     value: parseVisib(wx.metar, units) },
                  { icon: GRID_ICONS.cloud, label: 'CEILING', value: parseCeiling(wx.metar, units) },
                  { icon: GRID_ICONS.therm, label: 'ALT',     value: parseAltim(wx.metar, units) },
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
                  {(() => {
                    const metarCopied = copiedText === wx.metar.rawOb
                    return (
                      <button
                        onClick={() => copyMetar(wx.metar.rawOb)}
                        title="Copy METAR"
                        style={{
                          flexShrink: 0, marginTop: 1,
                          background: metarCopied ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.15)',
                          border: '1px solid rgba(255,255,255,0.2)',
                          borderRadius: 6, padding: '4px 6px',
                          cursor: 'pointer', color: metarCopied ? 'rgba(255,255,255,0.9)' : fgMuted,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          transition: 'background 0.2s, color 0.2s',
                          minWidth: 28,
                        }}>
                        {metarCopied ? (
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
                    )
                  })()}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
