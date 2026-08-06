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

import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapContainer, Polyline, CircleMarker, Marker, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import ChartLayers, { Basemap } from '../../components/ChartLayers'
import { CHARTS, EMPTY_LAYERS, resolveOpenaipKey } from '../../components/chartDefs'
import DropPointPopup from '../../components/DropPointPopup'
// Route styling lives in one place now, shared with the planner and its
// preview map: three copies of a hex is how the three drifted apart.
import { ACCENT, accentAlpha, ROUTE_COLOR, ROUTE_OPACITY, ROUTE_WEIGHT } from '../../components/mapStyle'
import ActivityCard from '../../components/ActivityCard'
import TrafficLayer from '../../components/TrafficLayer'
import TrafficLegend from '../../components/TrafficLegend'
import useLiveTraffic from '../../hooks/useLiveTraffic'
import { CATEGORY_LABEL } from '../../components/trafficBands'
import AirportPickerModal from '../../components/AirportPickerModal'
import { createPortal } from 'react-dom'
import WeatherRibbon from '../../components/WeatherRibbon'
import { createRecorder, toFlightRecord, fmtClock } from '../../lib/flightRecorder'
import { put, get, getAll, del } from '../../lib/db'
import { getAirports } from '../../lib/aerodromes'
import { crossTrackNm } from '../../lib/corridor'
import { resolveHomeIdent } from '../../lib/homeBase'
import { loadTfrs } from '../../lib/tfr'
import useIsDark from '../../hooks/useIsDark'
import { TEMPLATES } from '../../data/aircraftTemplates'
import { useActiveAircraft } from '../../context/ActiveAircraft'

// The flight plan, loaded only when it is asked for. Same specifier App.jsx
// lazy-loads and the same one the idle warm-up below fetches, so all three
// share one chunk rather than making three copies of a megabyte and a half.
const Planner = lazy(() => import('../Checklists/Checklists'))

// The planned route, drawn to be told apart from the recorded track at a
// glance: the track is the accent orange, so the plan is violet. The exact
// value is the planner's own, from the preview map in RouteAltitude, because
// a route that changes colour on its way from one screen to the other reads
// as a different route.
// Close enough to see the field rather than the city it is named after.
//
// Ten put KRNO somewhere in the middle of greater Reno: correct, and useless.
// A pilot looking at their home airport wants the runways, their orientation
// and what is off each end. Fourteen puts about three kilometres across the
// screen, which is the whole of a large field and the ground around it, and it
// still reads at a glance on a phone.
const AIRPORT_ZOOM = 14
const CTRL = 52
// One size for every chart chip, so the column has a straight edge instead of
// stepping in and out with the length of each label.
const CHIP_W = 62
const CHIP_H = 38
const CHIP_GAP = 8

// How much room the right-hand controls need below the chips: two buttons, the
// gap between them, and a gap above.
const CTRL_STACK_H = CTRL * 2 + 12 + 10

// The tallest a column of chips may get before the next one starts.
//
// Without this the chips simply fill whatever height is available, so a tall
// phone gave a column of nine beside a column of three: it fits, but it reads
// as a mistake. Six is half of the twelve chips, so the common case is two even
// columns, and on a short window the height limit bites first and the wrap
// balances them itself.
const CHIP_COL_MAX = 6
const CHIP_STACK_MAX_H = CHIP_COL_MAX * (CHIP_H + CHIP_GAP) - CHIP_GAP

// The exact box a set of chips should occupy in the room available to it.
//
// Worked out here rather than left to the browser, because the browsers do not
// agree. A wrapping column flex box is supposed to shrink-wrap to the width of
// the columns it produced, and in Chrome it does. WebKit measures the intrinsic
// width as a single column, so on an iPhone the box came out 62 px wide against
// the right edge and laid every later column out beyond it, off the side of the
// screen: six of the twelve layers could not be reached at all.
//
// Width is decided first and is never negotiable, because a chip off the side
// of the screen is a chip that does not exist. Height gives way instead: on a
// window too short for the columns that fit across it, the stack grows upward
// past its cap rather than sideways out of reach. Overlapping the airport pill
// on a very small screen is a blemish; hiding half the layers is a fault.
function chipStackBox(availH, availW, count) {
  const fitsAcross = Math.max(1, Math.floor((availW + CHIP_GAP) / (CHIP_W + CHIP_GAP)))
  const fitsDown = Math.max(1, Math.floor((availH + CHIP_GAP) / (CHIP_H + CHIP_GAP)))
  const cols = Math.min(fitsAcross, Math.max(1, Math.ceil(count / fitsDown)))
  const rows = Math.ceil(count / cols)
  return {
    width: cols * CHIP_W + (cols - 1) * CHIP_GAP,
    height: rows * (CHIP_H + CHIP_GAP) - CHIP_GAP,
  }
}

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
// Where the drawer rests while the flight plan is open in it: half the screen
// each, map above and planner below, so the route can be watched as it is
// typed. It is tight, and deliberately so. The planner's own tab bar and
// action row take about a third of the space this leaves, and the answer to
// that is the drag up to full screen rather than a taller resting stop that
// would push the map out of the picture the planner exists to be seen against.
const SHEET_PLAN_VH = 0.5
// How much taller the collapsed drawer stands while it is carrying a route.
// Without it the card lands below the fold, hidden by the very drawer that
// exists to show it, and the pilot has to pull the sheet up to read numbers
// that were just put there for them.
const ROUTE_CARD_PX = 96
// How far a finger must travel before the sheet treats it as a drag rather
// than a tap. Below this the buttons in the header keep their taps.
const DRAG_SLOP = 6

// Everything else the app does. The map home would otherwise be a dead end:
// these are the screens the old menu-style home listed, and they keep their
// icons so nothing has to be relearned.
const TOOLS = [
  // No Flight Planning entry: Plan Route in the sheet header goes to the same
  // screen, and listing it twice makes the grid look fuller than it is while
  // teaching two routes to one place.
  { to: '/calc',       icon: '/E6B CALC.svg',   label: 'Calculators' },
  // Was '/currency', which no longer exists: that screen grew into Pilot,
  // which reports currency alongside medical, total time and the logbook.
  { to: '/pilot',      icon: '/cheque.png',     label: 'Pilot' },
  { to: '/reference',  icon: '/libros.png',     label: 'Quick Reference' },
  { to: '/airports',   icon: '/control-tower.png', label: 'Airports' },
  { to: '/tools',      icon: '/filtrar.png',    label: 'Tools' },
  // Placeholder icon: the project has no gear, and main drew these two as
  // inline SVG rather than PNG. Worth replacing when these screens are
  // restyled, along with the filter standing in for Tools.
  { to: '/settings',   icon: '/llaves.png',     label: 'Settings' },
]

// The card the map wears: floating above the drawer, panel glass, one radius
// and one shadow. The recording stats introduced this shape and the actions
// borrow it verbatim while the flight plan has the drawer, so the two read as
// one object in two states rather than as two designs that happen to be near
// each other. It animates in from below rather than appearing, which is what
// makes it read as arriving rather than as something that was always there
// and had been missed.
function FloatingCard({ visible, bottom, children }) {
  return (
    <div style={{
      position: 'absolute', left: 12, right: 12, zIndex: 550, bottom,
      transform: visible ? 'translateY(0) scale(1)' : 'translateY(16px) scale(0.97)',
      opacity: visible ? 1 : 0,
      pointerEvents: visible ? 'auto' : 'none',
      transition: 'opacity 260ms ease-out, transform 260ms cubic-bezier(0.34,1.2,0.64,1), bottom 380ms cubic-bezier(0.32,0.72,0,1)',
    }}>
      <div style={{
        background: 'var(--map-panel)', backdropFilter: 'blur(20px)',
        borderRadius: 18, padding: '16px 18px', boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
      }}>
        {children}
      </div>
    </div>
  )
}

// The planned route, on the drawer. The same four figures the planner shows
// under Calculate Route, in the same words, because a pilot who checked them
// there should not have to work out whether these are the same numbers.
//
// Magnetic course gets the emphasis: it is the one you actually fly. True
// course and variation are underneath it as the working, not as headline
// figures competing with it.
function RouteSummary({ route, onClear, onEdit }) {
  const stat = { display: 'flex', flexDirection: 'column', gap: 2 }
  const statValue = { fontSize: 17, fontWeight: 800, color: 'var(--map-ink)', letterSpacing: '-0.3px', fontVariantNumeric: 'tabular-nums' }
  const statLabel = { fontSize: 9, fontWeight: 600, color: 'var(--map-ink-faint)', letterSpacing: '0.4px' }

  return (
    <div style={{
      background: 'var(--map-fill)', borderRadius: 14, padding: '10px 12px', marginTop: 12,
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      {/* The whole card reopens the plan. The X is the only thing on it that
          does not, so it is given its own hit area away from the numbers. */}
      <button
        onClick={onEdit}
        style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', padding: 0,
          cursor: 'pointer', textAlign: 'left' }}>
        <div style={{
          fontSize: 13, fontWeight: 700, color: 'var(--map-ink)', marginBottom: 7,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {route.dep} <span style={{ color: 'var(--map-ink-faint)', fontWeight: 600 }}>→</span> {route.dest}
        </div>
        <div style={{ display: 'flex', gap: 20 }}>
          <div style={stat}>
            <span style={statValue}>{route.distNm}<span style={{ fontSize: 11, fontWeight: 600, marginLeft: 2 }}>NM</span></span>
            <span style={statLabel}>DISTANCE</span>
          </div>
          <div style={stat}>
            <span style={statValue}>{route.mc}°</span>
            <span style={statLabel}>MAG COURSE</span>
          </div>
          {/* Only if the planner actually produced them. A route restored from
              an older version of this record has the first two and not always
              the rest, and a blank figure on a flight plan is worse than none. */}
          {route.tc != null && (
            <div style={stat}>
              <span style={{ ...statValue, fontSize: 14, color: 'var(--map-ink-dim)' }}>{route.tc}°</span>
              <span style={statLabel}>TRUE</span>
            </div>
          )}
          {route.magVar != null && (
            <div style={stat}>
              <span style={{ ...statValue, fontSize: 14, color: 'var(--map-ink-dim)' }}>
                {parseFloat(route.magVar) >= 0 ? '+' : ''}{route.magVar}°
              </span>
              <span style={statLabel}>VAR</span>
            </div>
          )}
        </div>
      </button>

      <button
        onClick={onClear}
        aria-label="Clear route"
        style={{
          width: 30, height: 30, borderRadius: '50%', border: 'none', flexShrink: 0,
          background: 'var(--map-panel)', color: 'var(--map-ink-dim)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
          <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}

// One tapped aircraft. Deliberately sparse: this is a reference readout, and
// padding it with fields the feed reports unreliably would suggest more
// certainty than there is.
function SelectedAircraft({ ac, onClose }) {
  const rows = [
    ac.typ || ac.reg ? ['Aircraft', [ac.typ, ac.reg].filter(Boolean).join(' · ')] : null,
    ac.cat ? ['Class', CATEGORY_LABEL[ac.cat] ?? ac.cat] : null,
    ['Altitude', ac.gnd ? 'On ground' : ac.alt != null ? `${ac.alt.toLocaleString()} ft` : 'Unknown'],
    ['Ground speed', ac.gs != null ? `${Math.round(ac.gs)} kt` : 'Unknown'],
    ['Track', ac.trk != null ? `${Math.round(ac.trk)}°` : 'Unknown'],
    ['Position age', `${ac.age.toFixed(1)}s`],
  ].filter(Boolean)
  return (
    <div style={{
      background: 'var(--map-panel)', backdropFilter: 'blur(18px)',
      borderRadius: 16, padding: '12px 14px', minWidth: 210,
      boxShadow: '0 4px 20px rgba(0,0,0,0.14)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--map-ink)', fontFamily: 'monospace', letterSpacing: '0.5px' }}>
          {ac.cs || ac.id.toUpperCase()}
        </span>
        {ac.mlat && (
          <span style={{
            fontSize: 9, fontWeight: 800, letterSpacing: '0.4px', color: 'var(--map-ink-dim)',
            background: 'var(--map-fill)', padding: '2px 5px', borderRadius: 4,
          }}>MLAT</span>
        )}
        <button onClick={onClose} aria-label="Close" style={{
          marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--map-ink-faint)', padding: 2, display: 'flex',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, fontSize: 11.5, padding: '2px 0' }}>
          <span style={{ color: 'var(--map-ink-dim)' }}>{k}</span>
          <span style={{ color: 'var(--map-ink)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{v}</span>
        </div>
      ))}
    </div>
  )
}

// A round glass control. Every floating button on this screen is one of these,
// which is what makes the stack read as a set rather than as scattered chrome.
function Ctrl({ onClick, title, active, badge, children, size = CTRL }) {
  return (
    <button onClick={onClick} title={title} style={{
      position: 'relative', width: size, height: size, borderRadius: '50%',
      border: 'none', cursor: 'pointer', flexShrink: 0,
      background: active ? 'var(--map-ink)' : 'var(--map-panel)',
      color: active ? 'var(--map-ink-invert)' : 'var(--map-ink)',
      boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'background 160ms, color 160ms',
    }}>
      {children}
      {badge > 0 && (
        <span style={{
          position: 'absolute', top: -2, right: -2, minWidth: 20, height: 20,
          borderRadius: 10, background: 'var(--map-ink)', color: 'var(--map-ink-invert)',
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
// Sun behind cloud, matched to the reference: four rays rather than a full
// starburst, and the sun drawn as an open arc so the cloud sits in front of it
// instead of overlapping a complete circle. Drawn rather than imported so it
// takes currentColor and stays sharp at any size.
const IconWeather = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {/* rays: top, upper left, lower left, upper right */}
    <path d="M8.6 2.7V1.2" />
    <path d="M3.77 5.22L2.54 4.36" />
    <path d="M3.77 11.98L2.54 12.84" />
    <path d="M13.43 5.22L14.66 4.36" />
    {/* the sun, open where the cloud covers it */}
    <path d="M4.56 10.07A4.3 4.3 0 1 1 12.83 9.35" />
    {/* the cloud, in front */}
    <path d="M18.5 20H9.5a4 4 0 0 1-.6-7.95 5.5 5.5 0 0 1 10.55-1.2A4.1 4.1 0 0 1 18.5 20z" />
  </svg>
)

const IconRoute = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="5.5" r="2.5" />
    <path d="M8 18.5h6a3.5 3.5 0 0 0 0-7H10a3.5 3.5 0 0 1 0-7h6" />
  </svg>
)

// How far the thing under the finger has already been scrolled.
//
// The drawer used to ask its own list, which was right while its own list was
// the only thing in it. The flight plan brought its own scrollers, one per
// section, and none of them is that list: asking the wrong element returned
// zero, the drawer read every gesture as "starting from the top" and took the
// ones that belonged to the plan. Walking up from whatever was actually
// touched finds the right scroller in both cases, and 0 for a target that has
// no scroller above it, which is the honest answer.
function scrollTopUnder(target) {
  let el = target instanceof Element ? target : null
  while (el && el !== document.body) {
    if (el.scrollHeight > el.clientHeight) {
      const overflowY = getComputedStyle(el).overflowY
      if (overflowY === 'auto' || overflowY === 'scroll') return el.scrollTop
    }
    el = el.parentElement
  }
  return 0
}

// Takes the route planner's place in the action row while the plan is open.
// Same slot, same size, so the row does not reshuffle as the plan opens and
// closes: only what the third button does changes.
const IconClosePlan = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
    <path d="M18 6L6 18M6 6l12 12" />
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
function SizeWatcher({ mapRef, onReady, onMove }) {
  const map = useMap()
  useEffect(() => {
    mapRef.current = map
    onReady?.()
    const report = () => {
      const c = map.getCenter()
      onMove?.({ lat: c.lat, lon: c.lng })
    }
    report()
    map.on('moveend', report)
    const el = map.getContainer()
    const kick = () => map.invalidateSize({ animate: false, pan: false })
    // Once after layout settles, then only when the element actually changes
    // size. Not on a timer, and not on every render.
    const raf = requestAnimationFrame(kick)
    const ro = new ResizeObserver(kick)
    ro.observe(el)
    return () => { cancelAnimationFrame(raf); ro.disconnect(); map.off('moveend', report) }
  }, [map, mapRef, onReady, onMove])
  return null
}

export default function MapHome() {
  const navigate = useNavigate()

  // The aircraft the pilot is flying today, from the hangar.
  //
  // This used to read the 'aircraft' store's 'profile' row directly, back when
  // an app had exactly one aircraft. It now has a hangar, and its migration
  // re-keys that row to a generated id and DELETES 'profile'. So the old read
  // did not go stale, it became impossible to satisfy: the banner said "No
  // aircraft set" for every pilot who already had one.
  //
  // Going through the context rather than reading the store means switching
  // aircraft in the hangar changes the banner without a reload, which reading
  // once on mount never did.
  const { aircraftId, aircraftList } = useActiveAircraft() ?? {}
  const ac = useMemo(() => {
    const row = aircraftList?.find(a => a.id === aircraftId)
    if (!row) return null
    // The saved row carries identity only: id, registration, fullName, pilot
    // and Hobbs. The photograph and the book figures live in the template it
    // was created from, so they are matched back here. Without this the banner
    // knows the aircraft's name and nothing else, which is why the helicopter
    // had no picture.
    //
    // Forgiving match: a pilot who corrected the spacing or the case of their
    // aircraft's name should not lose its photograph over it.
    const norm = (v) => (v ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
    const tpl = TEMPLATES.find(t => norm(t.fullName) === norm(row.fullName))
    // Saved values win: a pilot who edited a figure meant it.
    return tpl ? { ...tpl, ...row } : row
  }, [aircraftId, aircraftList])

  const isDark = useIsDark()

  const [layers, setLayers] = useState(EMPTY_LAYERS)
  const [sheetOpen, setSheetOpen] = useState(true)
  // The sheet has two resting heights: the actions alone, and everything the
  // app can do. Dragging between them is how the rest of the app is reached
  // now that the home screen is a map, so it has to feel like a sheet rather
  // than a button that swaps screens.
  const [snap, setSnap] = useState('collapsed')   // collapsed | plan | expanded | full
  // Planning happens here now, not on a screen of its own. Plan Route raises
  // the drawer to the 'plan' stop and fills it with the flight plan, so the
  // map keeps showing what the route is being drawn across. /checklists still
  // exists and still works; this is the way in, not the only way.
  const [planning, setPlanning] = useState(false)
  // A route set by tapping the chart, waiting to be read back. Set when the
  // tap happens rather than when the calculation lands: the callback that
  // carries the result fires from inside the planner's own mount, and hanging
  // this off it meant the panel never appeared.
  const [confirmRoute, setConfirmRoute] = useState(false)
  // The calculated route: drawn on the map, summarised on the collapsed
  // drawer, and cleared by the X on that card. Read back from IndexedDB on
  // mount, so a route survives the app being closed and reopened, which is
  // what a flight plan made the night before has to do.
  const [route, setRoute] = useState(null)
  // The closed drawer's height, which is not one number any more: it stands
  // taller when it has a route to report. Not while planning, where the
  // drawer's height is set by the planning stop instead.
  const collapsedPx = SHEET_COLLAPSED_PX + (route && !planning && !confirmRoute ? ROUTE_CARD_PX : 0)
  // The viewport, measured rather than assumed: reading window.innerHeight
  // during render is fine once, but it has to be re-read when the phone is
  // rotated or the browser chrome changes, or every snap point is stale.
  const [viewportH, setViewportH] = useState(() => window.innerHeight)
  const [dragY, setDragY] = useState(null)      // live offset while a finger is down
  const drag = useRef(null)
  // The room the chips have, measured rather than recomputed. Its CSS height is
  // a min() of a constant and a viewport expression that includes the safe-area
  // inset, and the inset is not a number this side of the stylesheet: on the
  // phone it is whatever the notch says it is. Measuring is the only way to
  // know how many chips actually fit, and getting that wrong is what put half
  // the layers off the side of the screen.
  //
  // Safe to measure because the box it observes is sized by the viewport and
  // the drawer alone. The stack whose size this decides is a child of it, so
  // nothing here can feed back into what is being measured.
  const chipAreaRef = useRef(null)
  // Seeded with a sensible guess rather than zero, so the first painted frame
  // is already close. A zero width would compute a single column and the stack
  // would visibly reflow the moment the real measurement landed.
  const [chipArea, setChipArea] = useState(() => ({ h: CHIP_STACK_MAX_H, w: window.innerWidth - 28 }))
  const [chartsOpen, setChartsOpen] = useState(false)
  // Nothing renders until the layers button is tapped once. Without this the
  // closing animation would play on first paint and the chips would flash in
  // and out before anyone asked for them.
  const [chartsEverOpened, setChartsEverOpened] = useState(false)
  const [rec, setRec] = useState(null)
  const [pos, setPos] = useState(null)
  // Resolved at first render rather than in an effect: the key is synchronous
  // (localStorage or the built-in), so fetching it in an effect would just
  // render once without it and once with.
  const [openaipKey, setOpenaipKey] = useState(resolveOpenaipKey)
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
  // Only the whole-degree cell matters to the traffic proxy, so this is
  // updated on moveend rather than continuously: panning within one cell
  // changes nothing anyone needs to know about.
  const [mapCentre, setMapCentre] = useState(null)
  const [selected, setSelected] = useState(null)
  // Fetched once when the chip is first switched on, not on mount: TFRs change
  // slowly and most sessions never ask for them.
  const [tfrData, setTfrData] = useState(null)
  // GA focus by default: this app is for pilots flying light aircraft, so the
  // traffic that matters to them should be the traffic that stands out.
  const [tfcFilter, setTfcFilter] = useState('ga')
  // The working weather screen is the detail overlay, not the /weather route,
  // which is still a placeholder. Both ways in land on the same one.
  const [wxDetail, setWxDetail] = useState(false)
  const [basePicker, setBasePicker] = useState(false)
  const mapRef = useRef(null)
  // Created once, via lazy initial state rather than a ref written during
  // render: a recording must outlive re-renders, and reading or writing a ref
  // while rendering is exactly what breaks under the compiler.
  const [recorder] = useState(() => createRecorder({ onUpdate: setRec }))

  const activeCount = Object.values(layers).filter(Boolean).length
  const chipLayout = chipStackBox(chipArea.h, chipArea.w, CHARTS.length)

  // Whether anything is drawn ON the basemap. The FAA rasters and the openAIP
  // airspace are semi-transparent and were drawn for paper: over dark tiles
  // their greens and blues turn to mud and the altitude figures stop being
  // readable, which defeats the point of turning them on. So the dark basemap
  // is for the bare map only, and yields the moment a chart needs it.
  //
  // Traffic and TFRs are not in this list: they are opaque vector overlays and
  // read as well over dark tiles as over light ones.
  const chartOverBasemap = ['sectional', 'terrain', 'ifrlo', 'ifrhi', 'airspace']
    .some(k => layers[k])
  // What the tiles under everything else actually are, which is not the same
  // question as what theme the app is in. Anything drawn on top of the map has
  // to contrast with this, not with the sheet.
  const darkBasemap = isDark && !chartOverBasemap
  const expanded = snap !== 'collapsed'

  // Warm the planner while the pilot is looking at the map.
  //
  // Plan Route lazy-loads a 1.4 MB chunk (250 kB over the wire), and the tap
  // was paying for all of it: nothing happens until the download and parse
  // finish, which on cellular is seconds of a button that looks broken.
  // Fetching it during idle time means the module is already in memory by the
  // time it is asked for, and the tap is immediate.
  //
  // Not on a metered or slow connection. A pilot on one bar of cellular did
  // not ask for a quarter megabyte they may never use, and the honest trade
  // there is a slower tap rather than their data.
  useEffect(() => {
    const conn = navigator.connection
    if (conn?.saveData) return
    if (conn && /2g/.test(conn.effectiveType ?? '')) return

    const idle = window.requestIdleCallback ?? (cb => setTimeout(cb, 2000))
    const cancel = window.cancelIdleCallback ?? clearTimeout
    // Same specifier App.jsx lazy-loads, so this warms that exact chunk
    // rather than creating a second copy of it.
    const id = idle(() => { import('../Checklists/Checklists').catch(() => {}) })
    return () => cancel(id)
  }, [])

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
    // A key the pilot pasted into the planner lives in the settings store and
    // may differ from the built-in one resolved above.
    get('settings', 'openaip_key')
      .then(r => { if (r?.value) setOpenaipKey(r.value) })
      .catch(() => {})
    loadFlights()
    resolveBase()
  }, [])

  // Moving base. Writes the same settings row the weather card writes, so the
  // two screens never disagree about where home is, then re-resolves the
  // coordinates and takes the map there: changing your base and being left
  // looking at the old one would be its own small bug.
  async function changeBase(ident) {
    const id = (ident || '').trim().toUpperCase()
    if (!id) return
    await put('settings', { key: 'homeAirport', value: id }).catch(() => {})
    const airports = await getAirports()
    const hit = airports?.find(a => a[0] === id)
    if (!hit) {
      // The picker validated it against live weather, so this means the
      // bundled table does not carry it. Keep the ident, which is what the
      // weather strip needs, and leave the camera alone.
      setBase({ ident: id, lat: base?.lat ?? null, lon: base?.lon ?? null })
      return
    }
    setBase({ ident: id, lat: hit[1], lon: hit[2] })
    mapRef.current?.setView([hit[1], hit[2]], AIRPORT_ZOOM, { animate: true })
  }

  // The home airport, from wherever the pilot last set it. The weather card
  // writes settings/homeAirport when they change it there, and onboarding
  // writes the same field onto the pilot profile, so both are read and the
  // explicit choice wins.
  async function resolveBase() {
    try {
      const pilot = await get('settings', 'pilot').catch(() => null)
      if (pilot) setUnits(pilot)
      // Shared with the route planner, which used to read only the explicit
      // setting and so showed an empty FROM for a pilot whose base lived on
      // their profile. One answer, one place.
      const ident = await resolveHomeIdent()
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
      mapRef.current.setView([base.lat, base.lon], AIRPORT_ZOOM, { animate: false })
      return
    }
    // Wait for the base lookup before letting a fix decide.
    if (baseResolved && pos) {
      framed.current = true
      mapRef.current.setView([pos.lat, pos.lon], 11, { animate: false })
    }
  }, [base, baseResolved, pos, mapReady])

  // Keep the measurement honest as the window changes: a rotation, the browser
  // chrome appearing, the sheet opening and closing all move the height the
  // stack is allowed. ResizeObserver reports the first size on observe(), so
  // there is no separate initial read.
  // chartsEverOpened is in the dependencies because the stack is not in the
  // DOM until the layers button has been pressed once. Observing at mount
  // found nothing, returned, and never ran again, so the count stayed at the
  // starting guess of six rows while the box was really tall enough for four:
  // the chips wrapped into a third column and it hung off the right edge. The
  // same bug this measurement exists to prevent, arrived at from the other
  // direction.
  useLayoutEffect(() => {
    const el = chipAreaRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const { clientHeight: h, clientWidth: w } = entry.target
      setChipArea(prev => (prev.h === h && prev.w === w ? prev : { h, w }))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [chartsEverOpened])

  // A route planned earlier is still the plan. Restored on mount so the line
  // is on the map when the app is opened the morning after it was drawn, which
  // is when a flight plan is most often looked at.
  useEffect(() => {
    get('settings', 'route')
      .then(saved => { if (saved?.depPos && saved?.destPos) setRoute(saved) })
      .catch(() => {})
  }, [])

  // Departure, every waypoint the planner expanded, then destination. The
  // planner has already turned airways and procedures into the fixes they
  // stand for, so this is a plain list of points and needs no aeronautical
  // knowledge of its own.
  const routeLine = useMemo(() => {
    if (!route?.depPos || !route?.destPos) return []
    const mid = (route.wpts ?? [])
      .filter(w => w?.lat != null && w?.lon != null)
      .map(w => [w.lat, w.lon])
    return [route.depPos, ...mid, route.destPos]
  }, [route])

  // The same points as routeLine, in the shape the drop popup wants them.
  const routeWpts = useMemo(
    () => routeLine.map(([lat, lon]) => ({ lat, lon })),
    [routeLine],
  )

  // A point held on the map, put into the plan.
  //
  // The waypoint is inserted into the leg it is nearest, and the figures the
  // planner derived are dropped in the same write. Distance, course and
  // magnetic variation all describe the route as it was before this point
  // existed, and a distance that no longer matches the line drawn over it is
  // worse than no distance: it is a wrong number wearing the planner's
  // authority. The planner recomputes them the moment it is opened.
  const addDroppedWaypoint = useCallback(async ({ lat, lon, seg }) => {
    setRoute(prev => {
      if (!prev?.depPos || !prev?.destPos) return prev
      const wpts = [...(prev.wpts ?? [])]
      // seg counts legs from 1, and leg 1 begins at departure, so the index
      // into the middle waypoints is one less again.
      const at = seg == null ? wpts.length : Math.max(0, Math.min(wpts.length, seg - 1))
      // A point held on open ground has no name, so it gets one. Numbered from
      // the highest already in the route rather than from the count, so
      // deleting WPT1 does not hand its name to the next point added and leave
      // two different places called the same thing in one flight plan.
      const highest = wpts.reduce((max, w) => {
        const n = /^WPT(\d+)$/.exec(w?.name ?? '')
        return n ? Math.max(max, Number(n[1])) : max
      }, 0)
      wpts.splice(at, 0, { lat, lon, name: `WPT${highest + 1}` })
      const next = { ...prev, wpts, needsRecalc: true }
      for (const stale of ['distNm', 'trueCourse', 'magCourse', 'magVar']) delete next[stale]
      put('settings', { key: 'route', ...next }).catch(() => {})
      return next
    })
  }, [])

  // A field tapped on the map, made the destination.
  //
  // "Add to route" from an aerodrome means "take me there", so this sets the
  // destination rather than inserting a waypoint mid-route. The planner is
  // then opened to do the arithmetic, because distance, course and magnetic
  // variation are its job and computing a second opinion here is how two
  // screens end up disagreeing about the same flight.
  //
  // By identifier wherever there is one. A route filed as 30NV can be read
  // back to a controller; one filed as a pair of coordinates cannot, and the
  // planner can resolve an ident into a position but not the reverse.
  const addFieldToRoute = useCallback(async ({ ident, lat, lon }) => {
    const id = (ident ?? '').trim().toUpperCase()
    await put('settings', {
      key: 'pendingDest',
      value: id || null,
      lat, lon,
    }).catch(() => {})
    setConfirmRoute(true)
    setPlanning(true)
    setSnap('plan')
  }, [])

  // The same field, added to the plan rather than replacing where it ends.
  //
  // Named by its identifier, so a plan reads KRNO, NV78, KSFO rather than
  // three coordinates. Inserted into the leg it is nearest, and the planner's
  // derived figures are dropped in the same write for the same reason a
  // dropped point drops them: a distance describing the route before this
  // point existed is a wrong number wearing the planner's authority.
  const addFieldAsWaypoint = useCallback(({ ident, lat, lon }) => {
    const name = (ident ?? '').trim().toUpperCase() || null
    setRoute(prev => {
      if (!prev?.depPos || !prev?.destPos) return prev
      const wpts = [...(prev.wpts ?? [])]
      let seg = null, best = Infinity
      const line = [prev.depPos, ...wpts.map(w => [w.lat, w.lon]), prev.destPos]
      for (let i = 0; i < line.length - 1; i++) {
        const d = crossTrackNm(lat, lon, line[i], line[i + 1])
        if (d < best) { best = d; seg = i + 1 }
      }
      const at = Math.max(0, Math.min(wpts.length, (seg ?? wpts.length + 1) - 1))
      wpts.splice(at, 0, { lat, lon, name })
      const next = { ...prev, wpts, needsRecalc: true }
      for (const stale of ['distNm', 'trueCourse', 'magCourse', 'magVar']) delete next[stale]
      put('settings', { key: 'route', ...next }).catch(() => {})
      return next
    })
  }, [])

  // Frame a new route once. The plan is what the map is being looked at for
  // the moment one exists, so it takes the camera from the base framing above
  // rather than being drawn somewhere off the edge of a map still centred on
  // home. Keyed on the route's own endpoints, so panning away afterwards
  // stands: only a different route moves the camera again.
  const fittedRoute = useRef(null)
  useEffect(() => {
    if (!mapRef.current || routeLine.length < 2) return
    const key = JSON.stringify(routeLine)
    if (fittedRoute.current === key) return
    fittedRoute.current = key
    framed.current = true
    mapRef.current.fitBounds(L.latLngBounds(routeLine), {
      // The drawer covers the bottom of the map, so the route is fitted into
      // what is actually visible above it rather than into the whole map, on
      // which the destination would sit behind the card describing it.
      paddingTopLeft: [40, 40],
      paddingBottomRight: [40, SHEET_COLLAPSED_PX + ROUTE_CARD_PX + 40],
      // Not animated, and not for want of polish. Flying the camera to a route
      // restored at mount left the basemap blank: Leaflet ran the zoom
      // animation and never fetched tiles for where it landed, so the line was
      // drawn over nothing at all. Cutting straight to the framing loads them
      // every time. A map with no map on it is not a trade worth making for a
      // half-second glide.
      animate: false,
    })
  }, [routeLine, mapReady])

  // The pilot's own position marker, in the shape of what they fly. The
  // top-down silhouette is the one that reads as an aircraft on a map; the
  // other plane icon is a three-quarter view of one taking off, which points
  // nowhere useful once it is sitting on a chart.
  //
  // No badge behind it. A drop shadow carries it over the basemap without
  // putting a disc on the map, though it will work harder over a sectional
  // than over the plain basemap: that is the trade for a clean marker.
  const isHelicopter = ac?.category === 'helicopter'
  const baseIcon = useMemo(() => L.divIcon({
    className: 'home-base-icon',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    // The source art is a dark silhouette, so it is flattened to a single
    // solid colour and then flipped to whichever one the basemap is not.
    // brightness(0) crushes it to black; invert(1) after that turns it white.
    // Order matters: the drop shadow comes last so it is cast by the finished
    // shape rather than being inverted along with it.
    html: `<img src="${isHelicopter ? '/helicopter.png' : '/modo-avion.png'}" alt=""
      style="width:30px;height:30px;object-fit:contain;
             filter:brightness(0)${darkBasemap ? ' invert(1)' : ''}
                    drop-shadow(0 1px 2px rgba(0,0,0,${darkBasemap ? 0.7 : 0.45}));" />`,
    // Inline styles, not width and height attributes: those are presentational
    // hints that lose to any CSS rule, and leaflet.css forces max-width:none
    // on images in the map, so attributes alone rendered this at its natural
    // 512px and covered half the screen.
  }), [isHelicopter, darkBasemap])

  const toggleLayer = (k) => setLayers(prev => {
    if (k === 'traffic' && prev.traffic) setSelected(null)
    return { ...prev, [k]: !prev[k] }
  })

  useEffect(() => {
    if (!layers.tfr || tfrData) return
    let cancelled = false
    loadTfrs()
      .then(rows => { if (!cancelled) setTfrData(rows) })
      .catch(() => { if (!cancelled) setTfrData([]) })
    return () => { cancelled = true }
  }, [layers.tfr, tfrData])

  const traffic = useLiveTraffic({
    enabled: layers.traffic,
    lat: mapCentre?.lat ?? base?.lat,
    lon: mapCentre?.lon ?? base?.lon,
  })

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

  // ── The planner, opened and closed in place ──────────────────────────
  function openPlanner() {
    setSheetOpen(true)
    setPlanning(true)
    setSnap('plan')
  }

  function leavePlanner() {
    setPlanning(false)
    setSnap('collapsed')
  }

  // Calculate Route was pressed and it worked. The drawer's job now is to get
  // out of the way of the line it just produced, which is the whole point of
  // planning on top of the map rather than on a screen away from it.
  function onRouteCalculated(calculated) {
    setRoute(calculated)
    setPlanning(false)
    // A route the pilot typed and calculated themselves needs no read-back:
    // they were watching the numbers as they made them. One that came from a
    // tap on the chart does, which is what confirmRoute is already tracking.
    if (!confirmRoute) setSnap('collapsed')
    else setSnap('expanded')
  }

  // Forget the route: off the map, off the drawer, out of storage. Deleted
  // rather than just dropped from state, or it would come back on the next
  // launch, and a route the pilot dismissed coming back is worse than one
  // that never persisted at all.
  function clearRoute() {
    setRoute(null)
    del('settings', 'route').catch(() => {})
  }

  const recording = rec != null

  // What the drawer is telling the pilot to do next, which is nothing once it
  // is already all the way open. Empty means the line is not rendered at all,
  // rather than rendered blank and still taking its margins.
  //
  // Declared here rather than up with the other route derivations: it reads
  // `recording`, which is defined on the line above, and a const cannot be
  // read before it is initialised. Putting it earlier took the whole screen
  // down with a temporal dead zone error.
  const gestureHint = recording
    ? 'Recording your track · tap the square to end and log it'
    : snap === 'expanded' ? 'Keep pulling for the full logbook'
    : snap === 'collapsed' ? 'Pull up for everything else'
    : ''
  const track = rec?.track?.map(p => [p.lat, p.lon]) ?? []

  // Where the bottom of the chip stack sits: clear of the sheet, then clear of
  // the two map controls, so the chips rest on top of the layers button that
  // opens them. Kept as a bare expression rather than a finished calc() because
  // it is used twice, once as an offset and once subtracted from the available
  // height, and calc() nests but does not concatenate.
  const chipStackBottom = sheetOpen
    ? `${collapsedPx}px + var(--safe-bottom) + ${recording ? 132 : 16}px + ${CTRL_STACK_H}px`
    : `var(--safe-bottom) + 28px + ${CTRL_STACK_H}px`

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
  const Y_PLAN = Math.round(vh * (1 - SHEET_PLAN_VH))
  const Y_COLLAPSED = Math.max(0, vh - collapsedPx)
  const restY = snap === 'full' ? Y_FULL
    : snap === 'expanded' ? Y_EXPANDED
    : snap === 'plan' ? Y_PLAN
    : Y_COLLAPSED
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
  // fromBody marks a gesture that began over the drawer's contents rather than
  // its header. Those have to decide between moving the sheet and scrolling
  // the list, which the header never does.
  function onDragStart(e, fromBody = false) {
    drag.current = {
      startY: e.clientY, startX: e.clientX, fromY: restY, moved: false,
      t0: Date.now(), lastY: restY, captured: false,
      fromBody, atTop: scrollTopUnder(e.target) <= 0,
    }
  }
  const onBodyDragStart = (e) => onDragStart(e, true)
  function onDragMove(e) {
    const d = drag.current
    if (!d) return
    const dy = e.clientY - d.startY
    if (!d.moved) {
      // Sideways belongs to whatever is underneath. The flight plan swipes
      // between its five sections, and a sheet that lurched every time the
      // pilot moved from Route to Performance would be unusable. Decided on
      // the first movement that clears the slop, so a gesture is claimed once
      // and does not change its mind halfway.
      if (d.fromBody && Math.abs(e.clientX - d.startX) > Math.abs(dy)) {
        drag.current = null
        return
      }
      if (Math.abs(dy) < DRAG_SLOP) return       // still a tap
      // A drag that began over the contents only takes the sheet when there
      // is nothing to scroll in the direction it is going: at full height the
      // list scrolls, and only a pull down from the very top hands the gesture
      // back to the sheet. Below full height there is no scrolling to lose,
      // so the whole drawer moves as one object, which is what a sheet that
      // shows a photograph should do.
      if (d.fromBody && snap === 'full' && !(d.atTop && dy > 0)) {
        drag.current = null
        return
      }
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

    // With the planner in the drawer there are only two stops, half and full,
    // and a third outcome: pulled down far enough, the plan is put away. That
    // costs nothing to do by accident. Every field writes itself to storage as
    // it is filled in, and Plan Route comes back to exactly the same place.
    if (planning) {
      if (d.lastY > (Y_PLAN + Y_COLLAPSED) / 2 || (flick && !up && snap === 'plan')) {
        leavePlanner()
        return
      }
      setSnap(Math.abs(d.lastY - Y_FULL) < Math.abs(d.lastY - Y_PLAN) ? 'full' : 'plan')
      return
    }

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

  const statFont = { fontSize: 11, fontWeight: 600, color: 'var(--map-ink-dim)', letterSpacing: '0.2px' }
  const statBig = { fontSize: 26, fontWeight: 800, color: 'var(--map-ink)', letterSpacing: '-0.6px', fontVariantNumeric: 'tabular-nums' }
  const tileBtn = { background: 'none', border: 'none', cursor: 'pointer', padding: 0,
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, width: 92 }
  const tileCircle = { width: 58, height: 58, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center' }
  const tileLabel = { fontSize: 12, fontWeight: 600, color: 'var(--map-ink)' }

  // Weather, record, and the planner: the three things the drawer is for.
  // Defined once and rendered in one of two places, because they are the same
  // three buttons wherever they are standing. While the flight plan has the
  // drawer they move onto a card floating over the map, so the plan gets the
  // whole drawer and the actions stay where a thumb can reach them.
  //
  // Only the third button changes with the state, and only in what it does:
  // with the plan open it closes the plan rather than opening one, so the row
  // never contains a button that would do nothing.
  const actionRow = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', gap: 10 }}>
      <button
        onClick={() => (base ? setWxDetail(true) : setBasePicker(true))}
        style={tileBtn}>
        <span style={{ ...tileCircle, background: 'var(--map-fill)', color: 'var(--map-ink)' }}>
          <IconWeather />
        </span>
        <span style={tileLabel}>Weather</span>
      </button>

      <button onClick={recording ? stopFlight : startFlight} style={{
        width: 86, height: 86, borderRadius: '50%', border: 'none', cursor: 'pointer',
        background: recording ? 'var(--map-ink)' : ACCENT,
        boxShadow: `0 6px 20px ${recording ? 'rgba(28,28,30,0.3)' : accentAlpha(0.38)}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 200ms', flexShrink: 0,
      }}>
        {recording
          ? <svg width="26" height="26" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
          : <svg width="30" height="30" viewBox="0 0 24 24" fill="#fff"><path d="M8 5.5v13l11-6.5z" /></svg>}
      </button>

      <button onClick={planning ? leavePlanner : openPlanner} style={tileBtn}>
        <span style={{ ...tileCircle, background: 'var(--map-fill)', color: 'var(--map-ink)' }}>
          {planning ? <IconClosePlan /> : <IconRoute />}
        </span>
        <span style={tileLabel}>{planning ? 'Close Plan' : 'Plan Route'}</span>
      </button>
    </div>
  )

  return (
    // Fixed to the viewport rather than flowing in the shell: the map is the
    // screen here, and it has to reach every edge including under the status
    // bar and the home indicator. body is the containing block, which is what
    // makes this land on the real screen bottom.
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', overflow: 'hidden' }}>
      <MapContainer center={INITIAL_CENTER} zoom={10} zoomControl={false} attributionControl={false}
        style={{ height: '100%', width: '100%' }}>
        <SizeWatcher mapRef={mapRef} onReady={onMapReady} onMove={setMapCentre} />
        {layers.traffic && (
          <TrafficLayer snapshot={traffic.snapshot} onSelect={setSelected} filter={tfcFilter} />
        )}
        <Basemap dark={darkBasemap} />
        <ChartLayers layers={layers} openaipKey={openaipKey} tfrData={tfrData}
          onSetDestination={addFieldToRoute}
          // Only offered once there is a route to add to. Without one there is
          // no leg to insert into and nothing the action could mean.
          onAddWaypoint={routeLine.length > 1 ? addFieldAsWaypoint : undefined} />
        {/* Hold anywhere for the coordinates of that spot, and to put it in
            the route. Same component the planner's map uses. A long press
            rather than a tap, because a tap has to stay free for panning and
            for tapping a traffic target. */}
        <DropPointPopup
          waypoints={routeWpts}
          onSetDestination={addFieldToRoute}
          onAddWaypoint={routeLine.length > 1 ? addDroppedWaypoint : undefined}
        />
        {/* The plan, under the track rather than over it: where both exist,
            what was actually flown is the one that has to be readable. */}
        {routeLine.length > 1 && (
          <>
            <Polyline positions={routeLine}
              pathOptions={{ color: ROUTE_COLOR, weight: ROUTE_WEIGHT, opacity: ROUTE_OPACITY, lineCap: 'round', lineJoin: 'round' }} />
            {/* Turning points, small: they are structure, not destinations. */}
            {routeLine.slice(1, -1).map((p, i) => (
              <CircleMarker key={`wpt-${i}`} center={p} radius={3.5}
                pathOptions={{ color: '#fff', weight: 1.5, fillColor: ROUTE_COLOR, fillOpacity: 1 }} />
            ))}
            {[[routeLine[0], route.dep], [routeLine[routeLine.length - 1], route.dest]].map(([p, ident]) => (
              <CircleMarker key={`end-${ident}`} center={p} radius={6}
                pathOptions={{ color: '#fff', weight: 2.5, fillColor: ROUTE_COLOR, fillOpacity: 1 }}>
                <Tooltip permanent direction="top" offset={[0, -10]} className="home-base-label">
                  {ident}
                </Tooltip>
              </CircleMarker>
            ))}
          </>
        )}
        {track.length > 1 && (
          <Polyline positions={track} pathOptions={{ color: ACCENT, weight: 5, opacity: 0.9, lineCap: 'round' }} />
        )}
        {/* Home, marked with what the pilot flies. A ring says "a place";
            the aircraft says "your place", and the app already knows whether
            that is a helicopter or an aeroplane. Same test the planner and the
            one-pager use, so all three agree. */}
        {base?.lat != null && (
          <Marker position={[base.lat, base.lon]} icon={baseIcon} interactive={false}>
            <Tooltip permanent direction="top" offset={[0, -14]} className="home-base-label">
              {base.ident}
            </Tooltip>
          </Marker>
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
        <div style={{ pointerEvents: 'auto', minWidth: 0 }}>
          <WeatherRibbon
            icao={base?.ident ?? null} units={units}
            onChangeAirport={changeBase}
            detailOpen={wxDetail} onDetailChange={setWxDetail} />
        </div>
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
        <Ctrl onClick={() => { setChartsOpen(o => !o); setChartsEverOpened(true) }} title="Chart layers"
          active={chartsOpen} badge={activeCount}><IconLayers /></Ctrl>
        <Ctrl onClick={locate} title="Center on my position"><IconLocate /></Ctrl>
      </div>

      {/* Chart chips, revealed by the layers button rather than always on
          screen: six permanent chips is what a cluttered EFB looks like. */}
      {chartsEverOpened && (
        <div ref={chipAreaRef} style={{
          // The room the chips are allowed, which is a different question from
          // the shape they take in it. This box claims the space and nothing
          // else: it is sized entirely by the viewport and the drawer, never by
          // its contents, which is what makes it safe to measure. The stack
          // inside is then given exact numbers rather than left to work its own
          // size out, because that is the part the browsers disagree about.
          //
          // Sits directly on top of the layers button, and shares its right
          // edge so the chips, the layers button and the locate button all line
          // up. It grows upward from there, and must never grow past the
          // airport pill: that is the height cap below.
          position: 'absolute', left: 14, right: 14, zIndex: 500,
          bottom: `calc(${chipStackBottom})`,
          // Two limits, whichever is smaller. CHIP_STACK_MAX_H keeps the columns
          // even on a tall phone, where unlimited height gave a column of nine
          // beside a column of three: it fit, but it read as a mistake. The
          // second is the room actually left between the pill and the button,
          // which is what bites on a short screen and makes it wrap instead.
          height: `min(${CHIP_STACK_MAX_H}px, calc(100% - var(--safe-top) - 58px - (${chipStackBottom})))`,
          display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end',
          // Fades out with the rest of the map's chrome when the sheet is
          // raised. Hung from the button these rode up with it; pinned to the
          // top they would otherwise sit over the strip of map the expanded
          // sheet leaves behind.
          opacity: expanded ? 0 : 1,
          transition: 'opacity 200ms',
          // The claimed area is most of the map. Only the chips inside it may
          // take a tap; everything else here has to fall through to the map.
          pointerEvents: 'none',
        }}>
        <div style={{
          // Exact, both ways. Plain wrap fills left to right, so SECT stays the
          // top-left chip and the set still reads in order. wrap-reverse also
          // fits but starts at the right, and the columns then read backwards.
          //
          // Left to size itself, this box was wrong on a phone and right on a
          // desktop: WebKit measures the intrinsic width of a wrapping column
          // as one column, so it came out 62 px wide against the right edge and
          // laid every later column out beyond it, off the side of the screen.
          // Six of the twelve layers could not be reached at all.
          width: chipLayout.width,
          height: chipLayout.height,
          display: 'flex', flexDirection: 'column', flexWrap: 'wrap',
          gap: CHIP_GAP, alignContent: 'flex-start', justifyContent: 'flex-start',
          // Closed, the chips are still in the DOM so they can animate out;
          // they must not still be tappable.
          pointerEvents: chartsOpen && !expanded ? 'auto' : 'none',
        }}>
          {/* One flat list, so the wrap above decides the columns rather than
              this deciding them in advance. */}
          {CHARTS.map((c, i) => (
            <button key={c.key} className="chart-chip" onClick={() => toggleLayer(c.key)} style={{
              background: layers[c.key] ? 'var(--map-ink)' : 'var(--map-panel)',
              color: layers[c.key] ? 'var(--map-ink-invert)' : 'var(--map-ink)',
              border: 'none', borderRadius: 10, cursor: 'pointer',
              // One size for all of them. Sized to its own label, TFR came out
              // narrower than ARSP and the column read as a ragged edge rather
              // than a set of controls. flexShrink because a wrapping column
              // container will otherwise squash them to fit rather than wrap.
              width: CHIP_W, height: CHIP_H, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11.5, fontWeight: 700, letterSpacing: '0.4px',
              boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
              // Opening, each chip arrives a beat after the one after it, so the
              // stack unrolls back toward the layers button it came out of.
              // Closing runs the other way so it retracts into it. The stagger is
              // what makes it read as one object rather than a dozen things that
              // happened to move at once.
              animation: `${chartsOpen ? 'chipIn' : 'chipOut'} 220ms cubic-bezier(0.34,1.3,0.64,1) both`,
              animationDelay: chartsOpen
                ? `${(CHARTS.length - 1 - i) * 16}ms`
                : `${i * 14}ms`,
              transition: 'background 160ms, color 160ms',
            }}>{c.label}</button>
          ))}
        </div>
        </div>
      )}

      {/* The numbers, only once there are numbers. Before departure this card
          said 00:00 / 0 / 0.0, which is three lies dressed as instruments and
          a quarter of the screen spent saying nothing. It now arrives with the
          recording and leaves with it. */}
      <FloatingCard
        visible={recording && !planning}
        bottom={`calc(${collapsedPx}px + var(--safe-bottom) + 10px)`}>
        <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, color: 'var(--map-ink)', marginBottom: 12 }}>
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
      </FloatingCard>

      {/* The actions, while the flight plan has the drawer. Same card, same
          three buttons, moved onto the map so the plan is not paying for them
          with the top of its own space.

          Not at full screen: there is no map left to float over, and the plan
          is what the pilot asked to see all of. The row is a drag away, and
          the drawer's handle is right there. */}
      <FloatingCard
        visible={planning && snap === 'plan'}
        bottom={`calc(${Math.max(0, vh - Y_PLAN)}px + 10px)`}>
        {actionRow}
      </FloatingCard>

      {/* Traffic legend, and the selected aircraft. Present only while the
          layer is on, because a warning about data that is not on screen is
          noise, and absent once the sheet is expanded so it does not fight the
          logbook for the same space. */}
      {layers.traffic && !expanded && (
        <div style={{
          position: 'absolute', left: 14, zIndex: 520,
          bottom: `calc(${SHEET_COLLAPSED_PX}px + var(--safe-bottom) + ${recording ? 132 : 16}px)`,
          transition: 'bottom 280ms cubic-bezier(0.4,0,0.2,1)',
        }}>
          {selected ? (
            <SelectedAircraft ac={selected} onClose={() => setSelected(null)} />
          ) : (
            <TrafficLegend
              meta={traffic.meta}
              filter={tfcFilter}
              onFilter={setTfcFilter}
              lightCount={traffic.meta.lightCount}
              onClose={() => toggleLayer('traffic')} />
          )}
        </div>
      )}

      {basePicker && createPortal(
        <AirportPickerModal
          onConfirm={(id) => { setBasePicker(false); changeBase(id) }}
          onClose={() => setBasePicker(false)} />,
        document.body,
      )}

      {/* The sheet. Collapsed it is the actions; dragged up it is the rest of
          the app; and while a flight is being planned it is the flight plan,
          resting at half the screen so the map stays in view above it. Resting
          heights and nothing in between, because a control surface that stops
          wherever the finger left it is a surface you have to aim at. */}
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
        background: 'var(--map-panel)', backdropFilter: 'blur(20px)',
        borderRadius: `${radius}px ${radius}px 0 0`,
        boxShadow: '0 -4px 24px rgba(0,0,0,0.10)',
        display: 'flex', flexDirection: 'column',
        pointerEvents: sheetOpen ? 'auto' : 'none',
        // Squares off against the device's own corners at full screen, and
        // keeps the rounded corners from clipping the list while it slides.
        overflow: 'hidden',
      }}>

      {/* The part of the sheet that is actually on the screen.
          The sheet itself is always a full screen tall and is moved down out
          of the way, so anything told to fill it fills a box whose bottom half
          is below the phone. The list never minded, because it scrolls and its
          end is meant to be out of sight. The planner minds a great deal: its
          tab bar sits at the bottom of its column, and that bottom was landing
          somewhere under the home indicator where nobody could reach it.
          Bounding the column to the visible height puts it back on the screen.

          Sized from the resting position rather than the live drag, so a
          finger on the handle moves the sheet without relaying out the whole
          flight plan sixty times a second. The cost is a strip of empty sheet
          below the content while a drag is heading upward, which is gone the
          moment it lands. */}
      <div style={{
        display: 'flex', flexDirection: 'column', minHeight: 0,
        height: (planning || confirmRoute) ? `${Math.max(0, vh - restY)}px` : '100%',
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
          <div
            onClick={() => {
              // While planning, the handle toggles between the two stops the
              // planner has rather than the two the drawer normally has.
              if (planning) { setSnap(s2 => (s2 === 'plan' ? 'full' : 'plan')); return }
              setSnap(s2 => (s2 === 'collapsed' ? 'expanded' : 'collapsed'))
            }}
            style={{
              width: 40, height: 5, borderRadius: 3, background: 'var(--map-hairline)',
              margin: (planning || confirmRoute) ? '0 auto 8px' : '0 auto 14px', cursor: 'pointer',
            }} />

          {/* Weather, opposite the route planner. These are the two things a
              pilot does before a flight, so they flank the one thing they do
              during it. The aircraft keeps its place in the tools grid below;
              it is set once and rarely changed, which is not what a slot on
              the main surface is for.

              Gone from here entirely while the plan is open: it is on the card
              floating over the map instead, and the drawer below is the plan
              and nothing else. Same row, same buttons, one place at a time. */}
          {!planning && actionRow}

          {/* The route, once there is one: what was planned, in the numbers a
              pilot reads off a flight plan, and an X to be rid of it. Sits
              above the actions rather than replacing them, so the record
              button stays where the hand expects it. It is, after all, the
              route you are about to fly.

              Not while the plan is open, where the route is the thing being
              edited a few pixels below and a second copy of its numbers would
              be one more thing to keep in agreement. */}
          {/* Not while confirming: the panel below is the same route, read
              back larger, and two copies of one flight in one drawer invites
              the question of which one is current. */}
          {!planning && !confirmRoute && route && (
            <RouteSummary route={route} onClear={clearRoute} onEdit={openPlanner} />
          )}

          {/* No hint line while planning. It is the drawer explaining itself,
              and the plan needs the height more than it needs the sentence
              now that Close Plan says out loud what the gesture used to. */}
          {/* Only the lines about the gesture live here, under the thing the
              gesture acts on. The reference-aid notice used to take this slot
              at full screen, which put a standing disclaimer in the one place
              reserved for telling the pilot what to do next. It now sits at
              the bottom of the list, where a footnote belongs. */}
          {!planning && gestureHint && (
          <div style={{ textAlign: 'center', margin: '10px 0 6px', fontSize: 10, color: 'var(--map-ink-faint)' }}>
            {gestureHint}
          </div>
          )}
        </div>

        {/* The flight plan itself, filling what is left of the drawer. Mounted
            only while planning, so leaving it is what unmounts the megabyte of
            planner and its Leaflet previews rather than leaving them running
            under a map that is already drawing one. */}
        {planning && (
          <div
            onPointerDown={onBodyDragStart} onPointerMove={onDragMove}
            onPointerUp={onDragEnd} onPointerCancel={onDragEnd}
            style={{
              flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
              // Half open, the plan is dragged rather than read: a finger
              // anywhere on it takes the drawer to full screen, which is the
              // only way up other than the handle, and the handle is a target
              // the size of a fingernail. pan-x keeps the sideways swipe
              // between sections while taking vertical away from the browser,
              // because a native scroll and a sheet drag cannot both have it.
              //
              // Full screen it hands vertical back, so the plan scrolls the way
              // any long page does, and only a pull down from the very top
              // returns the drawer. The drawer's own list has always worked
              // this way; this is the same bargain, kept in the same words.
              touchAction: snap === 'full' ? 'pan-y' : 'pan-x',
            }}>
            <Suspense fallback={
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, color: 'var(--map-ink-faint)' }}>
                Opening the flight plan…
              </div>
            }>
              <Planner embedded onClose={leavePlanner} onRouteCalculated={onRouteCalculated} />
            </Suspense>
          </div>
        )}

        {/* Everything else. Scrolls inside the sheet once expanded; inert while
            collapsed so a swipe there moves the sheet instead of the list.
            Gone entirely while planning, where the plan itself is what fills
            the drawer and carries the same handlers. */}
        {/* The route, filling the drawer to be checked before it is flown.
            A destination chosen by tapping a chart is the one most easily
            picked by accident, so it is read back at a size worth reading
            rather than tucked into the summary strip. */}
        {!planning && confirmRoute && (
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 20px 20px' }}>
            {route?.distNm == null ? (
              <div style={{ fontSize: 12.5, color: 'var(--map-ink-dim)', padding: '10px 0' }}>
                Working out the route&#8230;
              </div>
            ) : (<>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.6px',
                color: 'var(--map-ink-faint)', textTransform: 'uppercase' }}>
                Confirm the flight
              </div>
              <div style={{ marginTop: 10, fontSize: 20, fontWeight: 800, letterSpacing: '-0.4px',
                color: 'var(--map-ink)', lineHeight: 1.3, wordBreak: 'break-word' }}>
                {route.dep} <span style={{ color: 'var(--map-ink-faint)' }}>&#8594;</span> {route.dest}
              </div>
              <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {[
                  [`${route.distNm} NM`, 'DISTANCE'],
                  [`${route.mc}\u00B0`, 'MAGNETIC COURSE'],
                  [`${route.tc}\u00B0`, 'TRUE COURSE'],
                  [`${route.magVar > 0 ? '+' : ''}${route.magVar}\u00B0`, 'VARIATION'],
                ].map(([v, l]) => (
                  <div key={l}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--map-ink)',
                      letterSpacing: '-0.5px', fontVariantNumeric: 'tabular-nums' }}>{v}</div>
                    <div style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--map-ink-faint)',
                      letterSpacing: '0.4px', marginTop: 2 }}>{l}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 18, fontSize: 11.5, color: 'var(--map-ink-dim)', lineHeight: 1.45 }}>
                A straight line from the departure. It does not account for
                airspace, terrain or wind. Open the plan to work those.
              </div>
              <button onClick={() => { setConfirmRoute(false); setSnap('collapsed') }} style={{
                marginTop: 18, width: '100%', padding: '13px 0', borderRadius: 12, border: 'none',
                background: ACCENT, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}>Looks right</button>
              <button onClick={() => { setConfirmRoute(false); openPlanner() }} style={{
                marginTop: 8, width: '100%', padding: '13px 0', borderRadius: 12, border: 'none',
                background: 'var(--map-fill)', color: 'var(--map-ink)', fontSize: 14,
                fontWeight: 700, cursor: 'pointer',
              }}>Open the plan</button>
            </>)}
          </div>
        )}

        {!planning && !confirmRoute && (
        <div
          onPointerDown={onBodyDragStart} onPointerMove={onDragMove}
          onPointerUp={onDragEnd} onPointerCancel={onDragEnd}
          style={{
          flex: 1, minHeight: 0,
          // Scrolls only once the sheet is at full height. Below that there is
          // more sheet to open than list to read, so the gesture belongs to
          // the sheet and a scroller here would swallow it.
          overflowY: snap === 'full' ? 'auto' : 'hidden',
          touchAction: snap === 'full' ? 'pan-y' : 'none',
          WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain',
          padding: '6px 18px calc(var(--safe-bottom) + 24px)',
          opacity: expanded ? 1 : 0,
          transition: 'opacity 200ms ease-out',
          pointerEvents: expanded ? 'auto' : 'none',
        }}>
          {/* The pilot's aircraft, on the sheet rather than in a box on it.
              A card draws a frame around a photograph and makes it an item in
              a list; without one the aircraft simply IS the top of the drawer,
              which is the Strava move: the thing that is yours gets the room,
              and the chrome gets out of its way.

              The performance figures are gone. They belong on the Aircraft
              screen, where a pilot goes to read them; here they turned a
              portrait into a spec sheet. */}
          {/* Straight to this aircraft's own screen, not the hangar list.
              Tapping a picture of your helicopter and landing on a shelf of
              aircraft is an extra tap to get where you obviously meant. With
              no aircraft set there is nothing to open, so it falls back to the
              hangar, which is where you would add one. */}
          <button onClick={() => navigate(ac?.id ? `/aircraft/${ac.id}` : '/aircraft')} style={{
            display: 'block', width: '100%', textAlign: 'left', padding: 0,
            marginBottom: 20, border: 'none', background: 'none', cursor: 'pointer',
          }}>
            {ac?.image ? (
              <img src={ac.image} alt="" style={{
                display: 'block', width: '100%', maxHeight: 210,
                objectFit: 'contain', marginBottom: 10,
              }} />
            ) : (
              // A custom aircraft is saved with no photograph, and its name is
              // whatever the pilot typed, so it matches no template. That is a
              // legitimate aircraft, not a broken one: it gets a silhouette of
              // the right kind rather than a gap where the picture should be.
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                height: 150, marginBottom: 10,
              }}>
                <img
                  src={isHelicopter ? '/helicopter.png' : '/modo-avion.png'}
                  alt=""
                  style={{
                    width: 96, height: 96, objectFit: 'contain', opacity: 0.22,
                    filter: 'var(--icon-filter)',
                  }} />
              </div>
            )}
            <div style={{
              fontSize: 26, fontWeight: 800, color: 'var(--map-ink)',
              letterSpacing: '-0.7px', lineHeight: 1.1,
            }}>
              {ac?.fullName || 'No aircraft set'}
            </div>
            {ac?.registration && (
              // The registration is the aircraft's name in the way a pilot
              // uses it on the radio, so it is set apart from the type rather
              // than run on from it.
              <div style={{
                fontSize: 13, fontWeight: 700, letterSpacing: '2px',
                color: 'var(--map-ink-faint)', marginTop: 6,
                textTransform: 'uppercase',
              }}>{ac.registration}</div>
            )}
          </button>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {TOOLS.map(t => (
              <button key={t.to} onClick={() => navigate(t.to)} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '14px 14px',
                background: 'var(--map-fill-soft)', border: 'none', borderRadius: 16,
                cursor: 'pointer', textAlign: 'left',
              }}>
                <img src={t.icon} width={24} height={24} alt="" style={{ objectFit: 'contain', flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--map-ink)', lineHeight: 1.25 }}>{t.label}</span>
              </button>
            ))}
          </div>

          <div style={{ marginTop: 22, fontSize: 11, fontWeight: 700, letterSpacing: '0.6px',
            color: 'var(--map-ink-faint)', textTransform: 'uppercase' }}>
            {snap === 'full' ? `Logbook · ${flights.length}` : 'Recent flights'}
          </div>
          {flights.length === 0 ? (
            <div style={{ marginTop: 10, padding: '22px 16px', borderRadius: 16,
              background: 'var(--map-fill-soft)', textAlign: 'center' }}>
              <div style={{ fontSize: 13, color: 'var(--map-ink-dim)' }}>No flights logged yet</div>
              <div style={{ fontSize: 11.5, color: 'var(--map-ink-faint)', marginTop: 4 }}>
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

          {/* The standing notice, at the foot of everything rather than under
              the buttons. It is a footnote, not an instruction: it is true all
              the time, so it belongs where a pilot arrives at the end of the
              drawer, not in the line that tells them what to do next. */}
          <div style={{
            textAlign: 'center', margin: '26px 0 4px', fontSize: 10,
            color: 'var(--map-ink-faint)',
          }}>
            Reference aid only · Always consult current FAR/AIM
          </div>
        </div>
        )}
      </div>
      </div>

    </div>
  )
}
