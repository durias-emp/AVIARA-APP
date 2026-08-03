// The home screen as a map you fly from, not a menu you read.
//
// Modelled on Strava's record screen, translated rather than copied: the shape
// is theirs (map to the edges, floating controls right, a live stat card, one
// unmissable action) but every control underneath it is this app's. Ride
// becomes the active aircraft, the layers button opens FAA charts instead of
// heatmaps, and speed is in knots over ground because that is the number a
// pilot reads.
//
// What is deliberately NOT borrowed: anything that ranks pilots by speed or
// altitude. Competing on those is a flight-safety problem, not engagement.

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapContainer, Polyline, CircleMarker, useMap } from 'react-leaflet'
import ChartLayers, { Basemap } from '../../components/ChartLayers'
import { CHARTS, EMPTY_LAYERS } from '../../components/chartDefs'
import { createRecorder, toFlightRecord, fmtClock } from '../../lib/flightRecorder'
import { put, get } from '../../lib/db'

const ACCENT = '#FF5A1F'      // the one saturated colour on the screen, so the
                              // action is never ambiguous
const CTRL = 52

// A round glass control. Every floating button on this screen is one of these,
// which is what makes the stack read as a set rather than as scattered chrome.
function Ctrl({ onClick, title, active, badge, children, size = CTRL }) {
  return (
    <button onClick={onClick} title={title} style={{
      position: 'relative', width: size, height: size, borderRadius: '50%',
      border: 'none', cursor: 'pointer', flexShrink: 0,
      background: active ? '#1c1c1e' : 'rgba(255,255,255,0.96)',
      color: active ? '#fff' : '#1c1c1e',
      boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'background 160ms, color 160ms',
    }}>
      {children}
      {badge > 0 && (
        <span style={{
          position: 'absolute', top: -2, right: -2, minWidth: 20, height: 20,
          borderRadius: 10, background: '#1c1c1e', color: '#fff',
          fontSize: 11, fontWeight: 700, display: 'flex',
          alignItems: 'center', justifyContent: 'center', padding: '0 5px',
          border: '2px solid #fff',
        }}>{badge}</span>
      )}
    </button>
  )
}

const IconLayers = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round">
    <path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" strokeLinecap="round" />
  </svg>
)
const IconLocate = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
    <circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
    <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" strokeLinecap="round" />
  </svg>
)
const IconChevron = ({ up }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
    style={{ transform: up ? 'rotate(180deg)' : 'none', transition: 'transform 200ms' }}>
    <path d="M6 9l6 6 6-6" />
  </svg>
)
const IconRoute = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="5.5" r="2.5" />
    <path d="M8 18.5h6a3.5 3.5 0 0 0 0-7H10a3.5 3.5 0 0 1 0-7h6" />
  </svg>
)

// Keeps Leaflet's idea of its own size honest. It measures once and re-measures
// only on a window resize, so a container that settles late (safe-area insets
// resolving, the sheet animating) leaves tiles painted for a box the map no
// longer occupies. Watching the element is the fix that stuck.
// Takes a ref OBJECT, never a callback. An inline arrow prop is a new value on
// every render, so the effect re-ran constantly and fired invalidateSize into
// the middle of Leaflet's zoom animation: the tile container was left with a
// stale scale(2) and its tiles positioned thousands of pixels off screen,
// which looked like the map rendering in one corner.
//
// invalidateSize also has to be told not to animate. The default is a
// pan-animated resize, and animating a resize that happens while the map is
// still settling is what produces the stuck transform in the first place.
function SizeWatcher({ mapRef }) {
  const map = useMap()
  useEffect(() => {
    mapRef.current = map
    const el = map.getContainer()
    const kick = () => map.invalidateSize({ animate: false, pan: false })
    // Once after layout settles, then only when the element actually changes
    // size. Not on a timer, and not on every render.
    const raf = requestAnimationFrame(kick)
    const ro = new ResizeObserver(kick)
    ro.observe(el)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [map, mapRef])
  return null
}

export default function MapHome() {
  const navigate = useNavigate()
  // The active aircraft lives in the 'aircraft' store under 'profile', which is
  // where the rest of the app reads it from. Not on the pilot profile.
  const [ac, setAc] = useState(null)

  const [layers, setLayers] = useState(EMPTY_LAYERS)
  const [sheetOpen, setSheetOpen] = useState(true)
  const [chartsOpen, setChartsOpen] = useState(false)
  const [rec, setRec] = useState(null)
  const [pos, setPos] = useState(null)
  const [openaipKey, setOpenaipKey] = useState(null)
  const mapRef = useRef(null)
  // Created once, via lazy initial state rather than a ref written during
  // render: a recording must outlive re-renders, and reading or writing a ref
  // while rendering is exactly what breaks under the compiler.
  const [recorder] = useState(() => createRecorder({ onUpdate: setRec }))

  const activeCount = Object.values(layers).filter(Boolean).length

  useEffect(() => {
    get('settings', 'openaip').then(r => setOpenaipKey(r?.key ?? null)).catch(() => {})
    get('aircraft', 'profile').then(p => setAc(p ?? null)).catch(() => {})
  }, [])

  // Where the pilot is, whether or not anything is being recorded: an aviation
  // map that opens somewhere else is useless, and the blue dot is the one thing
  // every map app is judged on.
  useEffect(() => {
    if (!navigator.geolocation) return
    const id = navigator.geolocation.watchPosition(
      p => setPos({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])

  // The clock has to move between GPS fixes, which can be seconds apart.
  const running = rec != null && !rec.paused
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setRec(recorder.snapshot()), 1000)
    return () => clearInterval(t)
  }, [running, recorder])

  // MapContainer reads this once, at mount. Everything after is setView, so
  // this only decides where the map opens before the first fix arrives.
  const INITIAL_CENTER = [37.6188, -122.3750]        // KSFO

  // Move to the pilot once, on the first fix. Following every fix afterwards
  // would fight the pilot panning the chart, which is the ForeFlight rule the
  // planner already follows: the camera belongs to them.
  const [centred, setCentred] = useState(false)
  useEffect(() => {
    if (!pos || centred || !mapRef.current) return
    setCentred(true)
    mapRef.current.setView([pos.lat, pos.lon], 11, { animate: false })
  }, [pos, centred])

  const toggleLayer = (k) => setLayers(prev => ({ ...prev, [k]: !prev[k] }))

  function locate() {
    if (pos && mapRef.current) mapRef.current.setView([pos.lat, pos.lon], 12, { animate: true })
  }

  function startFlight() {
    setRec(recorder.start({ aircraft: ac?.fullName ?? null }))
  }

  async function stopFlight() {
    const finished = recorder.stop()
    setRec(null)
    if (!finished) return
    // A taxi is not a flight. Under two minutes or a quarter mile, this was the
    // pilot testing the button, and a logbook full of those is worse than one
    // missing entry.
    if (finished.elapsedMs < 120_000 || finished.distNm < 0.25) return
    const record = toFlightRecord(finished, {
      aircraft: ac?.fullName ?? null,
      registration: ac?.registration ?? null,
    })
    await put('flights', record).catch(() => {})
  }

  const recording = rec != null
  const track = rec?.track?.map(p => [p.lat, p.lon]) ?? []

  const statFont = { fontSize: 11, fontWeight: 600, color: 'rgba(60,60,67,0.6)', letterSpacing: '0.2px' }

  return (
    // Fixed to the viewport rather than flowing in the shell: the map is the
    // screen here, and it has to reach every edge including under the status
    // bar and the home indicator. body is the containing block, which is what
    // makes this land on the real screen bottom.
    <div style={{ position: 'fixed', inset: 0, background: '#e8e0d8', overflow: 'hidden' }}>
      <MapContainer center={INITIAL_CENTER} zoom={10} zoomControl={false} attributionControl={false}
        style={{ height: '100%', width: '100%' }}>
        <SizeWatcher mapRef={mapRef} />
        <Basemap />
        <ChartLayers layers={layers} openaipKey={openaipKey} />
        {track.length > 1 && (
          <Polyline positions={track} pathOptions={{ color: ACCENT, weight: 5, opacity: 0.9, lineCap: 'round' }} />
        )}
        {pos && (
          <CircleMarker center={[pos.lat, pos.lon]} radius={8}
            pathOptions={{ color: '#fff', weight: 3, fillColor: '#1d7fff', fillOpacity: 1 }} />
        )}
      </MapContainer>

      {/* Top left: hide the furniture and read the chart. The map is the point;
          everything else should be able to get out of its way. */}
      <div style={{ position: 'absolute', top: 'calc(var(--safe-top) + 10px)', left: 14, zIndex: 500 }}>
        <Ctrl onClick={() => setSheetOpen(o => !o)} title={sheetOpen ? 'Hide panel' : 'Show panel'} size={46}>
          <IconChevron up={!sheetOpen} />
        </Ctrl>
      </div>

      {/* Right stack: charts, then position. Ordered by how often a hand
          reaches for them in the air. */}
      <div style={{
        position: 'absolute', right: 14, zIndex: 500,
        bottom: sheetOpen ? 'calc(var(--safe-bottom) + 250px)' : 'calc(var(--safe-bottom) + 28px)',
        display: 'flex', flexDirection: 'column', gap: 12,
        transition: 'bottom 260ms cubic-bezier(0.4,0,0.2,1)',
      }}>
        <Ctrl onClick={() => setChartsOpen(o => !o)} title="Chart layers"
          active={chartsOpen} badge={activeCount}><IconLayers /></Ctrl>
        <Ctrl onClick={locate} title="Center on my position"><IconLocate /></Ctrl>
      </div>

      {/* Chart chips, revealed by the layers button rather than always on
          screen: six permanent chips is what a cluttered EFB looks like. */}
      {chartsOpen && (
        <div style={{
          position: 'absolute', right: 14 + CTRL + 12, zIndex: 500,
          bottom: sheetOpen ? 'calc(var(--safe-bottom) + 250px)' : 'calc(var(--safe-bottom) + 28px)',
          display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end',
        }}>
          {CHARTS.map(c => (
            <button key={c.key} onClick={() => toggleLayer(c.key)} style={{
              background: layers[c.key] ? '#1c1c1e' : 'rgba(255,255,255,0.96)',
              color: layers[c.key] ? '#fff' : '#1c1c1e',
              border: 'none', borderRadius: 9, padding: '9px 13px',
              fontSize: 11.5, fontWeight: 700, letterSpacing: '0.4px',
              boxShadow: '0 2px 10px rgba(0,0,0,0.18)', cursor: 'pointer',
            }}>{c.label}</button>
          ))}
        </div>
      )}

      {/* The panel: what is happening, then what to do about it. */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 600,
        transform: sheetOpen ? 'translateY(0)' : 'translateY(calc(100% - 0px))',
        transition: 'transform 300ms cubic-bezier(0.4,0,0.2,1)',
        pointerEvents: sheetOpen ? 'auto' : 'none',
      }}>
        {/* Live numbers. Zeros before departure, which is honest: the card is
            the same object before and during, so nothing appears or moves when
            the flight starts. */}
        <div style={{
          margin: '0 12px 10px', background: 'rgba(255,255,255,0.97)',
          backdropFilter: 'blur(20px)', borderRadius: 18, padding: '16px 18px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
        }}>
          <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, color: '#1c1c1e', marginBottom: 12 }}>
            {recording ? (rec.paused ? 'Paused' : 'Recording') : 'Flight'}
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ flex: 1, textAlign: 'left' }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: '#1c1c1e', letterSpacing: '-0.6px', fontVariantNumeric: 'tabular-nums' }}>
                {fmtClock(rec?.elapsedMs ?? 0)}
              </div>
              <div style={statFont}>Time</div>
            </div>
            <div style={{ flex: 1.2, textAlign: 'center' }}>
              <div style={{ fontSize: 42, fontWeight: 800, color: '#1c1c1e', letterSpacing: '-1.4px', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                {rec?.gsKt != null ? Math.round(rec.gsKt) : '0'}
              </div>
              <div style={statFont}>Ground speed (kt)</div>
            </div>
            <div style={{ flex: 1, textAlign: 'right' }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: '#1c1c1e', letterSpacing: '-0.6px', fontVariantNumeric: 'tabular-nums' }}>
                {(rec?.distNm ?? 0).toFixed(1)}
              </div>
              <div style={statFont}>Distance (NM)</div>
            </div>
          </div>
          {rec?.error && (
            <div style={{ marginTop: 10, fontSize: 11.5, color: '#FF3B30', textAlign: 'center', lineHeight: 1.4 }}>
              {rec.error}
            </div>
          )}
        </div>

        {/* Actions. One is bigger and coloured because one is the point of the
            screen; the other two are where you were going anyway. */}
        <div style={{
          background: 'rgba(255,255,255,0.98)', backdropFilter: 'blur(20px)',
          borderRadius: '22px 22px 0 0', boxShadow: '0 -4px 24px rgba(0,0,0,0.10)',
          padding: '10px 18px calc(var(--safe-bottom) + 14px)',
        }}>
          <div style={{ width: 40, height: 5, borderRadius: 3, background: 'rgba(60,60,67,0.2)', margin: '0 auto 14px' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', gap: 10 }}>

            <button onClick={() => navigate('/aircraft')} style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, width: 92,
            }}>
              <span style={{
                width: 58, height: 58, borderRadius: '50%', background: 'rgba(255,90,31,0.14)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {ac?.image
                  ? <img src={ac.image} width={40} height={40} alt=""
                      style={{ objectFit: 'contain' }} />
                  : <img src="/modo-avion.png" width={26} height={26} alt=""
                      style={{ objectFit: 'contain', transform: 'rotate(45deg)' }} />}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#1c1c1e', maxWidth: 92, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ac?.registration || ac?.fullName || 'Aircraft'}
              </span>
            </button>

            <button onClick={recording ? stopFlight : startFlight} style={{
              width: 86, height: 86, borderRadius: '50%', border: 'none', cursor: 'pointer',
              background: recording ? '#1c1c1e' : ACCENT,
              boxShadow: `0 6px 20px ${recording ? 'rgba(28,28,30,0.3)' : 'rgba(255,90,31,0.38)'}`,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 3, transition: 'background 200ms',
            }}>
              {recording ? (
                <svg width="26" height="26" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
              ) : (
                <svg width="30" height="30" viewBox="0 0 24 24" fill="#fff"><path d="M8 5.5v13l11-6.5z" /></svg>
              )}
            </button>

            <button onClick={() => navigate('/checklists')} style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, width: 92,
            }}>
              <span style={{
                width: 58, height: 58, borderRadius: '50%', background: 'rgba(60,60,67,0.09)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1c1c1e',
              }}>
                <IconRoute />
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#1c1c1e' }}>Plan Route</span>
            </button>
          </div>
          <div style={{ textAlign: 'center', marginTop: 10, fontSize: 10, color: 'rgba(60,60,67,0.45)' }}>
            {recording ? 'Recording your track · tap the square to end and log it'
              : 'Reference aid only · Always consult current FAR/AIM'}
          </div>
        </div>
      </div>
    </div>
  )
}
