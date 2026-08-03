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

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapContainer, Polyline, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import ChartLayers, { Basemap } from '../../components/ChartLayers'
import { CHARTS, EMPTY_LAYERS } from '../../components/chartDefs'
import ActivityCard from '../../components/ActivityCard'
import WeatherRibbon from '../../components/WeatherRibbon'
import { createRecorder, toFlightRecord, fmtClock } from '../../lib/flightRecorder'
import { put, get, getAll } from '../../lib/db'
import { getAirports } from '../../lib/aerodromes'

const ACCENT = '#FF5A1F'      // the one saturated colour on the screen, so the
                              // action is never ambiguous
const CTRL = 52

// Three resting heights. Collapsed is the handle and the actions; expanded
// leaves a strip of map above it so it never reads as a takeover; full is a
// screen in its own right, for reading the logbook rather than glancing at it.
//
// FULL_TRIGGER is where dragging stops being "open the sheet" and becomes
// "open the screen": past three quarters of the way up, the sheet commits to
// full and its corners square off against the device's own.
const SHEET_COLLAPSED_PX = 178
const SHEET_EXPANDED_VH = 0.82
const SHEET_FULL_TRIGGER = 0.75
const SHEET_RADIUS = 22
// How far a finger must travel before the sheet treats it as a drag rather
// than a tap. Below this the buttons in the header keep their taps.
const DRAG_SLOP = 6

// Everything else the app does. The map home would otherwise be a dead end:
// these are the screens the old menu-style home listed, and they keep their
// icons so nothing has to be relearned.
const TOOLS = [
  { to: '/checklists', icon: '/clipboard.png',  label: 'Flight Planning' },
  { to: '/calc',       icon: '/E6B CALC.svg',   label: 'Calculators' },
  { to: '/weather',    icon: '/cloud.png',       label: 'Weather' },
  { to: '/currency',   icon: '/cheque.png',     label: 'Currency' },
  { to: '/reference',  icon: '/libros.png',     label: 'Quick Reference' },
  { to: '/aircraft',   icon: '/modo-avion.png', label: 'Aircraft' },
]

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
// An arrow with a shaft, not a bare chevron. A chevron is a hint that
// something continues; this button moves the panel, and an arrow says which
// way it is going.
const IconArrow = ({ up }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
    style={{ transform: up ? 'rotate(180deg)' : 'none', transition: 'transform 220ms cubic-bezier(0.4,0,0.2,1)' }}>
    <path d="M12 4v15" />
    <path d="M6 13.5l6 6 6-6" />
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
function SizeWatcher({ mapRef, onReady }) {
  const map = useMap()
  useEffect(() => {
    mapRef.current = map
    onReady?.()
    const el = map.getContainer()
    const kick = () => map.invalidateSize({ animate: false, pan: false })
    // Once after layout settles, then only when the element actually changes
    // size. Not on a timer, and not on every render.
    const raf = requestAnimationFrame(kick)
    const ro = new ResizeObserver(kick)
    ro.observe(el)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [map, mapRef, onReady])
  return null
}

export default function MapHome() {
  const navigate = useNavigate()
  // The active aircraft lives in the 'aircraft' store under 'profile', which is
  // where the rest of the app reads it from. Not on the pilot profile.
  const [ac, setAc] = useState(null)

  const [layers, setLayers] = useState(EMPTY_LAYERS)
  const [sheetOpen, setSheetOpen] = useState(true)
  // The sheet has two resting heights: the actions alone, and everything the
  // app can do. Dragging between them is how the rest of the app is reached
  // now that the home screen is a map, so it has to feel like a sheet rather
  // than a button that swaps screens.
  const [snap, setSnap] = useState('collapsed')   // collapsed | expanded | full
  // The viewport, measured rather than assumed: reading window.innerHeight
  // during render is fine once, but it has to be re-read when the phone is
  // rotated or the browser chrome changes, or every snap point is stale.
  const [viewportH, setViewportH] = useState(() => window.innerHeight)
  const [dragY, setDragY] = useState(null)      // live offset while a finger is down
  const drag = useRef(null)
  const [chartsOpen, setChartsOpen] = useState(false)
  const [rec, setRec] = useState(null)
  const [pos, setPos] = useState(null)
  const [openaipKey, setOpenaipKey] = useState(null)
  const [flights, setFlights] = useState([])
  // The pilot's base, and whether we are still looking for it. The map must
  // not settle anywhere until this resolves one way or the other, or a GPS fix
  // that lands first would frame the map somewhere else and the base would
  // never get its turn.
  const [base, setBase] = useState(null)
  const [baseResolved, setBaseResolved] = useState(false)
  // Units come from the pilot profile, so the ribbon reads in the same units
  // as the rest of the app rather than inventing its own.
  const [units, setUnits] = useState({})
  // Flipped once Leaflet exists, purely so the framing effect below re-runs
  // when it does.
  const [mapReady, setMapReady] = useState(false)
  const onMapReady = useCallback(() => setMapReady(true), [])
  const mapRef = useRef(null)
  // Created once, via lazy initial state rather than a ref written during
  // render: a recording must outlive re-renders, and reading or writing a ref
  // while rendering is exactly what breaks under the compiler.
  const [recorder] = useState(() => createRecorder({ onUpdate: setRec }))

  const activeCount = Object.values(layers).filter(Boolean).length
  const expanded = snap !== 'collapsed'

  useEffect(() => {
    const onResize = () => setViewportH(window.innerHeight)
    window.addEventListener('resize', onResize)
    window.visualViewport?.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.visualViewport?.removeEventListener('resize', onResize)
    }
  }, [])

  useEffect(() => {
    get('settings', 'openaip').then(r => setOpenaipKey(r?.key ?? null)).catch(() => {})
    get('aircraft', 'profile').then(p => setAc(p ?? null)).catch(() => {})
    loadFlights()
    resolveBase()
  }, [])

  // The home airport, from wherever the pilot last set it. The weather card
  // writes settings/homeAirport when they change it there, and onboarding
  // writes the same field onto the pilot profile, so both are read and the
  // explicit choice wins.
  async function resolveBase() {
    try {
      const row = await get('settings', 'homeAirport').catch(() => null)
      const pilot = await get('settings', 'pilot').catch(() => null)
      if (pilot) setUnits(pilot)
      const ident = (row?.value || pilot?.homeAirport || '').trim().toUpperCase()
      if (!ident) return
      const airports = await getAirports()
      // [ident, lat, lon, class]
      const hit = airports?.find(a => a[0] === ident)
      if (hit) setBase({ ident, lat: hit[1], lon: hit[2] })
    } catch {
      // No base is a normal state, not an error: the map falls back to the
      // pilot's position, and to a default before that arrives.
    } finally {
      setBaseResolved(true)
    }
  }

  // Newest first, which is the only order a logbook is ever read in.
  function loadFlights() {
    getAll('flights')
      .then(rows => setFlights([...rows].sort((a, b) => b.id - a.id)))
      .catch(() => {})
  }

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

  // Frame the map once, and only once. The base airport wins: it is the place
  // the pilot chose, it is there before any fix arrives, and it does not
  // wander. A GPS fix only frames the map when there is no base to use, so
  // opening the app away from home does not silently move the map off the
  // field the pilot planned around.
  //
  // Once framed the camera belongs to the pilot. Following every fix would
  // fight them panning the chart, which is the rule the planner already
  // follows; the locate button is how they ask to come back.
  // A ref, not state: this is a latch that guards an imperative camera move,
  // and flipping state inside the same effect that reads it is the cascading
  // render the compiler rightly rejects. Nothing renders from it.
  // mapReady is in the dependency list for a reason. The base can resolve
  // before Leaflet has built the map, and the old guard just returned when
  // mapRef was empty: nothing re-ran afterwards, so the map kept the default
  // centre while the ribbon showed the base airport. The two disagreed on
  // screen, which is exactly the kind of thing a pilot should never have to
  // reconcile.
  const framed = useRef(false)
  useEffect(() => {
    if (framed.current || !mapRef.current) return
    if (base) {
      framed.current = true
      mapRef.current.setView([base.lat, base.lon], 10, { animate: false })
      return
    }
    // Wait for the base lookup before letting a fix decide.
    if (baseResolved && pos) {
      framed.current = true
      mapRef.current.setView([pos.lat, pos.lon], 11, { animate: false })
    }
  }, [base, baseResolved, pos, mapReady])

  const toggleLayer = (k) => setLayers(prev => ({ ...prev, [k]: !prev[k] }))

  // Where am I, or failing that, where do I fly from. A locate button that
  // does nothing because the fix has not arrived reads as broken.
  function locate() {
    const target = pos ?? base
    if (target && mapRef.current) mapRef.current.setView([target.lat, target.lon], 12, { animate: true })
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
    loadFlights()
  }

  const recording = rec != null
  const track = rec?.track?.map(p => [p.lat, p.lon]) ?? []

  // The sheet is always the full height of the screen and is moved down out of
  // the way, rather than being resized. Animating transform is cheap and never
  // reflows its contents; animating height would relayout the whole list on
  // every frame of a drag.
  //
  // y is the distance from the top of the screen to the top of the sheet, so
  // 0 is full screen and larger numbers are further down.
  const vh = viewportH
  const Y_FULL = 0
  const Y_EXPANDED = Math.round(vh * (1 - SHEET_EXPANDED_VH))
  const Y_COLLAPSED = Math.max(0, vh - SHEET_COLLAPSED_PX)
  const restY = snap === 'full' ? Y_FULL : snap === 'expanded' ? Y_EXPANDED : Y_COLLAPSED
  const y = dragY != null ? dragY : restY

  // Corners square off as the sheet approaches the top, rather than snapping
  // from rounded to square at the end of the animation. Interpolated over the
  // last stretch only, so it reads as the sheet meeting the screen edge.
  const radius = Math.round(SHEET_RADIUS * Math.min(1, y / Math.max(1, Y_EXPANDED)))

  // Pointer events with capture, not touch or mouse handlers. Pulling the
  // sheet up moves the finger off the header almost immediately, and without
  // capture the element stops receiving moves the moment that happens: the
  // drag died on its first inch and the sheet snapped back. Capture keeps the
  // events coming to this element until the finger lifts, and covers touch,
  // mouse and pencil with one path.
  // Capture is taken on the first real movement, never on pointerdown. While a
  // pointer is captured the browser retargets the click to the capturing
  // element, so capturing immediately swallowed every tap on the aircraft,
  // start and route buttons inside this header: they pressed and did nothing.
  // Waiting for movement means a tap stays a tap, and a drag still keeps
  // receiving events after the finger leaves the header.
  function onDragStart(e) {
    drag.current = {
      startY: e.clientY, fromY: restY, moved: false,
      t0: Date.now(), lastY: restY, captured: false,
    }
  }
  function onDragMove(e) {
    const d = drag.current
    if (!d) return
    const dy = e.clientY - d.startY
    if (!d.moved) {
      if (Math.abs(dy) < DRAG_SLOP) return       // still a tap
      d.moved = true
      d.captured = true
      e.currentTarget.setPointerCapture?.(e.pointerId)
    }
    // Subtract the slop so the sheet starts moving from where the finger
    // crossed the threshold rather than jumping by it.
    const shifted = dy - Math.sign(dy) * DRAG_SLOP
    // Clamped, with no rubber band past either end: a sheet that can be pulled
    // past its stops feels broken rather than playful on a control surface.
    const next = Math.min(Y_COLLAPSED, Math.max(Y_FULL, d.fromY + shifted))
    d.lastY = next
    setDragY(next)
  }
  function onDragEnd(e) {
    const d = drag.current
    drag.current = null
    // Only release what was actually taken: releasing an uncaptured pointer
    // throws in some engines, and this path runs on every tap.
    if (d?.captured) e?.currentTarget?.releasePointerCapture?.(e.pointerId)
    if (!d) return
    if (!d.moved) { setDragY(null); return }      // a tap, not a drag
    // Read the position off the drag record rather than off state: the last
    // pointermove and this pointerup can land in the same batch, and state
    // would still be one frame behind.
    const dist = d.lastY - d.fromY
    const ms = Date.now() - d.t0
    const up = dist < 0
    // A fast flick decides on its own, regardless of how far it got: a short
    // sharp pull up should open the sheet even from the very bottom.
    const flick = ms < 260 && Math.abs(dist) > 24
    setDragY(null)

    // Past the trigger the sheet commits to full whatever the gesture was.
    // Dragging that far is unambiguous, and snapping back from there would
    // feel like the sheet fighting the hand.
    if (d.lastY <= vh * (1 - SHEET_FULL_TRIGGER)) { setSnap('full'); return }
    if (flick) {
      // Flicks move one stop in the direction of travel, so a hard pull from
      // collapsed does not skip past the useful middle stop to full screen.
      setSnap(up
        ? (snap === 'collapsed' ? 'expanded' : 'full')
        : (snap === 'full' ? 'expanded' : 'collapsed'))
      return
    }
    // Otherwise the nearest stop wins.
    const stops = [['full', Y_FULL], ['expanded', Y_EXPANDED], ['collapsed', Y_COLLAPSED]]
    setSnap(stops.reduce((best, s2) =>
      Math.abs(d.lastY - s2[1]) < Math.abs(d.lastY - best[1]) ? s2 : best)[0])
  }

  const statFont = { fontSize: 11, fontWeight: 600, color: 'rgba(60,60,67,0.6)', letterSpacing: '0.2px' }
  const statBig = { fontSize: 26, fontWeight: 800, color: '#1c1c1e', letterSpacing: '-0.6px', fontVariantNumeric: 'tabular-nums' }
  const tileBtn = { background: 'none', border: 'none', cursor: 'pointer', padding: 0,
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, width: 92 }
  const tileCircle = { width: 58, height: 58, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center' }
  const tileLabel = { fontSize: 12, fontWeight: 600, color: '#1c1c1e' }

  return (
    // Fixed to the viewport rather than flowing in the shell: the map is the
    // screen here, and it has to reach every edge including under the status
    // bar and the home indicator. body is the containing block, which is what
    // makes this land on the real screen bottom.
    <div style={{ position: 'fixed', inset: 0, background: '#e8e0d8', overflow: 'hidden' }}>
      <MapContainer center={INITIAL_CENTER} zoom={10} zoomControl={false} attributionControl={false}
        style={{ height: '100%', width: '100%' }}>
        <SizeWatcher mapRef={mapRef} onReady={onMapReady} />
        <Basemap />
        <ChartLayers layers={layers} openaipKey={openaipKey} />
        {track.length > 1 && (
          <Polyline positions={track} pathOptions={{ color: ACCENT, weight: 5, opacity: 0.9, lineCap: 'round' }} />
        )}
        {/* Home, marked. Framing the map on an unmarked field just looks like
            an arbitrary starting position. */}
        {base && (
          <CircleMarker center={[base.lat, base.lon]} radius={7}
            pathOptions={{ color: ACCENT, weight: 3, fillColor: '#fff', fillOpacity: 1 }}>
            <Tooltip permanent direction="top" offset={[0, -8]} className="home-base-label">
              {base.ident}
            </Tooltip>
          </CircleMarker>
        )}
        {pos && (
          <CircleMarker center={[pos.lat, pos.lon]} radius={8}
            pathOptions={{ color: '#fff', weight: 3, fillColor: '#1d7fff', fillOpacity: 1 }} />
        )}
      </MapContainer>

      {/* Top row: get the furniture out of the way, and the one reading a pilot
          opens the app for. The menu home showed conditions on arrival and the
          map home has to keep doing that, or weather becomes something you go
          looking for rather than something you are told. */}
      <div style={{ position: 'absolute', top: 'calc(var(--safe-top) + 10px)', left: 14, zIndex: 501 }}>
        <Ctrl onClick={() => setSheetOpen(o => !o)} title={sheetOpen ? 'Hide panel' : 'Show panel'} size={46}>
          <IconArrow up={!sheetOpen} />
        </Ctrl>
      </div>

      {/* Centred on the screen rather than laid out beside the arrow, so the
          conditions sit where the eye lands instead of being pushed off centre
          by whatever happens to be to their left. The margins keep it clear of
          the arrow on a narrow phone; past that the text ellipses. */}
      <div style={{
        position: 'absolute', top: 'calc(var(--safe-top) + 10px)', left: 0, right: 0,
        zIndex: 500, display: 'flex', justifyContent: 'center',
        padding: '0 74px', pointerEvents: 'none',
      }}>
        {base && (
          <div style={{ pointerEvents: 'auto', minWidth: 0 }}>
            <WeatherRibbon icao={base.ident} units={units} />
          </div>
        )}
      </div>

      {/* Right stack: charts, then position. Ordered by how often a hand
          reaches for them in the air. */}
      <div style={{
        position: 'absolute', right: 14, zIndex: 500,
        bottom: sheetOpen
          ? `calc(${SHEET_COLLAPSED_PX}px + var(--safe-bottom) + ${recording ? 132 : 16}px)`
          : 'calc(var(--safe-bottom) + 28px)',
        display: 'flex', flexDirection: 'column', gap: 12,
        transition: 'bottom 280ms cubic-bezier(0.4,0,0.2,1), opacity 200ms',
        opacity: expanded ? 0 : 1,
        pointerEvents: expanded ? 'none' : 'auto',
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
          bottom: sheetOpen
            ? `calc(${SHEET_COLLAPSED_PX}px + var(--safe-bottom) + ${recording ? 132 : 16}px)`
            : 'calc(var(--safe-bottom) + 28px)',
          display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end',
          transition: 'bottom 280ms cubic-bezier(0.4,0,0.2,1)',
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

      {/* The numbers, only once there are numbers. Before departure this card
          said 00:00 / 0 / 0.0, which is three lies dressed as instruments and
          a quarter of the screen spent saying nothing. It now arrives with the
          recording and leaves with it. */}
      <div style={{
        position: 'absolute', left: 12, right: 12, zIndex: 550,
        bottom: `calc(${SHEET_COLLAPSED_PX}px + var(--safe-bottom) + 10px)`,
        transform: recording ? 'translateY(0) scale(1)' : 'translateY(16px) scale(0.97)',
        opacity: recording ? 1 : 0,
        pointerEvents: recording ? 'auto' : 'none',
        transition: 'opacity 260ms ease-out, transform 260ms cubic-bezier(0.34,1.2,0.64,1)',
      }}>
        <div style={{
          background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(20px)',
          borderRadius: 18, padding: '16px 18px', boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
        }}>
          <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, color: '#1c1c1e', marginBottom: 12 }}>
            {rec?.paused ? 'Paused' : 'Recording'}
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ flex: 1, textAlign: 'left' }}>
              <div style={statBig}>{fmtClock(rec?.elapsedMs ?? 0)}</div>
              <div style={statFont}>Time</div>
            </div>
            <div style={{ flex: 1.2, textAlign: 'center' }}>
              <div style={{ ...statBig, fontSize: 42, letterSpacing: '-1.4px', lineHeight: 1 }}>
                {rec?.gsKt != null ? Math.round(rec.gsKt) : '0'}
              </div>
              <div style={statFont}>Ground speed (kt)</div>
            </div>
            <div style={{ flex: 1, textAlign: 'right' }}>
              <div style={statBig}>{(rec?.distNm ?? 0).toFixed(1)}</div>
              <div style={statFont}>Distance (NM)</div>
            </div>
          </div>
          {rec?.error && (
            <div style={{ marginTop: 10, fontSize: 11.5, color: '#FF3B30', textAlign: 'center', lineHeight: 1.4 }}>
              {rec.error}
            </div>
          )}
        </div>
      </div>

      {/* The sheet. Collapsed it is the actions; dragged up it is the rest of
          the app. Two resting heights and nothing in between, because a
          control surface that stops wherever the finger left it is a surface
          you have to aim at. */}
      <div style={{
        position: 'absolute', left: 0, right: 0, top: 0, zIndex: 600,
        height: '100%',
        transform: sheetOpen ? `translateY(${y}px)` : `translateY(${vh}px)`,
        // No transition while a finger is down: the sheet must track the
        // finger exactly, and easing a live drag is what makes one feel laggy.
        // The radius eases on the same curve so the corners and the movement
        // arrive together instead of the corners popping at the end.
        transition: dragY != null ? 'none'
          : 'transform 380ms cubic-bezier(0.32,0.72,0,1), border-radius 380ms cubic-bezier(0.32,0.72,0,1)',
        background: 'rgba(255,255,255,0.98)', backdropFilter: 'blur(20px)',
        borderRadius: `${radius}px ${radius}px 0 0`,
        boxShadow: '0 -4px 24px rgba(0,0,0,0.10)',
        display: 'flex', flexDirection: 'column',
        pointerEvents: sheetOpen ? 'auto' : 'none',
        // Squares off against the device's own corners at full screen, and
        // keeps the rounded corners from clipping the list while it slides.
        overflow: 'hidden',
      }}>

        {/* The grab area: handle and actions. Dragging anywhere on this moves
            the sheet, which is a bigger target than the handle alone and is
            what people reach for anyway. */}
        <div
          onPointerDown={onDragStart} onPointerMove={onDragMove}
          onPointerUp={onDragEnd} onPointerCancel={onDragEnd}
          style={{
            flexShrink: 0, touchAction: 'none', cursor: 'grab',
            // At full screen the sheet is under the status bar, so it has to
            // clear the notch itself. Below that the map is up there and this
            // padding would just be a gap.
            paddingTop: snap === 'full' ? 'calc(var(--safe-top) + 10px)' : 10,
            paddingLeft: 18, paddingRight: 18,
            transition: 'padding-top 380ms cubic-bezier(0.32,0.72,0,1)',
          }}>
          <div onClick={() => setSnap(s2 => (s2 === 'collapsed' ? 'expanded' : 'collapsed'))} style={{
            width: 40, height: 5, borderRadius: 3, background: 'rgba(60,60,67,0.2)',
            margin: '0 auto 14px', cursor: 'pointer',
          }} />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', gap: 10 }}>
            <button onClick={() => navigate('/aircraft')} style={tileBtn}>
              <span style={{ ...tileCircle, background: 'rgba(255,90,31,0.14)' }}>
                {ac?.image
                  ? <img src={ac.image} width={40} height={40} alt="" style={{ objectFit: 'contain' }} />
                  : <img src="/modo-avion.png" width={26} height={26} alt=""
                      style={{ objectFit: 'contain', transform: 'rotate(45deg)' }} />}
              </span>
              <span style={{ ...tileLabel, maxWidth: 92, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ac?.registration || ac?.fullName || 'Aircraft'}
              </span>
            </button>

            <button onClick={recording ? stopFlight : startFlight} style={{
              width: 86, height: 86, borderRadius: '50%', border: 'none', cursor: 'pointer',
              background: recording ? '#1c1c1e' : ACCENT,
              boxShadow: `0 6px 20px ${recording ? 'rgba(28,28,30,0.3)' : 'rgba(255,90,31,0.38)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 200ms',
            }}>
              {recording
                ? <svg width="26" height="26" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                : <svg width="30" height="30" viewBox="0 0 24 24" fill="#fff"><path d="M8 5.5v13l11-6.5z" /></svg>}
            </button>

            <button onClick={() => navigate('/checklists')} style={tileBtn}>
              <span style={{ ...tileCircle, background: 'rgba(60,60,67,0.09)', color: '#1c1c1e' }}>
                <IconRoute />
              </span>
              <span style={tileLabel}>Plan Route</span>
            </button>
          </div>

          <div style={{ textAlign: 'center', margin: '10px 0 6px', fontSize: 10, color: 'rgba(60,60,67,0.45)' }}>
            {recording ? 'Recording your track · tap the square to end and log it'
              : snap === 'full' ? 'Reference aid only · Always consult current FAR/AIM'
              : snap === 'expanded' ? 'Keep pulling for the full logbook'
              : 'Pull up for everything else'}
          </div>
        </div>

        {/* Everything else. Scrolls inside the sheet once expanded; inert while
            collapsed so a swipe there moves the sheet instead of the list. */}
        <div style={{
          flex: 1, minHeight: 0, overflowY: expanded ? 'auto' : 'hidden',
          WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain',
          padding: '6px 18px calc(var(--safe-bottom) + 24px)',
          opacity: expanded ? 1 : 0,
          transition: 'opacity 200ms ease-out',
          pointerEvents: expanded ? 'auto' : 'none',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {TOOLS.map(t => (
              <button key={t.to} onClick={() => navigate(t.to)} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '14px 14px',
                background: 'rgba(60,60,67,0.05)', border: 'none', borderRadius: 16,
                cursor: 'pointer', textAlign: 'left',
              }}>
                <img src={t.icon} width={24} height={24} alt="" style={{ objectFit: 'contain', flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#1c1c1e', lineHeight: 1.25 }}>{t.label}</span>
              </button>
            ))}
          </div>

          <div style={{ marginTop: 22, fontSize: 11, fontWeight: 700, letterSpacing: '0.6px',
            color: 'rgba(60,60,67,0.5)', textTransform: 'uppercase' }}>
            {snap === 'full' ? `Logbook · ${flights.length}` : 'Recent flights'}
          </div>
          {flights.length === 0 ? (
            <div style={{ marginTop: 10, padding: '22px 16px', borderRadius: 16,
              background: 'rgba(60,60,67,0.05)', textAlign: 'center' }}>
              <div style={{ fontSize: 13, color: 'rgba(60,60,67,0.6)' }}>No flights logged yet</div>
              <div style={{ fontSize: 11.5, color: 'rgba(60,60,67,0.45)', marginTop: 4 }}>
                Press start to record one, or complete a flight plan
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Collapsed the sheet shows a handful; at full screen it is the
                  whole logbook, which is the reason for having a full screen
                  at all. */}
              {(snap === 'full' ? flights : flights.slice(0, 4)).map(f => (
                <ActivityCard key={f.id} flight={f} />
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
