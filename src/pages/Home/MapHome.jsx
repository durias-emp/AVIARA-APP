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
import { ACCENT, accentAlpha } from '../../components/mapStyle'
import ActivityCard from '../../components/ActivityCard'
import RouteChips from '../../components/RouteChips'
import FlightRulesRow from '../../components/FlightRulesRow'
import RouteLineEditor from '../../components/RouteLineEditor'
import Map3DPane from '../../components/Map3DPane'
import AirportPlate from '../../components/AirportPlate'
import { DRAWER_PALETTE } from '../../components/drawerPalette'
import { useBackOverride } from '../../context/BackOverride'
import { HomeLocationProvider, useHomeLocation } from '../../context/HomeLocation'
import { useBreadcrumbTrail } from '../../hooks/useBreadcrumbTrail'
import GpsInfoBar from '../../components/GpsInfoBar'
import AircraftPanel from '../../components/AircraftPanel'
import {
  AirportsHeroCard, HangarCard, PilotRow, FlightPlanCard, DiscoverCard, ROW_GAP,
} from '../../components/HomeRows'
import { getCurrencyStatus } from '../../lib/currency'
import {
  useFlightDetector, DEFAULT_AUTO_DETECT_CONFIG, AUTO_DETECT_DEFAULT_ENABLED, autoDetectEnabledFrom,
} from '../../hooks/useFlightDetector'
import { useWakeLock } from '../../hooks/useWakeLock'
import { useLogbook } from '../../context/Logbook'
import { useLiveShare } from '../../hooks/useLiveShare'
import { useFriendsAloft } from '../../hooks/useFriendsAloft'
import { liveSharingAvailable } from '../../lib/livePositions'
import {
  HOME_ACTIONS, HOME_ACTIONS_KEY, DEFAULT_HOME_ACTIONS, findAction, normaliseActions,
} from '../../lib/homeActions'
import {
  IconRunways as RowIconRunways, IconRoute as RowIconRoute, IconFriends as RowIconFriends,
  IconHangar as RowIconHangar, IconHelmet as RowIconHelmet, IconGear as RowIconGear,
} from '../../components/Icons'
import { useRegion } from '../../context/Region'
import { useFlightPlanType } from '../../hooks/useFlightPlanType'
import { fmtEte, etaFrom, reserveMinutes, requiredReserveMinutes, reserveStatus } from '../../lib/routeFigures'
import TrafficLayer from '../../components/TrafficLayer'
import TrafficLegend from '../../components/TrafficLegend'
import useLiveTraffic from '../../hooks/useLiveTraffic'
import { CATEGORY_LABEL } from '../../components/trafficBands'
import AirportPickerModal from '../../components/AirportPickerModal'
import { createPortal } from 'react-dom'
import WeatherRibbon from '../../components/WeatherRibbon'
import { createRecorder, toFlightRecord, fmtClock } from '../../lib/flightRecorder'
import { put, get, getAll, del } from '../../lib/db'
import { findAirport, getAirports } from '../../lib/aerodromes'
import { crossTrackNm } from '../../lib/corridor'
import { resolveHomeIdent, setHomeIdent } from '../../lib/homeBase'
import { computeDirectRoute } from '../../lib/directRoute'
import { loadTfrs } from '../../lib/tfr'
import useIsDark from '../../hooks/useIsDark'
import { TEMPLATES } from '../../data/aircraftTemplates'
import { useActiveAircraft } from '../../context/ActiveAircraft'
import { scopedSettingsKey } from '../../lib/aircraft'
import { num } from '../../lib/climbPerf'
import { bearingDeg, haversineNm } from '../../lib/geo'
import {
  SHEET_STOPS, DRAG_SLOP,
  stopY, isFlick, isFullPull, flickTarget, nearestStop, radiusFor,
} from '../../lib/sheet'
import useStopAudit from '../../hooks/useStopAudit'

// The flight plan, loaded only when it is asked for. Same specifier App.jsx
// lazy-loads and the same one the idle warm-up below fetches, so all three
// share one chunk rather than making three copies of a megabyte and a half.
const Planner = lazy(() => import('../Checklists/Checklists'))
// The FAA airport diagram, rendered from the PDF the pilot asked for. Lazy
// because it drags in the PDF renderer, and most sessions never open a chart.
const ProcedureChartViewer = lazy(() => import('../../components/ProcedureChartViewer'))

// The screens the drawer can carry.
//
// Each of these used to be a route: tapping Calculators left the map, took the
// whole screen, and coming back meant a navigation. They are the same
// components, mounted in the drawer instead, at whatever height the drawer is
// already at. Nothing about them changed to make that work; they were already
// plain flow content under their own headers, and the drawer's palette is
// applied on the wrapper (see drawerPalette.js).
//
// Lazy, individually, because a pilot who never opens Settings should never
// download it. The routes in App.jsx stay: a shared link to /calc still works,
// and the standalone screens are what /checklists is to the planner.
const DRAWER_VIEWS = {
  calc:      lazy(() => import('../Calculators/Calculators')),
  pilot:     lazy(() => import('../Pilot/Pilot')),
  reference: lazy(() => import('../Reference/Reference')),
  airports:  lazy(() => import('../../components/AirportInfo')),
  tools:     lazy(() => import('../../components/ToolsMenu')),
  settings:  lazy(() => import('../Settings/Settings')),
  // The three the reporting rows need. Hangar and the flight plan had doors
  // elsewhere on this screen (the aircraft card, Plan Route); Discover had
  // none at all, so the entire social half of the app was reachable only by
  // someone opening a shared link.
  hangar:    lazy(() => import('../Aircraft/Hangar')),
  flight:    lazy(() => import('../Checklists/Checklists')),
  discover:  lazy(() => import('../Discover/Discover')),
}

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

// The floating action row's own height, measured once from the built card
// rather than recomputed: it is one row of round buttons in a padded panel,
// and its only reader is the height cap on the card at the top of the screen.
const ACTION_ROW_H = 66

// The one row at the top of that card, the flight category and the code,
// which is there whatever is open below it. Measured: 36.
const TOP_CARD_HEADER_H = 38

// The tallest a column of chips may get before the next one starts.
//
// Without this the chips simply fill whatever height is available, so a tall
// phone gave a column of nine beside a column of three: it fits, but it reads
// as a mistake. Half the set, rounded up, so the common case is two columns
// however many chips there are: at thirteen (twelve charts and the 3D door)
// that is seven, and six was quietly spilling the thirteenth into a third
// column. On a short window the height limit bites first and the wrap
// balances them itself, which is the one case allowed to beat two columns,
// because a chip pushed off the screen is worse than a third column.
const CHIP_COL_MAX = 7
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

// Where the drawer can rest, what a gesture means, and how square its corners
// are, all of which now live in src/lib/sheet.js. They were here, private to
// this screen, which is how the app came to have four other sheets at four
// different heights and no stops at all. See that file for why the ladder has
// four rungs and why 25 is the resting one.

// An element's height, kept current.
//
// A callback ref rather than an effect, so the observer attaches exactly when
// the element does and leaves when it goes. The elements this measures come
// and go with the drawer's contents, and an effect would have to either list
// them as dependencies (it cannot: they are refs) or re-attach on every
// render, which is the shape lint rightly complains about.
function useMeasuredHeight() {
  const [h, setH] = useState(0)
  const observer = useRef(null)
  const ref = useCallback((node) => {
    observer.current?.disconnect()
    observer.current = null
    if (!node || typeof ResizeObserver === 'undefined') return
    const read = () => setH(Math.round(node.getBoundingClientRect().height))
    read()
    observer.current = new ResizeObserver(read)
    observer.current.observe(node)
  }, [])
  return [h, ref]
}

// The drawer body's own top padding, and the gap under the aircraft's
// photograph. Named because the image's height is worked out from the space
// left over, and that arithmetic has to agree with the styles below or the
// picture is sized against a box it is not in.
const BODY_PAD_TOP = 6
const AC_IMG_GAP = 10
// What sits above the route block inside the drawer's grab area: its top
// padding, the handle, and the handle's margin. Named because the route block
// is stretched to the foot of the resting stop and that arithmetic has to
// agree with the styles, or it fills to the wrong line.
const GRAB_ABOVE_ROUTE = 29
// The room kept clear at the bottom for the hint. Measured, not guessed: the
// line is 16px tall and sits 4px above the safe-area inset, so its top is 20
// above it, and the rest is gap. Guessing 11px for its height is what let it
// overlap VARIATION on the phone while the desktop, where the inset is zero,
// looked fine.
const HINT_RESERVE = 28

// A little air under the registration. Without it the arithmetic is exact and
// the text ends on the last pixel of the screen, which is technically not cut
// and still reads as cut.
const AC_BREATHING = 10


// Everything else the app does. The map home would otherwise be a dead end:
// these are the screens the old menu-style home listed, and they keep their
// icons so nothing has to be relearned.
// `view` is the key into DRAWER_VIEWS. These open in the drawer, at the height
// the drawer is already at, rather than navigating away from the map.
// Pilot and Airports are no longer here: they became reporting rows above,
// which is the whole point of the rows. Listing them in both places would
// teach two doors to one room and make the grid look fuller than it is, the
// same reason Flight Planning was never in this list.
const TOOLS = [
  { view: 'calc',      icon: '/E6B CALC.svg',   label: 'Calculators' },
  { view: 'reference', icon: '/libros.png',     label: 'Quick Reference' },
  { view: 'tools',     icon: '/filtrar.png',    label: 'Tools' },
  // Placeholder icon: the project has no gear, and main drew these two as
  // inline SVG rather than PNG. Worth replacing when these screens are
  // restyled, along with the filter standing in for Tools.
  { view: 'settings',  icon: '/llaves.png',     label: 'Settings' },
]

// The card the map wears: floating above the drawer, panel glass, one radius
// and one shadow. The recording stats introduced this shape and the actions
// borrow it verbatim while the flight plan has the drawer, so the two read as
// one object in two states rather than as two designs that happen to be near
// each other. It animates in from below rather than appearing, which is what
// makes it read as arriving rather than as something that was always there
// and had been missed.
// compact takes the airport pill's proportions: hugging its contents rather
// than spanning the screen, tighter corners, a lighter shadow. The pill and
// this then read as a matched pair at the top and bottom of the map, and the
// map either side of it comes back instead of being covered by card holding
// nothing.
function FloatingCard({ visible, bottom, compact = false, children }) {
  return (
    <div style={{
      position: 'absolute', zIndex: 550, bottom,
      ...(compact
        ? { left: 0, right: 0, display: 'flex', justifyContent: 'center' }
        : { left: 12, right: 12 }),
      transform: visible ? 'translateY(0) scale(1)' : 'translateY(16px) scale(0.97)',
      opacity: visible ? 1 : 0,
      pointerEvents: visible ? 'auto' : 'none',
      transition: 'opacity 260ms ease-out, transform 260ms cubic-bezier(0.34,1.2,0.64,1), bottom 380ms cubic-bezier(0.32,0.72,0,1)',
    }}>
      <div style={{
        background: 'var(--map-panel)',
        backdropFilter: compact ? 'blur(14px)' : 'blur(20px)',
        borderRadius: compact ? 16 : 18,
        padding: compact ? '9px 14px' : '16px 18px',
        boxShadow: compact ? '0 2px 10px rgba(0,0,0,0.18)' : '0 4px 20px rgba(0,0,0,0.12)',
        ...(compact ? { width: 'fit-content', maxWidth: 'calc(100vw - 24px)' } : null),
      }}>
        {children}
      </div>
    </div>
  )
}

// The route, once there is one, on the drawer.
//
// On it, not in a box on it. It used to be a filled card with 13px figures
// inside a drawer that is itself a card, which is a frame around a frame: it
// read as an item in a list rather than as what the drawer is currently about.
// The aircraft below already makes this argument and wins it. Same move here.
//
// The two ends are a boarding pass: the code big enough to read across a
// cockpit, the position under it in small type so it plainly belongs to that
// end rather than floating between them, and the aircraft flying between the
// two. It is a form every passenger already knows how to read, which is worth
// more here than novelty.
//
// The figures live to the right, one to a line with a mark of its own. The
// marks are the chart's rather than decoration: true north is a star and
// magnetic north is a needle on every declination diagram printed on a
// sectional, and variation is drawn as the angle between them, which is what
// it is. A pilot reads which is which without reading the words, and that is
// what lets the words stay short.
//
// There is no clear button. Putting a route away is rare, the arrow at the top
// of the map takes the whole drawer out of the way, and Reset in the plan is
// where a route is actually discarded. A destructive control sitting beside
// the numbers earned its place only while there was nowhere else for it.
// The route on the drawer: every point of it, as chips.
//
// It used to be the two ends as a boarding pass, which was honest about where
// the flight begins and ends and silent about everything in between. On
// KDFW ARDIA7 ELLVR KIDDZ5 KHOU that is three quarters of the route missing
// from the one card that claims to describe it, and the pilot had to open the
// plan to find out what the line on the map was actually made of.
//
// Chips rather than a line of text because they are the same object the
// fullscreen map puts above its own readout, and because a point you can see
// is a point you can take out.
// The figures for a route whose shape has just changed, worked out here.
//
// Editing the route used to delete them and leave the card saying "open the
// plan to work out the new distance and course". That was the honest answer
// while nothing here could do the arithmetic, and it is the wrong answer now,
// because all three are exactly computable without asking anything:
//
//   distance   the sum of the legs, plain great-circle
//   true course the bearing of the FIRST leg, which is what the planner stores
//   variation  UNCHANGED. The planner reads it from NOAA at the midpoint of
//              departure and destination, and neither of those moves when a
//              turning point is added between them, so the number still stands
//
// Which makes the magnetic course exact too, since it is only true course less
// variation. Same formulas as RouteAltitude's own calculation, so the card and
// the planner cannot produce two different answers for one route.
//
// needsRecalc still rides along: the planner recomputes airways, procedures
// and the filed string, none of which this pretends to know.
function recomputeFigures(prev, wpts) {
  const chain = [
    prev?.depPos,
    ...(wpts ?? []).filter(w => w?.lat != null && w?.lon != null).map(w => [w.lat, w.lon]),
    prev?.destPos,
  ]
  if (!chain[0] || !chain[chain.length - 1]) return {}
  let dist = 0
  for (let i = 0; i < chain.length - 1; i++) {
    dist += haversineNm(chain[i][0], chain[i][1], chain[i + 1][0], chain[i + 1][1])
  }
  const tc = bearingDeg(chain[0][0], chain[0][1], chain[1][0], chain[1][1])
  const magVar = parseFloat(prev?.magVar)
  const out = { distNm: Math.round(dist), tc: Math.round(tc) }
  if (Number.isFinite(magVar)) out.mc = Math.round(((tc - magVar) + 360) % 360)
  return out
}

// Hours as a pilot writes them, 1:24 rather than 1.4, moved to
// lib/routeFigures.js as fmtEte when the plan and the drawer started needing
// the same six figures and could not be allowed to format them differently.

function RouteSummary({ route, flight, onOpen, onRemoveLeg, onRemoveEnd, onReorder, onAddStop, onFocusPoint, fillTo = 0 }) {

  // The word first and the number under it, left aligned, which is how a
  // flight plan prints a row of figures and how ForeFlight lays this same
  // strip out. The icons went with the change: at this size they were
  // decoration competing with the number they sat beside, and the word says
  // it better than a mark that has to be learned.
  // tone: 'warn' for legal but thin, 'alarm' for short of the minimum. Only
  // reserve ever passes one, and it is the only figure here entitled to: the
  // rest are measurements, and a measurement has no opinion.
  //
  // note: a second, smaller line under the value, for the figure that needs a
  // number to be read against. Reserve without its minimum is a quantity;
  // reserve against 30 is an answer.
  const TONE = { warn: '#FF9500', alarm: '#FF3B30' }
  const figure = ({ value, label, dim, placeholder, tone, note }) => (
    <div key={label} style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, minWidth: 0,
    }}>
      <span style={{
        // The whole word. These were cut to MC and VAR back when the figures
        // shared a row with the two ends and each had a quarter of a phone to
        // live in; they have the full width now, and a label a pilot has to
        // expand in their head is not a label.
        //
        // Sized off the viewport so the four words fit the width they are
        // spread across: a fixed size that fits MAGNETIC COURSE on a 430px
        // phone wraps it on a 320px one.
        fontSize: 'clamp(8px, 2.5vw, 10px)',
        fontWeight: 600, color: 'var(--map-ink-faint)',
        letterSpacing: '0.4px', textTransform: 'uppercase',
        // Wraps rather than truncating or spilling. Two short lines of a
        // whole word beat one line of MAG.
        //
        // Two lines' worth of space whether or not the word needs both, so
        // the four numbers sit on one baseline. Without it MAGNETIC COURSE
        // pushed its own figure down and the row read as broken rather than
        // as one word being longer than the others.
        //
        // Top aligned, so every label STARTS at the same height. Pushed to the
        // bottom of that space instead, a one-line word sat a line lower than
        // MAGNETIC COURSE's first line, and four headings at two different
        // heights do not read as one row however well the numbers line up.
        lineHeight: 1.15, minHeight: '2.3em', textAlign: 'center',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      }}>{label}</span>
      <span style={{
        // A figure with nothing behind it is a word, not a number, so it drops
        // to a size a word fits in. At the numeral size "Not set" runs past its
        // column and shoulders the one beside it.
        fontSize: placeholder ? 'clamp(11px, 3.2vw, 13px)' : 'clamp(17px, 5.4vw, 22px)',
        fontWeight: placeholder ? 600 : 800,
        lineHeight: placeholder ? 2 : 1.1, letterSpacing: '-0.3px',
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
        color: tone ? TONE[tone]
          : placeholder ? 'var(--map-ink-faint)'
          : dim ? 'var(--map-ink-dim)' : 'var(--map-ink)',
      }}>{value}</span>
      {note && (
        <span style={{
          fontSize: 'clamp(8px, 2.3vw, 9.5px)', fontWeight: 600, lineHeight: 1,
          color: tone ? TONE[tone] : 'var(--map-ink-faint)',
          fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
        }}>{note}</span>
      )}
    </div>
  )

  // Only what survives an edit. Removing a point drops the planner's figures
  // in the same write, because they describe the route as it was a moment ago
  // and a distance that no longer matches the line is worse than no distance:
  // it is a wrong number wearing the planner's authority.
  const hasFigures = route.distNm != null

  return (
    <div style={{
      marginTop: 10, position: 'relative',
      display: 'flex', flexDirection: 'column',
      // Stacked, not spread. Pushed to the ends of the resting stop the field
      // and its figures had a hand's width of nothing between them and read
      // as two cards that happened to share a drawer. They are one thing: the
      // route, and the numbers that describe it. Any height the stop has left
      // over falls below them rather than between.
      justifyContent: 'flex-start', gap: 14,
      minHeight: fillTo || undefined,
    }}>
      <RouteChips
        route={route}
        onRemoveLeg={onRemoveLeg}
        onRemoveEnd={onRemoveEnd}
        onReorder={onReorder}
        onAddStop={onAddStop}
        onFocusPoint={onFocusPoint} />

      {/* The figures, on the floor of the drawer. The two ends used to hold
          this space with their coordinates; the chips above are shorter, so
          these sit at the bottom rather than following immediately under. */}
      {hasFigures && (
        <div style={{
          position: 'relative', zIndex: 1,
          // The same width as the field above, so the two read as one column
          // of the same card.
          //
          // Six figures, three columns, two rows. It was eight in four columns,
          // and three of those eight were one fact: true course minus variation
          // IS magnetic course. See lib/routeFigures.js for why each of the
          // three that went, went, and why fuel aboard became reserve.
          //
          // Three columns rather than four gives each label room to sit on one
          // line, which four never did: MAGNETIC COURSE wrapped, and the row
          // had to reserve two lines of label height for every column to keep
          // the numbers on one baseline.
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          // Centred in its own column, not parked at the column's left edge.
          // The tracks already spanned the drawer, but each figure sat at the
          // start of a track wide enough for the longest label, so on a wide
          // screen they huddled left with the last one ending short of the
          // card. Centred, they read as spaced across the drawer at every
          // width, which is what the eye is measuring.
          justifyItems: 'center',
          alignItems: 'flex-start', gap: '12px 10px',
        }}>
          {/* Row one: the flight as flown. Distance is the sanity check the
              other five are measured against, then the two times. */}
          {figure({
            label: 'Distance',
            value: `${route.distNm} NM`,
          })}
          {figure({
            label: 'ETE',
            value: fmtEte(flight?.hours) ?? 'No aircraft',
            placeholder: fmtEte(flight?.hours) == null,
          })}
          {/* Clock time, and it says which clock. Without a departure time in
              the plan the only honest reading is "if you left now", so that is
              what it says rather than presenting a guess as a filed arrival.
              A landing after midnight carries its own +1. */}
          {figure({
            label: flight?.eta?.assumedNow ? 'ETA if now' : 'ETA',
            value: flight?.eta
              ? `${flight.eta.text}${flight.eta.nextDay ? ' +1' : ''}`
              : 'No aircraft',
            placeholder: !flight?.eta,
            dim: flight?.eta?.assumedNow,
          })}

          {/* Row two: whether the flight goes. Fuel required, what is left
              when it lands, and the altitude it is planned at. */}
          {figure({
            label: 'Fuel req',
            value: flight?.tripFuel != null ? `${flight.tripFuel.toFixed(1)} gal` : 'No aircraft',
            placeholder: flight?.tripFuel == null,
          })}
          {/* The go/no-go, and the only figure here that is allowed to shout.
              Minutes rather than gallons because minutes is the unit 91.151 is
              written in, and short of the legal minimum is not a styling
              choice: it is the answer the whole plan exists to produce. */}
          {(() => {
            const min = flight?.reserveMin
            const status = reserveStatus(min, flight?.reqReserveMin)
            return figure({
              label: 'Reserve',
              value: min == null ? 'No aircraft'
                : min < 0 ? 'Short'
                : `${Math.floor(min / 60) ? `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}` : `${min} min`}`,
              placeholder: min == null,
              tone: status === 'short' ? 'alarm' : status === 'thin' ? 'warn' : undefined,
              note: flight?.reqReserveMin != null ? `min ${flight.reqReserveMin}` : null,
            })
          })()}
          {/* Never a number until the pilot has chosen one. Zero is not a
              neutral placeholder here, it is sea level, and a flight plan that
              says it cruises at 0 ft is a claim rather than a blank. "Not set"
              says the same thing without asserting an altitude. */}
          {figure({
            label: 'Cruise alt', dim: true,
            value: flight?.altFt != null ? `${flight.altFt.toLocaleString()} ft` : 'Not set',
            placeholder: flight?.altFt == null,
          })}
        </div>
      )}

      {/* The caveat line that used to sit here is gone at the owner's call: it
          was a third row of grey type under a card whose job is to be read at a
          glance. What it said still holds, so the words carry it instead. TRIP
          FUEL is the standing term for fuel to destination WITHOUT reserves,
          and Cruise & Fuel in the plan is where the reserve, the wind and the
          go/no-go are actually worked out. */}

      {/* Said only when it is true. A route mid-edit has no figures, and an
          empty strip where they were is a question rather than an answer. */}
      {!hasFigures && (
        <div style={{ position: 'relative', zIndex: 1, fontSize: 11, color: 'var(--map-ink-faint)' }}>
          Open the plan to work out the new distance and course
        </div>
      )}

      {/* One target over the whole thing rather than several, so a tap
          anywhere on the route opens the plan and nothing here has to be
          aimed at. Under the chips, so their own buttons win. */}
      <button
        // Called with no arguments on purpose. Wired straight to onOpen, the
        // click event arrived as openPlanner's `at`, so setSnap was handed a
        // React event instead of 50 and the drawer never moved to the plan's
        // stop: the plan opened behind a sheet still resting at 25.
        onClick={() => onOpen?.()}
        aria-label="Open the flight plan"
        style={{
          position: 'absolute', inset: 0, background: 'none', border: 'none',
          padding: 0, cursor: 'pointer', zIndex: 0,
        }} />
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
  // No card of its own: it is rendered inside the same floating card the
  // traffic strip is, and a panel within a panel is what made the traffic
  // legend read as bolted on before it moved here.
  return (
    <div>
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
// `caption` rides in the badge's corner and says what a staged button is
// currently doing. The badge counts things and the caption names a mode, so
// they share the shape without sharing the meaning; nothing uses both.
function Ctrl({ onClick, title, active, badge, caption, children, size = CTRL }) {
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
      {caption && (
        <span style={{
          position: 'absolute', bottom: -6, left: '50%', transform: 'translateX(-50%)',
          borderRadius: 8, background: 'var(--map-ink)', color: 'var(--map-ink-invert)',
          fontSize: 9, fontWeight: 800, letterSpacing: '0.02em', lineHeight: 1,
          padding: '3px 5px', border: '2px solid #fff', whiteSpace: 'nowrap',
        }}>{caption}</span>
      )}
    </button>
  )
}

const IconLayers = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round">
    <path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" strokeLinecap="round" />
  </svg>
)
// Two figures, for the control that says whether other people can see you.
const IconFriendsCtrl = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
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
// What the assignable actions wear in the row. The doors reuse the same glyphs
// their rows use, so a button and the row it opens are recognisably the same
// thing; the two that have no row keep the sheet's own PNGs.
const ACTION_ICONS = {
  airports:  <RowIconRunways size={24} />,
  flight:    <RowIconRoute size={24} />,
  discover:  <RowIconFriends size={24} />,
  hangar:    <RowIconHangar size={24} />,
  pilot:     <RowIconHelmet size={24} />,
  settings:  <RowIconGear size={24} />,
  calc:      <img src="/E6B CALC.svg" width={24} height={24} alt=""
    style={{ objectFit: 'contain', filter: 'var(--map-icon-ink)' }} />,
  reference: <img src="/libros.png" width={24} height={24} alt=""
    style={{ objectFit: 'contain', filter: 'var(--map-icon-ink)' }} />,
}

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
    // Dev only, and the same handle the planner's map already exposes. The map
    // is a fixed box behind a drawer, so there is no way to drive it to a given
    // aerodrome from a test harness without one, and verifying a runway is
    // drawn where the aerodrome chart says it is means going to that aerodrome.
    if (import.meta.env.DEV) window.__homeMap = map
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
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); map.off('moveend', report)
      if (import.meta.env.DEV && window.__homeMap === map) delete window.__homeMap
    }
  }, [map, mapRef, onReady, onMove])
  return null
}

/* ── Flying the map, as opposed to reading it ──────────────────────────
   Everything below came from the map screen on main, where it was built
   against the same Leaflet the vector basemap sits under. The parts that
   rotate live inside the map; the parts a pilot presses stay outside it,
   because a control that turns with the ground is a control you have to
   find twice. ── */

// Simple top-view aircraft, drawn point-up and rotated per render to the
// screen-relative track. One shape for everyone: the ask was "a random simple
// aircraft design", not a fleet picker.
function ownshipIcon(screenDeg) {
  return L.divIcon({
    className: '',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<svg width="34" height="34" viewBox="0 0 24 24" style="transform:rotate(${Math.round(screenDeg)}deg);filter:drop-shadow(0 1px 2px rgba(0,0,0,0.5))">
      <path d="M12 2 L13.4 9 L21 12 L13.4 13.6 L13.1 18.6 L15.4 20.6 L15.4 21.8 L12 20.8 L8.6 21.8 L8.6 20.6 L10.9 18.6 L10.6 13.6 L3 12 L10.6 9 Z"
        fill="#0a84ff" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/>
    </svg>`,
  })
}

// Follow mode: while on, every GPS fix recenters the map on the aircraft,
// until the pilot drags, which hands the map back to them (reported via
// onUserDrag; Locate re-engages). setView never fires dragstart, so following
// cannot cancel itself.
//
// The screen offset (the sheet covering the bottom, plus the Track Up Ahead
// placement in the lower region of the visible strip) is applied in SCREEN
// space and converted to map-frame pixels through the current rotation: with
// the canvas CSS-rotated by -bearing, screen-down (0, dy) is the map vector
// (-dy*sin(theta), dy*cos(theta)).
function FollowController({ follow, orientation, fix, bearing, coveredHeight, onUserDrag }) {
  const map = useMap()
  useEffect(() => {
    const h = () => onUserDrag()
    map.on('dragstart', h)
    return () => map.off('dragstart', h)
  }, [map, onUserDrag])
  useEffect(() => {
    if (!follow || !fix) return
    map.setView([fix.lat, fix.lon], map.getZoom(), { animate: false })
    const visibleH = Math.max(0, window.innerHeight - coveredHeight)
    // Positive dy lifts the ownship UP the screen (sheet compensation); Track
    // Up Ahead SUBTRACTS, pushing the ownship down into the lower region of
    // the visible strip so the map ahead gets the space. dy can legitimately
    // go negative, so this must not gate on sign.
    const dy = coveredHeight / 2 - (orientation === 'trackAhead' ? 0.22 * visibleH : 0)
    if (Math.abs(dy) > 0.5) {
      const th = bearing * Math.PI / 180
      map.panBy([-dy * Math.sin(th), dy * Math.cos(th)], { animate: false })
    }
  }, [follow, fix, orientation, bearing, coveredHeight, map])
  return null
}

// Friends who are up, drawn as aircraft rather than dots so the map says at a
// glance which way they are going. Deliberately a different colour from the
// ownship: the one blue aircraft on this map is you, and a screen where you
// have to work out which one you are is worse than no feature.
//
// The label carries the name and the altitude, because "Diego, 4,500" is the
// whole answer to why a pilot looked, and a tap should not be required for it.
// A display name is a string another user chose, and this builds raw HTML for
// Leaflet's divIcon. Escaped rather than interpolated: the one place in this
// app where somebody else's text becomes markup is exactly where a display
// name of "<img onerror=...>" would run.
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

function friendIcon(trackDeg, name, altFt) {
  const rot = Math.round(trackDeg ?? 0)
  const alt = altFt != null ? `${Math.round(altFt).toLocaleString()} ft` : ''
  const safeName = escapeHtml(name)
  return L.divIcon({
    className: '',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<div style="position:relative">
      <svg width="30" height="30" viewBox="0 0 24 24" style="transform:rotate(${rot}deg);filter:drop-shadow(0 1px 2px rgba(0,0,0,0.5))">
        <path d="M12 2 L13.4 9 L21 12 L13.4 13.6 L13.1 18.6 L15.4 20.6 L15.4 21.8 L12 20.8 L8.6 21.8 L8.6 20.6 L10.9 18.6 L10.6 13.6 L3 12 L10.6 9 Z"
          fill="#ff9f0a" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/>
      </svg>
      <div style="position:absolute;left:50%;top:30px;transform:translateX(-50%);white-space:nowrap;
        font-size:10px;font-weight:800;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.9);line-height:1.2;text-align:center">
        ${safeName}${alt ? `<br><span style="font-weight:600;opacity:0.85">${alt}</span>` : ''}
      </div>
    </div>`,
  })
}

function FriendsLayer({ friends }) {
  if (!friends.length) return null
  return (
    <>
      {friends.map(f => (
        <Marker key={f.user_id} position={[f.lat, f.lon]}
          icon={friendIcon(f.track_deg, f.name, f.alt_ft)} interactive={false} />
      ))}
    </>
  )
}

// The pilot's own track, drawn behind them for as long as the overlay is on.
// Two strokes: a wide translucent casing under a solid core, so the line stays
// legible over both a dark satellite image and a pale sectional without
// needing to know which is underneath.
function BreadcrumbLayer({ trail }) {
  if (trail.length < 2) return null
  const path = trail.map(p => [p.lat, p.lon])
  return (
    <>
      <Polyline positions={path} pathOptions={{ color: '#000', weight: 7, opacity: 0.28, lineCap: 'round', lineJoin: 'round' }} />
      <Polyline positions={path} pathOptions={{ color: '#ff6b35', weight: 3, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }} />
    </>
  )
}

// The provider owns the one geolocation watch this screen runs, so it has to
// sit above the component that reads it. Everything else lives in MapHomeInner.
export default function MapHome() {
  return (
    <HomeLocationProvider>
      <MapHomeInner />
    </HomeLocationProvider>
  )
}

function MapHomeInner() {
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

  // The pilot's own worked fuel plan, if there is one. Scoped to the aircraft,
  // the same key Cruise & Fuel writes, so this reads their numbers rather than
  // keeping a second copy that could disagree.
  const [cruisePlan, setCruisePlan] = useState(null)
  useEffect(() => {
    let cancelled = false
    get('settings', scopedSettingsKey('cruise', aircraftId))
      .then(r => { if (!cancelled) setCruisePlan(r ?? null) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [aircraftId])

  const isDark = useIsDark()

  const [layers, setLayers] = useState(EMPTY_LAYERS)
  // Which stop the drawer is resting at, as one of the numbers above.
  // Dragging between them is how the rest of the app is reached now that the
  // home screen is a map, so it has to feel like a sheet rather than a button
  // that swaps screens.
  //
  // 0 is one of the stops rather than a separate open/closed flag, because it
  // is one: the arrow button hides the drawer, and hiding it is a glance at
  // the map rather than a change of screen.
  const [snap, setSnap] = useState(25)
  const sheetOpen = snap !== 0
  // Where a hidden drawer comes back to. Whatever it was doing before it was
  // put away, since putting it away was about seeing the map, not about
  // abandoning the drawer's contents.
  const lastStop = useRef(25)
  useEffect(() => { if (snap !== 0) lastStop.current = snap }, [snap])
  // Planning happens here now, not on a screen of its own. Plan Route raises
  // the drawer to the 'plan' stop and fills it with the flight plan, so the
  // map keeps showing what the route is being drawn across. /checklists still
  // exists and still works; this is the way in, not the only way.
  const [planning, setPlanning] = useState(false)
  // A step inside the flight plan is open.
  //
  // The plan rests at 50 and is not allowed above it, which is right while it
  // is a list of steps to choose from. It is wrong the moment one of them is
  // opened: a form that needs more room than half a screen was scrolling away
  // under the drawer's own title, which is the drawer hiding its contents from
  // itself. Open a step and the drawer stands up to full screen; close it and
  // it sits back down.
  //
  // No state behind it any more: it existed to tell the drag where the
  // plan's ceiling was, and the plan has no ceiling of its own now. All that
  // is left is the move itself.
  const onStepOpenChange = useCallback((open) => {
    setSnap(open ? 100 : 50)
  }, [])
  // The calculated route: drawn on the map, summarised on the collapsed
  // drawer, and cleared by the X on that card. Read back from IndexedDB on
  // mount, so a route survives the app being closed and reopened, which is
  // what a flight plan made the night before has to do.
  const [route, setRoute] = useState(null)
  // A route in the drawer sends the actions out of it, onto a card of their
  // own over the map.
  //
  // Stacked in one drawer they made a screen that was mostly buttons: 86px of
  // record button and two labels above the route it was supposed to be
  // reporting, so the route came second on its own screen. The flight plan
  // already makes this division, and the read-back makes it too, so a route on
  // the drawer now makes it as well: the drawer carries the subject, the card
  // above carries the actions, and the map stays visible between them.
  // Is there a route on the drawer?
  //
  // This asked whether the route had a DISTANCE, which was the same question
  // right up until a route could be edited from the drawer. Taking a waypoint
  // out drops the planner's figures on purpose, and with distNm gone the app
  // concluded the route had gone too: the card vanished mid-edit, the buttons
  // came back, and the line the pilot had just shortened was still drawn
  // across the map with nothing on the drawer admitting it existed.
  //
  // `route` is only ever set with both ends resolved, so its presence is the
  // honest test. The figures are a property of a route, not proof of one.
  const hasRoute = !!route?.depPos && !!route?.destPos
  const actionsFloat = !planning && hasRoute
  // Which surface the action row is on, decided by nothing but how far up the
  // drawer is.
  //
  //   resting, with an empty drawer  inside it, at the top. Its home.
  //   resting, carrying a route      floating over the map above it.
  //   half screen                    floating over the map above it.
  //   higher than half               neither. It rides down under the drawer
  //                                  and comes back when the drawer does.
  //
  // That last line is the whole rule and it replaces the opposite one. The row
  // used to reappear INSIDE the drawer above half screen, on the argument that
  // the record button has to stay reachable from whatever surface the pilot is
  // on. In practice that put three buttons across the top of the flight plan
  // at exactly the moment the pilot had pulled the plan up to read it, and the
  // buttons were not the thing they had asked for. Pulling the drawer back
  // down to half brings the row back, which is one gesture.
  //
  // Declared here rather than at each use because three separate places have
  // to agree about it, and they disagreed before.
  const actionsUp = snap > 50
  const actionsFloating = !actionsUp && (snap === 50 || (snap === 25 && (planning || hasRoute)))
  const actionsInDrawer = !actionsUp && snap === 25 && !actionsFloating
  // The height every stop is a fraction of, measured off the shell itself
  // rather than read from window.innerHeight.
  //
  // The keyboard is why. Opening it collapses innerHeight from 793 to 390 on
  // the phone (measured, in the web clip) while the shell, which is
  // position:fixed, keeps its 793: fixed positioning resolves against a
  // containing block the keyboard does not touch. So every stop and the
  // planner's own column were being sized to 390 inside a box that was still
  // 793, which put the plan in the top quarter of the drawer and left the
  // rest of the screen as bare drawer. Tapping the destination field turned
  // the app black.
  //
  // Measuring the box the drawer actually lives in cannot disagree with it.
  // Rotation still moves it, because rotation really does change the box.
  const shellRef = useRef(null)
  const [viewportH, setViewportH] = useState(() => window.innerHeight)
  // The drawer's header and the aircraft's name block, measured rather than
  // assumed. Both change height with their contents: the header gains the
  // route card and loses the action row, and the name wraps to two lines for
  // a long type. The photograph's height is what is left after them, so a
  // guess at either is a guess at whether the name is on the screen.
  const [grabH, grabRef] = useMeasuredHeight()
  const [acTextH, acTextRef] = useMeasuredHeight()
  const [dragY, setDragY] = useState(null)      // live offset while a finger is down
  const drag = useRef(null)
  // The drawer itself, so a block's offset inside it can be measured against
  // the stop it claims. Read by the stop audit and nothing else.
  const sheetRef = useRef(null)
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
  const fittedRoute = useRef(null)
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
  // Position comes from the shared provider rather than a watch of this
  // screen's own. Two concurrent high-accuracy watches is the bug
  // useLiveLocation's header describes, and the instruments below (ownship
  // heading, Track Up, the data bar) need the fields a bare watchPosition
  // never collected: ground track, accuracy, rate of turn, vertical speed.
  //
  // A stale fix is not a fix. Gating it here once means the ownship, the
  // readouts and follow mode cannot any of them treat a position the aircraft
  // left minutes ago as current.
  const {
    coords: rawCoords, derived: liveDerived, status: liveStatus,
    lastKnown, stale: fixStale,
  } = useHomeLocation()
  const pos = fixStale ? null : rawCoords

  // Follow mode: Locate engages it, a manual drag breaks it. While on,
  // FollowController recenters on every fix.
  const [follow, setFollow] = useState(false)
  const handleUserDrag = useCallback(() => setFollow(false), [])
  // 'north' | 'track' | 'trackAhead', persisted, cycled by the Locate button.
  const [orientation, setOrientationState] = useState('north')
  useEffect(() => {
    get('settings', 'mapOrientation').then(row => { if (row?.value) setOrientationState(row.value) }).catch(() => {})
  }, [])
  function cycleOrientation() {
    const order = ['north', 'track', 'trackAhead']
    const next = order[(order.indexOf(orientation) + 1) % order.length]
    setOrientationState(next)
    put('settings', { key: 'mapOrientation', value: next }).catch(() => {})
  }
  // The map canvas's rotation. Continuous (unwrapped) so 359 to 1 degrees turns
  // 2 degrees through north instead of spinning 358 the long way under the CSS
  // transition. Returns to 0 whenever follow is off or the mode is North Up, so
  // after a manual pan the map reads like a chart again until Locate re-engages
  // the track.
  const [bearing, setBearing] = useState(0)
  useEffect(() => {
    const target = (follow && orientation !== 'north' && pos?.headingDeg != null)
      ? pos.headingDeg
      : (!follow || orientation === 'north') ? 0 : null
    if (target == null) return   // tracking mode, no ground track yet: hold current rotation
    setBearing(prev => {
      const d = ((target - prev) % 360 + 540) % 360 - 180
      return Math.abs(d) < 0.5 ? prev : prev + d
    })
  }, [pos, follow, orientation])
  // The rotating canvas is a square with the viewport's diagonal as its side,
  // centred, so however the map turns no corner of the screen ever shows past
  // its edge. Measured from the actual shell and re-measured on resize:
  // measuring window dimensions once at mount produced a 0x0 canvas, and an
  // invisible map, when the hosting view initialised before layout settled.
  const [canvasSize, setCanvasSize] = useState(() => Math.ceil(Math.hypot(window.innerWidth, window.innerHeight)) || 1200)
  useEffect(() => {
    const measure = () => {
      const w = shellRef.current?.clientWidth || window.innerWidth
      const h = shellRef.current?.clientHeight || window.innerHeight
      const d = Math.ceil(Math.hypot(w, h))
      if (d > 0) setCanvasSize(prev => (Math.abs(prev - d) > 2 ? d : prev))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // Fed the gated fix, so a trail cannot grow a straight line across the gap
  // where the GPS was actually silent.
  const { trail: breadcrumbTrail, reset: resetBreadcrumbs } = useBreadcrumbTrail({
    enabled: layers.breadcrumbs, coords: pos,
  })

  // Every reporting row opens in the sheet rather than navigating away, which
  // is the rule the rest of this screen already follows.
  const openRow = useCallback(key => setDrawerView(key), [])

  // The three assignable buttons, and which slot is currently being reassigned.
  const [homeActions, setHomeActions] = useState(DEFAULT_HOME_ACTIONS)
  const [slotPicker, setSlotPicker] = useState(null)
  useEffect(() => {
    get('settings', HOME_ACTIONS_KEY)
      .then(row => { if (row?.value) setHomeActions(normaliseActions(row.value)) })
      .catch(() => {})
  }, [])
  function assignSlot(slot, key) {
    setHomeActions(prev => {
      const next = [...prev]
      // Assigning something that is already in another slot swaps the two
      // rather than leaving the row holding it twice, which would waste one of
      // only three places on a duplicate.
      const existing = next.indexOf(key)
      if (existing !== -1) next[existing] = next[slot]
      next[slot] = key
      put('settings', { key: HOME_ACTIONS_KEY, value: next }).catch(() => {})
      return next
    })
    setSlotPicker(null)
  }

  // The raw currency record rather than a rolled-up status: the Pilot row
  // reports flight currency and medical separately, so it needs both of
  // getCurrencyStatus's cards, not the worse of the two.
  const [currencyData, setCurrencyData] = useState(null)
  useEffect(() => {
    get('currency', 'profile').then(d => setCurrencyData(d ?? {})).catch(() => {})
  }, [])
  const currencyCards = useMemo(
    () => (currencyData ? getCurrencyStatus(currencyData) : null),
    [currencyData])
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
  // The tilted view, on or off. A view of the same flight, not a place of its
  // own, so nothing else about this screen changes when it turns on.
  const [view3d, setView3d] = useState(false)
  // The aerodrome the pilot has zoomed down onto, reported by the runway layer
  // and null at every zoom above its floor. It carries the plate below the map
  // controls; nothing else on this screen changes because of it.
  const [focusField, setFocusField] = useState(null)
  // Which screen the drawer is carrying instead of its own contents, if any.
  //
  // Calculators, Pilot, Reference, Airports, Tools and Settings used to be
  // routes: tapping one left the map entirely. They open here now, at whatever
  // height the drawer is already at, and the drawer keeps every gesture it
  // had, so a pilot can pull the screen up to full and push it back down
  // without it ever having been somewhere else.
  const [drawerView, setDrawerView] = useState(null)
  const closeDrawerView = useCallback(() => setDrawerView(null), [])
  // Back belongs to whatever is on top. useBack checks this override before it
  // checks a screen's own onBack and before it falls through to home, so every
  // back control inside the embedded screen closes the view rather than
  // throwing away the map: the button in its header, the edge swipe, and the
  // system gesture all land in the same place without any of those screens
  // being told they are in a drawer.
  useBackOverride(drawerView ? closeDrawerView : null)
  // The drawer's scrolling body, so opening a screen starts at its top rather
  // than wherever the tools grid had been scrolled to. Without it, tapping
  // Settings from halfway down the logbook opens Settings halfway down.
  const bodyRef = useRef(null)
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }, [drawerView])
  // Whether the card at the top of the map is open. One state, because it is
  // one card with one tap: at rest the flight category and the code, and open
  // the conditions and the aerodrome under the map together. It was an
  // accordion of two halves for a build, and two collapsed rows with two
  // chevrons is furniture on top of a chart.
  //
  // Held here rather than inside the card because this is the only place that
  // knows how much room is left above the drawer.
  const [topOpen, setTopOpen] = useState(false)
  // A chart the pilot asked for, opened over everything. Held here rather than
  // inside the plate because it is a full screen, and the plate is a bar.
  const [chartOpen, setChartOpen] = useState(null)
  // The chart is a screen without an address, so back has to be told about it
  // or an edge swipe leaves the map altogether while the chart is still up.
  // Same claim the Airports section makes for the same viewer.
  const closeChart = useCallback(() => setChartOpen(null), [])
  useBackOverride(chartOpen ? closeChart : null)
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
  // The chart toggles plus 3D, which behaves like the rest of them: it turns
  // on, it lights up, it turns off. It is not a chart layer underneath, since
  // this map's camera is Leaflet's and Leaflet's camera is flat, so 3D is a
  // second map drawn over the map area. But that is the implementation, and a
  // pilot should only meet the behaviour: the drawer, the route strip, the
  // weather pill and these chips all stay put, because they all still describe
  // the same flight. Spike only (vector-map-spike).
  const chipDefs = [...CHARTS, { key: 'view3d', label: '3D', view: true }]
  const chipLayout = chipStackBox(chipArea.h, chipArea.w, chipDefs.length)

  // Whether anything is drawn ON the basemap. The FAA rasters and the openAIP
  // airspace are semi-transparent and were drawn for paper: over dark tiles
  // their greens and blues turn to mud and the altitude figures stop being
  // readable, which defeats the point of turning them on. So the dark basemap
  // is for the bare map only, and yields the moment a chart needs it.
  //
  // Traffic and TFRs are not in this list: they are opaque vector overlays and
  // read as well over dark tiles as over light ones.
  const chartOverBasemap = ['sectional', 'tac', 'terrain', 'ifrlo', 'ifrhi', 'airspace']
    .some(k => layers[k])
  // What the tiles under everything else actually are, which is not the same
  // question as what theme the app is in. Anything drawn on top of the map has
  // to contrast with this, not with the sheet.
  const darkBasemap = isDark && !chartOverBasemap
  const expanded = snap > 25

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

  // The same events as before, and a different answer to them.
  //
  // The events are still the window's, because they are the only ones that
  // arrive: a ResizeObserver on the shell was tried first and never fired
  // once, since a position:fixed box sized by inset does not report viewport
  // changes to one. What changed is where the number comes from. The listener
  // measures the shell rather than reading window.innerHeight, so a keyboard
  // that collapses innerHeight to 390 while the shell stays 793 produces no
  // change at all, and a rotation, which really does resize the shell,
  // produces one.
  const [safeBottom, setSafeBottom] = useState(0)
  // The status bar's strip, measured for the same reason the one below it is:
  // the top card's height cap is worked out in JS, from the shell's measured
  // height, and mixing that with a CSS dvh would reintroduce exactly the
  // viewport lie the shell measurement exists to avoid.
  const [safeTop, setSafeTop] = useState(0)
  useEffect(() => {
    const read = () => {
      const h = Math.round(shellRef.current?.getBoundingClientRect().height ?? 0)
      // Zero between layouts. Taking it would put every stop at the top of
      // the screen.
      if (h > 0) setViewportH(h)
      // The home indicator's strip, in a number rather than a CSS expression,
      // because the aircraft's height is worked out in JS and has to clear it.
      // Zero on the desktop, which is exactly why it cannot be eyeballed here.
      const css = getComputedStyle(document.documentElement)
      setSafeBottom(parseFloat(css.getPropertyValue('--safe-bottom')) || 0)
      setSafeTop(parseFloat(css.getPropertyValue('--safe-top')) || 0)
    }
    read()
    window.addEventListener('resize', read)
    window.addEventListener('orientationchange', read)
    window.visualViewport?.addEventListener('resize', read)
    return () => {
      window.removeEventListener('resize', read)
      window.removeEventListener('orientationchange', read)
      window.visualViewport?.removeEventListener('resize', read)
    }
  }, [])

  // How much of the shell the keyboard is sitting on top of.
  //
  // The shell's own height minus the visual viewport's, which is the one
  // number iOS reports honestly here: with the keyboard up the phone said
  // innerHeight 390, visualViewport 390, and a fixed box still 793. The
  // difference is the keyboard, and it is the only thing the drawer should
  // react to when a field is tapped.
  const [kbInset, setKbInset] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const read = () => {
      const shell = shellRef.current?.getBoundingClientRect().height ?? 0
      if (!shell) return
      // Rounded away below a few pixels: browser chrome and the address bar
      // produce small differences that are not a keyboard, and lifting the
      // drawer for those would be a twitch on every scroll.
      const inset = Math.round(shell - vv.height)
      setKbInset(inset > 24 ? inset : 0)
    }
    read()
    vv.addEventListener('resize', read)
    vv.addEventListener('scroll', read)
    return () => {
      vv.removeEventListener('resize', read)
      vv.removeEventListener('scroll', read)
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
    // The old handover left pendingDest rows behind on phones that ran the
    // broken builds; nothing reads them any more, so they are cleared.
    del('settings', 'pendingDest').catch(() => {})
  }, [])

  // Moving base. Writes the same settings row the weather card writes, so the
  // two screens never disagree about where home is, then re-resolves the
  // coordinates and takes the map there: changing your base and being left
  // looking at the old one would be its own small bug.
  async function changeBase(ident) {
    const id = (ident || '').trim().toUpperCase()
    if (!id) return
    await setHomeIdent(id)
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

  // Which identifiers the route is already labelling on the map, so nothing
  // else labels the same point a second time.
  const routeEndLabels = useMemo(() => new Set(
    routeLine.length > 1 ? [route?.dep, route?.dest].filter(Boolean) : [],
  ), [routeLine.length, route?.dep, route?.dest])

  // The same points as routeLine, in the shape the drop popup wants them.
  const routeWpts = useMemo(
    () => routeLine.map(([lat, lon]) => ({ lat, lon })),
    [routeLine],
  )

  // The flight itself, as four figures a pilot can act on.
  //
  // Time is distance over cruise TAS, fuel is time times burn: the same
  // arithmetic this app already commits to when it saves a flight, so this card
  // and the logbook cannot quietly disagree about the same leg.
  //
  // It is AIR time. No wind is applied, because the wind-corrected figure only
  // exists once the altitude advisor has run inside the plan, and inventing one
  // here would be a number wearing more authority than it earned.
  //
  // Likewise TRIP fuel, not required fuel: the reserve is a regulatory figure
  // that depends on the ruleset, the rules and the time of day, and Cruise &
  // Fuel is where it is worked out. Calling this "fuel needed" next to "fuel
  // aboard" would imply a go/no-go the card has not actually computed.
  //
  // The pilot's own worked plan wins. Where there is none the aircraft's book
  // figures stand in, and the card says so underneath rather than passing them
  // off as a plan nobody made.
  // Both read here rather than inside the figures: the reserve minimum is a
  // legal question and the answer depends on where the pilot is flying and
  // what they are filing.
  const { region } = useRegion()
  // The stored value is a record, not a string: { type, flightRules,
  // crossCountry }. Passing the record straight to the ruleset made
  // isKnownRule fail, which fell through to the unmodelled 45 minutes, so a
  // day VFR flight was being told its minimum was 45 rather than 30. A wrong
  // legal minimum shown with the planner's authority is the worst class of bug
  // this app can ship, and it read as plausible.
  //
  // flightRules rather than type is also what makes RTC right: rotorcraft fly
  // under the VFR rules, so its record carries flightRules 'VFR' while its
  // type stays 'RTC'.
  const { value: planType } = useFlightPlanType()
  const flightRules = planType?.flightRules ?? null

  const flightFigures = useMemo(() => {
    const planTas = num(cruisePlan?.tas)
    const planBurn = num(cruisePlan?.burnRate)
    const tas = planTas ?? num(ac?.vspeeds?.cruise)
    const burn = planBurn ?? num(ac?.burnRate?.cruise)
    const hours = route?.distNm != null && tas ? route.distNm / tas : null
    const aboard = num(cruisePlan?.fuelOnBoard) ?? num(ac?.fuel?.usable)
    // Reserve is what the whole plan exists to answer, so it is computed from
    // the same lib Cruise & Fuel uses rather than repeated here. The required
    // minimum comes out of the region's own ruleset for the same reason: two
    // copies of a legal minimum is the one duplication this app cannot afford.
    const required = requiredReserveMinutes({
      region,
      flightRules,
      isHelicopter: ac?.category === 'helicopter',
      // Day is the assumption, and it is the conservative direction only for
      // the figure itself: the night minimum is higher, so a plan that clears
      // the day minimum may not clear the night one. Cruise & Fuel is where a
      // pilot sets this; the drawer reports against whatever they set there.
      timeOfDay: cruisePlan?.timeOfDay ?? 'day',
    })
    return {
      hours,
      tripFuel: hours != null && burn ? hours * burn : null,
      aboard,
      altFt: num(route?.cruiseAlt) ?? num(cruisePlan?.cruiseAlt),
      eta: etaFrom(route?.etd ?? null, hours),
      reserveMin: reserveMinutes({ aboardGal: aboard, burnGph: burn, eteHours: hours }),
      reqReserveMin: required.minutes,
      reserveNote: required.note,
    }
  }, [route?.distNm, route?.cruiseAlt, route?.etd, cruisePlan, ac, region, flightRules])

  // What to call each turning point when one is tapped on the map. Built with
  // the same filter routeLine uses, so the nth dot on the line and the nth name
  // here are the same waypoint.
  const routeMiddleNames = useMemo(
    () => (route?.wpts ?? [])
      .filter(w => w?.lat != null && w?.lon != null)
      .map(w => w.name || w.via || ''),
    [route],
  )

  // The same points again, carrying their names, which is what the FPL row
  // reports: the plan reads "KRNO to KSFO", not two coordinates. Built off
  // routeLine and routeMiddleNames together so the nth point and the nth name
  // cannot drift apart.
  //
  // Declared here, below routeMiddleNames rather than beside routeLine. A
  // const read before its own declaration is in its temporal dead zone, and
  // the map screen on main has a comment recording exactly that mistake
  // blowing up the whole map at mount.
  const fplRoute = useMemo(() => {
    if (routeLine.length < 2) return null
    const names = [route?.dep || '', ...routeMiddleNames, route?.dest || '']
    return routeLine.map(([lat, lon], i) => ({ lat, lon, name: names[i] || '' }))
  }, [routeLine, routeMiddleNames, route?.dep, route?.dest])


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
      for (const stale of ['trueCourse', 'magCourse', 'atsTokens']) delete next[stale]
      // Held on the map and dropped into the route: the card answers with the
      // new distance and course immediately, rather than sending the pilot to
      // the planner to be told what the line in front of them already says.
      Object.assign(next, recomputeFigures(prev, wpts))
      put('settings', { key: 'route', ...next }).catch(() => {})
      return next
    })
  }, [])

  // The route's middle, as the groups a pilot thinks in.
  //
  // Consecutive fixes sharing a `via` are one thing: the airway or procedure
  // they came from. Everything that edits the strip works on these rather
  // than on the fixes underneath, so a route can be reordered without a
  // published departure being taken apart in the process.
  const legGroups = useCallback((wpts) => {
    const groups = []
    for (const w of wpts ?? []) {
      const key = w.via ?? w.name
      if (!key) continue
      if (groups[groups.length - 1]?.key === key) groups[groups.length - 1].wpts.push(w)
      else groups.push({ key, wpts: [w] })
    }
    return groups
  }, [])

  // Both edits drop the planner's figures, for the reason given above
  // addDroppedWaypoint: they describe the route as it was before the edit,
  // and a distance that no longer matches the line is worse than none.
  const withEdit = useCallback((prev, wpts) => {
    const next = { ...prev, wpts, needsRecalc: true }
    // The filed string still goes: it names a composition that no longer
    // exists, and the one-pager falls back to dep, wpts and dest.
    for (const stale of ['trueCourse', 'magCourse', 'atsTokens']) delete next[stale]
    Object.assign(next, recomputeFigures(prev, wpts))
    put('settings', { key: 'route', ...next }).catch(() => {})
    return next
  }, [])

  // A chip dragged to a new place in the route.
  const reorderRouteLeg = useCallback((key, toIndex) => {
    setRoute(prev => {
      const groups = legGroups(prev?.wpts)
      const from = groups.findIndex(g => g.key === key)
      if (from < 0) return prev
      const moved = groups.splice(from, 1)[0]
      groups.splice(Math.max(0, Math.min(groups.length, toIndex)), 0, moved)
      return withEdit(prev, groups.flatMap(g => g.wpts))
    })
  }, [legGroups, withEdit])

  // A stop typed into the strip. It lands at the end of the middle, which is
  // the leg the pilot is looking at when they type into the space after the
  // last chip.
  const addRouteStop = useCallback((wpt) => {
    setRoute(prev => (prev ? withEdit(prev, [...(prev.wpts ?? []), wpt]) : prev))
  }, [withEdit])

  // A point taken back out of the route, from the chip that names it.
  //
  // Removes the whole leg rather than one fix. A published departure arrives
  // here as a dozen fixes sharing a `via`, and pulling one out of the middle
  // of ARDIA7 leaves a procedure that is no longer the procedure. The chip
  // says ARDIA7, so the chip removes ARDIA7.
  //
  // The planner's figures go in the same write, for the reason spelled out
  // above addDroppedWaypoint: they describe the route as it was before this,
  // and a distance that no longer matches the line drawn under it is worse
  // than none. The planner recomputes them the moment it is opened.
  const removeRouteLeg = useCallback((key) => {
    setRoute(prev => {
      if (!prev?.wpts?.length) return prev
      const wpts = prev.wpts.filter(w => (w.via ?? w.name) !== key)
      if (wpts.length === prev.wpts.length) return prev
      return withEdit(prev, wpts)
    })
  }, [withEdit])

  // A turning point taken off the line, by identity rather than by index.
  //
  // routeLine drops any waypoint missing a coordinate, so the nth dot on the
  // map is the nth VALID waypoint and not necessarily wpts[n]. Matching the
  // object itself cannot drift the way an index quietly can, and deleting the
  // wrong leg of a flight plan is not a mistake that announces itself.
  const removeRouteWaypointAt = useCallback((i) => {
    setRoute(prev => {
      if (!prev?.wpts?.length) return prev
      const valid = prev.wpts.filter(w => w?.lat != null && w?.lon != null)
      const target = valid[i]
      if (!target) return prev
      return withEdit(prev, prev.wpts.filter(w => w !== target))
    })
  }, [withEdit])

  // A chip tapped: put the map on it. The zoom is the one an airport gets
  // from the picker, so arriving at a point from the strip and arriving at it
  // from anywhere else look the same.
  const focusRoutePoint = useCallback((lat, lon) => {
    if (lat == null || lon == null) return
    mapRef.current?.setView([lat, lon], AIRPORT_ZOOM, { animate: true })
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
  const addFieldToRoute = useCallback(async ({ ident, name, lat, lon }) => {
    // Computed right here, not handed to the planner. The planner's own
    // calculation lives inside its Route card, which only exists once a pilot
    // opens it, and handing the destination to a screen that was not there is
    // how the confirmation sat on "Working out the route" forever.
    //
    // The record saved is the same shape the planner saves, so Open the plan
    // restores it as its own: fields prefilled, line drawn, no recalculation.
    // Straight to the route on the drawer. There was a read-back between the
    // two, a full-height card of the same four figures with a Looks right
    // under them, and it was a screen asking a pilot to confirm something they
    // had just done deliberately. The card below says the same thing in the
    // same words, the line is drawn across the map behind it, and the X on it
    // is the disagreement. Nothing was being checked that this does not show.
    const destId = (ident ?? '').trim().toUpperCase()
    setRoute(null)
    setPlanning(false)
    setSnap(25)
    // The camera is the pilot's from here, so the opening framing stops
    // waiting for a fix to move it out from under them. Where it goes is the
    // framing effect's business: it fits the whole route into the strip the
    // drawer leaves, which is the picture the card is describing.
    framed.current = true

    const depId = await resolveHomeIdent()
    const depApt = depId ? await findAirport(depId) : null
    if (!depApt) {
      // No home base to fly from, so there is no route to draw. The planner
      // opens instead, where the pilot can type a departure.
      openPlanner()
      return
    }
    const calculated = await computeDirectRoute(
      { ident: depId, name: depApt.name, lat: depApt.lat, lon: depApt.lon },
      { ident: destId, name: name ?? null, lat, lon },
    )
    put('settings', { key: 'route', ...calculated }).catch(() => {})
    setRoute(calculated)
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
    // Turning the trail on starts a new one. Doing this on the actual toggle is
    // what makes it a deliberate reset rather than something the app does to
    // itself whenever layer state finishes loading.
    if (k === 'breadcrumbs' && !prev.breadcrumbs) resetBreadcrumbs()
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

  // One button, staged, rather than a locate button and a separate orientation
  // control competing for the same corner of a screen a pilot reaches for
  // without looking.
  //
  //   not following  -> jump to the aircraft and follow, in the current mode
  //   already following -> each tap cycles North Up / Track Up / Track Up Ahead
  //
  // Falling back to the base airport matters: a locate button that does nothing
  // because the fix has not arrived yet reads as broken.
  function locate() {
    if (!follow) {
      const target = pos ?? base
      if (target && mapRef.current) mapRef.current.setView([target.lat, target.lon], 12, { animate: true })
      // Only engage follow against a real fix. Following the base airport would
      // peg the map to a runway the aircraft may be nowhere near, and the pilot
      // could not pan away from it.
      if (pos) setFollow(true)
      return
    }
    cycleOrientation()
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
  function openPlanner(at = 50) {
    // 50 is both "on screen" and the plan's usual stop, so one call does what
    // used to take two: raising a hidden drawer and moving it to the plan. A
    // drag that asked for a different rung gets the rung it asked for.
    setSnap(at)
    setPlanning(true)
  }

  function leavePlanner() {
    setPlanning(false)
    setSnap(25)
    // Reset inside the planner deletes the saved route, and this held its own
    // copy in state, so the line stayed on the map after the plan behind it
    // was gone. Re-read on the way out: storage is what actually decides
    // whether there is still a route.
    get('settings', 'route').catch(() => null).then(saved => {
      if (!saved?.depPos || !saved?.destPos) { setRoute(null); flyHome() }
    })
  }

  // Calculate Route was pressed and it worked. The drawer's job now is to get
  // out of the way of the line it just produced, which is the whole point of
  // planning on top of the map rather than on a screen away from it.
  function onRouteCalculated(calculated) {
    setRoute(calculated)
    setPlanning(false)
    setSnap(25)
  }


  // Forget the route: off the map, off the drawer, out of storage. Deleted
  // rather than just dropped from state, or it would come back on the next
  // launch, and a route the pilot dismissed coming back is worse than one
  // that never persisted at all.
  // Home again, wherever the route had taken the camera. A map still framed on
  // a flight that no longer exists is the app remembering something the pilot
  // just told it to forget.
  // A callback rather than a declaration only because removeRouteEnd holds it
  // in a dependency array, and a function remade every render would remake
  // that callback with it.
  const flyHome = useCallback(() => {
    // Cleared here as well as in the effect's ref, or the next route to the
    // same pair of ends would be judged already framed and never fit.
    fittedRoute.current = null
    if (mapRef.current && base?.lat != null) {
      mapRef.current.setView([base.lat, base.lon], 11, { animate: true })
    }
  }, [base])

  // The flight plan, closed from the drawer.
  //
  // The X in the action row when a route is showing. There is no planner open
  // to close here, so leaving means the route goes: off the drawer, off the
  // map, and out of storage, because a route dropped from state alone comes
  // back on the next launch and a flight the pilot just dismissed returning
  // is worse than one that never persisted.
  //
  // The camera comes home too. A map still framed on a flight that no longer
  // exists is the app remembering something it was told to forget.
  const forgetRoute = useCallback(() => {
    del('settings', 'route').catch(() => {})
    setRoute(null)
    flyHome()
  }, [flyHome])

  // An end taken off the route, from its own chip's x.
  //
  // An end is not a waypoint: a route cannot be without one. Removing it
  // promotes the nearest plain point in the middle to be the new end, which
  // is what deleting the origin token does to a ForeFlight route string. Via
  // groups between the removed end and that point go with it, because an
  // airway whose anchor point is gone is not a route element, it is a name
  // floating in the string.
  //
  // With nothing in the middle to promote, removing an end removes the route,
  // deleted from storage the way Reset deletes it, or it would come back on
  // the next launch.
  const removeRouteEnd = useCallback((which) => {
    const groups = legGroups(route?.wpts)
    const seq = which === 'dep' ? groups : [...groups].reverse()
    const i = seq.findIndex(g => !g.wpts[0].via)
    if (i < 0) {
      del('settings', 'route').catch(() => {})
      setRoute(null)
      flyHome()
      return
    }
    const grp = seq[i]
    const point = which === 'dep' ? grp.wpts[0] : grp.wpts[grp.wpts.length - 1]
    const rest = seq.slice(i + 1)
    const wpts = (which === 'dep' ? rest : [...rest].reverse()).flatMap(g => g.wpts)
    setRoute(prev => {
      if (!prev) return prev
      const moved = which === 'dep'
        ? { ...prev, dep: point.name, depName: null, depPos: [point.lat, point.lon] }
        : { ...prev, dest: point.name, destName: null, destPos: [point.lat, point.lon] }
      return withEdit(moved, wpts)
    })
  }, [route, legGroups, withEdit, flyHome])

  // No clearRoute any more. The X that called it is gone, and a route is
  // discarded from Reset inside the plan, which deletes the same record and is
  // where a pilot goes to change a route rather than to glance at one.

  const recording = rec != null

  /* ── The flight data recorder ─────────────────────────────────────────
     Auto-detection came across from the map screen on main, where it was
     mounted and where this branch stopped routing. The hook, the thresholds
     and the settings section all survived the redesign; the mount did not, so
     the feature has been present and dead: a pilot could set a speed and an
     altitude in Settings and nothing would ever watch them.

     It reads this screen's fix rather than opening a watch of its own, which
     is the rule useFlightDetector's own header sets out and the reason the
     shared location provider exists. ── */
  const [autoDetectEnabled, setAutoDetectEnabled] = useState(AUTO_DETECT_DEFAULT_ENABLED)
  const [autoDetectConfig, setAutoDetectConfig] = useState(DEFAULT_AUTO_DETECT_CONFIG)
  useEffect(() => {
    get('settings', 'autoDetectEnabled').then(row => setAutoDetectEnabled(autoDetectEnabledFrom(row))).catch(() => {})
    get('settings', 'autoDetectConfig')
      .then(row => setAutoDetectConfig({ ...DEFAULT_AUTO_DETECT_CONFIG, ...(row?.value ?? {}) }))
      .catch(() => {})
  }, [])
  const { state: detectState, draft: detectedDraft, reset: resetDetector } = useFlightDetector({
    enabled: autoDetectEnabled, config: autoDetectConfig, coords: pos,
  })
  const { addEntry } = useLogbook()
  const [flightSaved, setFlightSaved] = useState(false)

  // The screen staying awake is the difference between recording a flight and
  // recording the first thirty seconds of one. Held while either recorder runs:
  // the pilot's own, or auto-detect having caught a departure.
  useWakeLock(recording || detectState === 'recording')

  // A detected flight is never committed behind the pilot's back. It lands
  // tagged pendingReview, which is what puts it in front of them under Pilot to
  // confirm, edit, or throw away before it is a logbook record.
  useEffect(() => {
    if (detectState !== 'done' || !detectedDraft) return
    addEntry({ ...detectedDraft, aircraftId: aircraftId ?? null, source: 'auto', pendingReview: true })
      .then(() => {
        setFlightSaved(true)
        setTimeout(() => setFlightSaved(false), 6000)
      })
      .catch(() => {})
    resetDetector()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectState, detectedDraft])

  // Who is up, and whether this pilot is telling anyone where they are. The
  // layer is a chart chip like everything else that draws on the map; the
  // sharing decision is a setting, because it is about the pilot rather than
  // about the map.
  const liveShare = useLiveShare({ coords: pos, recording })
  const friendsAloft = useFriendsAloft(layers.friends)

  // What the drawer is telling the pilot to do next.
  //
  // Only at the resting stop, and only for as long as it takes to be read.
  // Higher up the drawer's own contents reach the bottom of the screen, and a
  // line laid over them would be sitting on the aircraft.
  //
  // Declared here rather than up with the other route derivations: it reads
  // `recording`, which is defined on the line above, and a const cannot be
  // read before it is initialised. Putting it earlier took the whole screen
  // down with a temporal dead zone error.
  // Nothing to say while a route is on the drawer: the strip and its figures
  // are the drawer's statement, and the hint was printing itself across VAR.
  const gestureHint = planning || snap !== 25 || hasRoute ? ''
    : recording ? 'Recording your track · tap the square to end and log it'
    : 'Pull up for everything else'
  const track = rec?.track?.map(p => [p.lat, p.lon]) ?? []

  // The viewport, and how much of it the drawer covers at rest. Declared here
  // rather than with the rest of the sheet geometry below because the chip
  // stack reads it, and a const cannot be read above its own line.
  const vh = viewportH
  // 25 is 25. The ladder is 0 / 25 / 50 / 80 / 100 and nothing gets to bend
  // it: a stop the pilot named is a position, not a suggestion, and a drawer
  // that rests a little lower whenever it happens to be carrying something is
  // a drawer with no position at all. Content fits the stop; the stop does
  // not grow to the content.
  const restPx = vh - stopY(vh, 25)

  // The stops own their content, and this is what holds them to it.
  //
  // Each block below declares the stop it belongs to on an element it already
  // has, and when the drawer settles there the block is measured against the
  // room that stop actually gives it. Nothing is moved by any of this: it is a
  // development check, it is compiled out of the shipped app, and its whole
  // job is to make "the tools grid lives at 80" a fact the code enforces
  // rather than a coincidence of whatever happens to sit above it.
  //
  // Skipped while a tool screen has the drawer. Those are screens borrowing
  // the room, with their own scrolling and their own idea of how tall they
  // are, and they are not the drawer saying what it is for.
  const declareStop = useStopAudit({
    sheetRef, vh, snap, enabled: import.meta.env.DEV, skip: !!drawerView,
  })
  // Composed rather than replacing: this element is already measured for the
  // photograph's height. Both refs are stable, so the pair is too, and the
  // ResizeObserver underneath is not rebuilt on every render.
  const grabAudit = declareStop(25, 'drawer header (actions, route)')
  const grabAndAudit = useCallback((node) => {
    grabRef(node)
    grabAudit?.(node)
  }, [grabRef, grabAudit])

  // Where the bottom of the chip stack sits: clear of the sheet, then clear of
  // the two map controls, so the chips rest on top of the layers button that
  // opens them. Kept as a bare expression rather than a finished calc() because
  // it is used twice, once as an offset and once subtracted from the available
  // height, and calc() nests but does not concatenate.
  //
  // No safe-area term any more. The resting height is a fraction of the
  // viewport, and the viewport already ends at the bottom of the screen, so
  // the inset is inside the 30 rather than added to it.
  const chipStackBottom = sheetOpen
    ? `${restPx}px + ${recording ? 132 : 16}px + ${CTRL_STACK_H}px`
    : `var(--safe-bottom) + 28px + ${CTRL_STACK_H}px`

  // How tall the card at the top may get before it starts hiding things.
  //
  // One tap opens both halves of it, conditions and the field under the map,
  // and at a large airport that is four hundred pixels of content: three
  // runways, six frequencies, a chart button and two source lines. Left to
  // grow it runs under the action row floating above the drawer, and the
  // button it was offering ends up behind the record button. So it stops at
  // the action row and scrolls inside itself instead.
  //
  // Measured, not dvh. The shell's own height is the only number on this
  // screen that tells the truth in the iOS web clip.
  const topCardMaxH = Math.max(
    170,
    Math.round(vh
      - ((planning ? vh - stopY(vh, 50) : restPx) + (recording ? 132 : 0) + 10 + ACTION_ROW_H)
      - safeTop - 10 - 12),
  )

  // The sheet is always the full height of the screen and is moved down out of
  // the way, rather than being resized. Animating transform is cheap and never
  // reflows its contents; animating height would relayout the whole list on
  // every frame of a drag.
  //
  // y is the distance from the top of the screen to the top of the sheet, so
  // 0 is full screen and larger numbers are further down.
  // One line each way now that a stop is a number: where the drawer is
  // resting, and where it is actually drawn once a finger is on it.
  const restY = stopY(vh, snap)
  // The keyboard does not move the shell, so it cannot be allowed to move the
  // stops, but it does cover the bottom of it. The drawer rises by exactly
  // what is covered, never past the top of the screen, so the field being
  // typed into stays in the part of the shell still visible. Without this the
  // stops are right and the plan sits entirely behind the keyboard.
  const liftedY = Math.max(0, restY - kbInset)
  const y = dragY != null ? dragY : liftedY
  // What is left of the shell once the keyboard has taken its share. The
  // planner's column is sized from this rather than from the full height, or
  // it runs down behind the keyboard and takes its buttons with it.
  const visibleH = vh - kbInset

  // How tall the aircraft's photograph is allowed to be.
  //
  // Not a constant, and not a share of the drawer either, because neither can
  // know what else is in the drawer. The header above the body changes height
  // with what it is carrying: at 50 it holds the actions AND the route card,
  // 244px of a 406px drawer, which leaves 162 for everything below. A 210px
  // photograph in 162px of space pushed the aircraft's name off the bottom of
  // the screen, and the name is the part of a portrait a pilot actually reads.
  //
  // So it is measured. What the drawer shows, minus the header, minus the
  // name and registration, is what the picture may have, and it still reaches
  // its full 210 once the drawer is tall enough to afford it.
  //
  // The subtraction is against the VISIBLE drawer rather than the body's own
  // box, which is a different number: the column is the full height of the
  // shell and hangs below the screen, so the body measures 568 while 162 of
  // it is on screen. Laying out against the box is exactly how the name ended
  // up somewhere nobody could see it.
  // The home indicator comes off the top of it. The body's own bottom padding
  // already clears the inset, but that padding sits at the bottom of a box
  // that hangs below the screen, so at 50 it is nowhere near the edge the
  // content is actually being cut at.
  const bodyVisibleH = Math.max(0, (visibleH - liftedY) - grabH - safeBottom)
  const acImgCap = Math.max(0, Math.min(210,
    Math.round(bodyVisibleH - acTextH - BODY_PAD_TOP - AC_IMG_GAP - AC_BREATHING)))

  // Declared below restY rather than with the other map effects: it reads it,
  // and a const cannot be read before it is initialised. Placed above, the
  // dependency array alone took the whole home screen to a blank page.
  // Frame a new route once. The plan is what the map is being looked at for
  // the moment one exists, so it takes the camera from the base framing above
  // rather than being drawn somewhere off the edge of a map still centred on
  // home. Keyed on the route's own endpoints, so panning away afterwards
  // stands: only a different route moves the camera again.
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
      // Measured from where the drawer is actually resting rather than
      // assumed to be the collapsed height. While a route is being confirmed
      // the drawer stands more than twice as tall, and fitting to the
      // collapsed figure put the far end of the route behind it.
      paddingBottomRight: [40, Math.max(0, vh - restY) + 40],
      // Not animated, and not for want of polish. Flying the camera to a route
      // restored at mount left the basemap blank: Leaflet ran the zoom
      // animation and never fetched tiles for where it landed, so the line was
      // drawn over nothing at all. Cutting straight to the framing loads them
      // every time. A map with no map on it is not a trade worth making for a
      // half-second glide.
      animate: false,
    })
  }, [routeLine, mapReady, vh, restY])

  // Corners square off as the sheet approaches the top, rather than snapping
  // from rounded to square at the end of the animation. Interpolated over the
  // last stretch only, so it reads as the sheet meeting the screen edge.
  const radius = radiusFor(vh, y)

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
      if (d.fromBody && snap === 100 && !(d.atTop && dy > 0)) {
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
    //
    // The ends are the ends of the ladder, 25 and 100, whatever the drawer is
    // carrying. The plan used to be clamped at 50, from when it owned the
    // drawer; with its list under the route the finger stopping dead halfway
    // up is the drawer refusing to move.
    const next = Math.min(stopY(vh, 25), Math.max(stopY(vh, 100), d.fromY + shifted))
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
    const flick = isFlick(ms, dist)
    setDragY(null)

    if (isFullPull(vh, d.lastY)) { setSnap(100); return }

    // One ladder, whatever the drawer is carrying: 25, 50, 80, 100. The
    // positions are the positions.
    //
    // The plan used to have a ladder of its own with a single rung at 50,
    // from the days when opening it swapped the drawer's contents out: there
    // was nothing above 50 worth going to, and a pull down put the plan away.
    // Now the plan comes up underneath the route in the same drawer, so a
    // rung it cannot reach is just a drawer that will not move, and pulling
    // down means what it means everywhere else, which is a smaller drawer.
    // Leaving the plan is the X's job.
    const target = flick
      ? flickTarget(snap, up, SHEET_STOPS)
      : nearestStop(vh, d.lastY, SHEET_STOPS)

    // Pulling a route open opens its flight plan.
    //
    // With a route on the drawer, the drawer IS that route: the ends at rest,
    // and everything else there is to say about it one drag further. Landing
    // on the tools grid instead would be answering a question nobody asked
    // while the flight sits there half-read.
    //
    // The tap on the handle still goes to 80, so the aircraft, the tools and
    // the logbook keep a gesture of their own rather than becoming unreachable
    // for as long as a route exists. Drag for the flight, tap for the rest.
    // The stop the drag actually asked for, not a fixed one. A hard pull from
    // 25 that lands on 80 opened the plan at 50 and threw the other 30 away,
    // which is the drawer ignoring the gesture that opened it.
    if (actionsFloat && snap === 25 && target > 25) { openPlanner(target); return }

    setSnap(target)
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
  // compact shrinks the row rather than the card: a fit-content card around an
  // 86px record button is not compact, it is the same card with less padding.
  // The tile's 92px belongs to its label, so it goes when the label does. Left
  // on, it padded a fit-content card back out to nearly the full width, which
  // is a compact card in every respect except the one that was asked for.
  // What each assignable action actually does, and what it looks like while it
  // is doing it. Only three of these change with the state of the screen:
  // record becomes stop, and plan becomes close or clear depending on whether
  // there is a plan and whether the pilot is standing in it, so the row never
  // holds a button that would do nothing.
  function actionSpec(key) {
    const meta = findAction(key)
    if (!meta) return null
    if (key === 'weather') {
      return {
        label: 'Weather', icon: <IconWeather />,
        run: () => (base ? setWxDetail(true) : setBasePicker(true)),
      }
    }
    if (key === 'record') {
      return {
        label: recording ? 'Stop' : 'Record', accent: true,
        icon: recording
          ? <svg width="26" height="26" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
          : <svg width="30" height="30" viewBox="0 0 24 24" fill="#fff"><path d="M8 5.5v13l11-6.5z" /></svg>,
        run: () => (recording ? stopFlight() : startFlight()),
      }
    }
    if (key === 'plan') {
      return {
        label: planning ? 'Close Plan' : hasRoute ? 'Clear Route' : 'Plan Route',
        icon: planning || hasRoute ? <IconClosePlan /> : <IconRoute />,
        run: () => (planning ? leavePlanner() : hasRoute ? forgetRoute() : openPlanner()),
      }
    }
    return {
      label: meta.label,
      icon: ACTION_ICONS[key] ?? <IconRoute />,
      run: () => setDrawerView(meta.view),
    }
  }

  // Press and hold to reassign, the way a phone's home screen works. The hold
  // is what makes the row discoverable without a settings trip; Settings has
  // the same list for anyone who looks there first.
  //
  // A hold must not also fire the tap. holdFired is checked by the click
  // handler rather than the press being cancelled, because a pointerup still
  // produces a click and swallowing it in the capture phase would swallow the
  // scroll gestures this row sits inside.
  const holdTimer = useRef(null)
  const holdFired = useRef(false)
  function holdProps(slot) {
    const start = () => {
      holdFired.current = false
      clearTimeout(holdTimer.current)
      holdTimer.current = setTimeout(() => {
        holdFired.current = true
        setSlotPicker(slot)
      }, 500)
    }
    const cancel = () => clearTimeout(holdTimer.current)
    return {
      onPointerDown: start,
      onPointerUp: cancel,
      onPointerLeave: cancel,
      onPointerCancel: cancel,
      // A hold on a button is not a text selection, and on iOS the callout it
      // raises lands on top of the picker the hold just opened.
      onContextMenu: e => e.preventDefault(),
      style: { WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' },
    }
  }

  const actionRow = (compact = false) => (
    <div style={{
      display: 'flex', alignItems: 'center',
      justifyContent: compact ? 'center' : 'space-around',
      gap: compact ? 18 : 10,
    }}>
      {homeActions.map((key, slot) => {
        const spec = actionSpec(key)
        if (!spec) return null
        const hold = holdProps(slot)
        const fire = () => { if (!holdFired.current) spec.run() }
        // The middle slot keeps the big accent circle. It is the one the thumb
        // lands on without aiming, so it stays the emphasised one whatever is
        // assigned to it rather than the emphasis belonging to recording.
        if (slot === 1) {
          return (
            <button key={key} onClick={fire} {...hold} title={`${spec.label} (hold to change)`}
              style={{
                ...hold.style,
                width: compact ? 52 : 86, height: compact ? 52 : 86,
                borderRadius: '50%', border: 'none', cursor: 'pointer',
                background: spec.accent && recording ? 'var(--map-ink)' : ACCENT,
                boxShadow: `0 6px 20px ${spec.accent && recording ? 'rgba(28,28,30,0.3)' : accentAlpha(0.38)}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background 200ms', flexShrink: 0,
                color: '#fff',
              }}>
              {spec.icon}
            </button>
          )
        }
        return (
          <button key={key} onClick={fire} {...hold} title={`${spec.label} (hold to change)`}
            style={{ ...tileBtn, ...hold.style, ...(compact ? { width: 38 } : null) }}>
            <span style={{ ...tileCircle, background: 'var(--map-fill)', color: 'var(--map-ink)',
              ...(compact ? { width: 38, height: 38 } : null) }}>
              {spec.icon}
            </span>
            {!compact && <span style={tileLabel}>{spec.label}</span>}
          </button>
        )
      })}
    </div>
  )

  return (
    // Fixed to the viewport rather than flowing in the shell: the map is the
    // screen here, and it has to reach every edge including under the status
    // bar and the home indicator. body is the containing block, which is what
    // makes this land on the real screen bottom.
    <div ref={shellRef} style={{
      position: 'fixed', inset: 0, background: 'var(--bg)', overflow: 'hidden',
      // What the sheet is covering, published so a bottom-anchored control can
      // sit above it rather than under it. Only the data bar reads this here.
      '--map-bottom-inset': `${sheetOpen ? restPx : 0}px`,
    }}>
      {/* The flat map, wrapped so it can be hidden as a whole.
          MapContainer reads its own `style` prop once at mount and never
          again, so hiding it through that prop did nothing: the Leaflet route
          went on drawing over the tilted view. The wrapper is plain DOM and
          answers every render. Hidden rather than unmounted, because tearing
          Leaflet down would throw away the camera, the layers and the route
          editor for what is a change of view. */}
      <div style={{
        position: 'absolute', inset: 0,
        visibility: view3d ? 'hidden' : 'visible',
      }}>
      {/* The rotating canvas. A diagonal-sized square centred on the viewport,
          CSS-rotated by -bearing so the ground track points screen-up in the
          Track Up modes; the transition keeps GPS heading jitter from twitching
          the whole world. Everything that must NOT rotate (the sheet, the
          chips, the buttons, the data bar) lives outside this div, which is why
          it wraps the map alone rather than the screen. */}
      <div style={{
        position: 'absolute', left: '50%', top: '50%',
        width: canvasSize, height: canvasSize,
        marginLeft: -canvasSize / 2, marginTop: -canvasSize / 2,
        transform: `rotate(${-bearing}deg)`, transformOrigin: '50% 50%',
        transition: 'transform 0.8s linear',
      }}>
      <MapContainer center={INITIAL_CENTER} zoom={10} zoomControl={false} attributionControl={false}
        style={{ height: '100%', width: '100%' }}>
        <SizeWatcher mapRef={mapRef} onReady={onMapReady} onMove={setMapCentre} />
        {layers.traffic && (
          <TrafficLayer snapshot={traffic.snapshot} onSelect={setSelected} filter={tfcFilter} />
        )}
        <Basemap dark={darkBasemap} />
        <ChartLayers layers={layers} openaipKey={openaipKey} tfrData={tfrData}
          onFocusField={setFocusField}
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
        {/* The line is the editor now: hold it to bend it, tap a turning point
            to take it out. Same gestures ForeFlight and Garmin Pilot use, and
            the same hold the route strip uses to pick up a chip. */}
        {routeLine.length > 1 && (
          <RouteLineEditor
            positions={routeLine}
            middleNames={routeMiddleNames}
            depIdent={route.dep}
            destIdent={route.dest}
            onInsert={addDroppedWaypoint}
            onRemove={removeRouteWaypointAt}
          />
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
            {/* The label is dropped when the route already carries it. Flying
                from home means the departure marker and the home marker are the
                same place with the same name, and both were labelling it: two
                copies of KRNO four pixels apart, which reads as a rendering
                fault rather than as emphasis. The aircraft mark stays either
                way, so home is still marked as home. */}
            {!routeEndLabels.has(base.ident) && (
              <Tooltip permanent direction="top" offset={[0, -14]} className="home-base-label">
                {base.ident}
              </Tooltip>
            )}
          </Marker>
        )}
        {/* The trail the pilot asked for, under the ownship so the aircraft is
            never hidden by where it has been. */}
        {layers.breadcrumbs && <BreadcrumbLayer trail={breadcrumbTrail} />}
        {layers.friends && <FriendsLayer friends={friendsAloft} />}
        {/* Ownship when the GPS reports a ground track (moving); the plain dot
            when stationary, since a parked aircraft has no meaningful
            nose-direction from GPS alone. The icon's rotation is
            screen-relative: ground track minus however far the map itself is
            rotated, so in Track Up it points straight up. */}
        {pos && pos.headingDeg != null ? (
          <Marker position={[pos.lat, pos.lon]} icon={ownshipIcon(pos.headingDeg - bearing)} interactive={false} />
        ) : pos && (
          <CircleMarker center={[pos.lat, pos.lon]} radius={8}
            pathOptions={{ color: '#fff', weight: 3, fillColor: '#1d7fff', fillOpacity: 1 }} />
        )}
        {/* The last position we had, drawn grey and plainly not current. A fix
            that has aged out is orientation, not truth. */}
        {!pos && lastKnown && (
          <CircleMarker center={[lastKnown.lat, lastKnown.lon]} radius={8}
            pathOptions={{ color: '#fff', weight: 3, fillColor: '#9a9aa2', fillOpacity: 0.85 }} />
        )}
        <FollowController
          follow={follow} orientation={orientation} fix={pos} bearing={bearing}
          coveredHeight={restPx} onUserDrag={handleUserDrag}
        />
      </MapContainer>
      </div>
      </div>

      {/* The tilted view, filling the map area and nothing else.
          After the flat map in the DOM and above it in the stack, but below
          500, which is where every piece of chrome starts: the drawer, the
          strip, the chips and the pill all stay exactly where they were,
          because they describe the same flight however the ground is drawn.
          Mounted only while on, so the second engine exists only when asked
          for; keyed on the route so a leg added while it is open redraws. */}
      {view3d && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 2 }}>
          <Map3DPane
            key={routeLine.length > 1 ? JSON.stringify(routeLine) : 'no-route'}
            route={route} centre={mapCentre} zoom={mapRef.current?.getZoom()}
            // The app's theme, not darkBasemap. That flag exists to yield to
            // the FAA charts, which are Leaflet layers and are not drawn over
            // this view at all, so here it would only make the tilted map go
            // light because a sectional the pilot cannot currently see is on.
            dark={isDark}
            onFail={() => setView3d(false)} />
        </div>
      )}

      {/* Top row: get the furniture out of the way, and the one reading a pilot
          opens the app for. The menu home showed conditions on arrival and the
          map home has to keep doing that, or weather becomes something you go
          looking for rather than something you are told. */}
      <div style={{ position: 'absolute', top: 'calc(var(--safe-top) + 10px)', left: 14, zIndex: 501 }}>
        <Ctrl onClick={() => setSnap(s2 => (s2 === 0 ? lastStop.current : 0))} title={sheetOpen ? 'Hide panel' : 'Show panel'} size={46}>
          <IconArrow up={!sheetOpen} />
        </Ctrl>
      </div>

      {/* Centred on the screen rather than laid out beside the arrow, so the
          conditions sit where the eye lands instead of being pushed off centre
          by whatever happens to be to their left. The margins keep it clear of
          the arrow on a narrow phone; past that the text ellipses.

          The padding is 64 rather than 74 because this box carries the field
          the map is over as well as the conditions at the base. The card
          inside caps its own width, so the extra ten pixels are room the
          opened panel can use without the resting pill reaching the arrow. */}
      <div style={{
        position: 'absolute', top: 'calc(var(--safe-top) + 10px)', left: 0, right: 0,
        zIndex: 500, display: 'flex', justifyContent: 'center',
        padding: '0 64px', pointerEvents: 'none',
      }}>
        <div style={{ pointerEvents: 'auto', minWidth: 0 }}>
          <WeatherRibbon
            icao={base?.ident ?? null} units={units}
            onChangeAirport={changeBase}
            detailOpen={wxDetail} onDetailChange={setWxDetail}
            style={{ maxHeight: topCardMaxH }}
            expanded={topOpen} onExpandedChange={setTopOpen}
            // What the card has left once its one visible row is in it.
            bodyMaxH={Math.max(140, topCardMaxH - TOP_CARD_HEADER_H)}
            // The aerodrome under the map, in the lower half of that same
            // expansion rather than as a pill, or a row, of its own. Absent
            // above the runway layer's zoom floor, and while the tilted view is
            // up, where the runways this describes are not drawn.
            below={focusField && !view3d
              ? <AirportPlate field={focusField} onOpenChart={setChartOpen} inline
                  // Only so the frequency pack is fetched on the tap that
                  // reveals this rather than on the pan that found the field.
                  // With no home airport there is no expansion to tap: the
                  // card is the plate, and it is open on sight.
                  expanded={topOpen || !base?.ident} />
              : null} />
        </div>
      </div>

      {/* A flight the app caught by itself has to say so. Recording silently
          and filing silently means the pilot's first hint is a logbook entry
          they did not make, which reads as the app inventing flights rather
          than as it having been paying attention. */}
      {flightSaved && (
        <div style={{
          position: 'absolute', left: 14, right: 14, zIndex: 620,
          top: 'calc(var(--safe-top) + 68px)',
          background: 'var(--map-ink)', color: 'var(--map-ink-invert)',
          borderRadius: 16, padding: '12px 14px',
          boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
          fontSize: 13, fontWeight: 700, lineHeight: 1.35,
        }}>
          Flight recorded. It is waiting under Pilot for you to review before it
          goes in the logbook.
        </div>
      )}

      {/* The flight data computer: the figures a pilot configures once and
          then reads without looking for them. Hidden while the sheet is
          expanded, on the same rule the control stack follows, because at that
          point the pilot is reading the plan rather than flying the map.

          Fed routeWpts rather than the route object: the bar's next-waypoint
          and destination fields walk a list of points, and that is the list
          the map is actually drawing. */}
      {!expanded && (
        <GpsInfoBar route={routeWpts} coords={pos} derived={liveDerived}
          status={liveStatus} lastKnown={lastKnown} />
      )}

      {/* Right stack: charts, then position. Ordered by how often a hand
          reaches for them in the air. */}
      <div style={{
        position: 'absolute', right: 14, zIndex: 500,
        bottom: sheetOpen
          ? `${restPx + (recording ? 132 : 16)}px`
          : 'calc(var(--safe-bottom) + 28px)',
        display: 'flex', flexDirection: 'column', gap: 12,
        transition: 'bottom 280ms cubic-bezier(0.4,0,0.2,1), opacity 200ms',
        opacity: expanded ? 0 : 1,
        pointerEvents: expanded ? 'none' : 'auto',
      }}>
        {/* Only in manual mode, because in every other mode this button would
            be a control that does not control anything: the answer is already
            decided by whether a recording is running, or by the app being
            open. Hidden rather than disabled for the same reason. */}
        {liveShare.mode === 'manual' && liveSharingAvailable() && (
          <Ctrl onClick={() => liveShare.setGoLive(v => !v)}
            active={liveShare.sharing}
            caption={liveShare.sharing ? 'LIVE' : null}
            title={liveShare.sharing
              ? 'You are visible to your friends. Tap to stop'
              : 'Show your position to your friends'}>
            <IconFriendsCtrl />
          </Ctrl>
        )}
        <Ctrl onClick={() => { setChartsOpen(o => !o); setChartsEverOpened(true) }} title="Chart layers"
          active={chartsOpen} badge={activeCount}><IconLayers /></Ctrl>
        <Ctrl onClick={locate} active={follow}
          caption={follow && orientation === 'track' ? 'TRK' : follow && orientation === 'trackAhead' ? 'TRK▲' : null}
          title={!follow ? 'Center on my position and follow'
            : orientation === 'north' ? 'Following, North Up. Tap for Track Up'
            : orientation === 'track' ? 'Following, Track Up. Tap for Track Up Ahead'
            : 'Following, Track Up Ahead. Tap for North Up'}>
          <IconLocate />
        </Ctrl>
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
          {chipDefs.map((c, i) => (
            <button key={c.key} className="chart-chip"
              title={c.view ? 'Tilted view with buildings. Not terrain.' : undefined}
              onClick={() => (c.view ? setView3d(v => !v) : toggleLayer(c.key))} style={{
              background: (c.view ? view3d : layers[c.key]) ? 'var(--map-ink)' : 'var(--map-panel)',
              color: (c.view ? view3d : layers[c.key]) ? 'var(--map-ink-invert)' : 'var(--map-ink)',
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
                ? `${(chipDefs.length - 1 - i) * 16}ms`
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
        bottom={`${restPx + 10}px`}>
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

      {/* The actions, whenever the drawer has something of its own to say:
          the flight plan, the read-back, or a route on the collapsed drawer.
          Same card, same three buttons, moved onto the map so the subject is
          not paying for them with the top of its own space.

          One card rather than three, so it slides between the three heights
          instead of one disappearing and another arriving in a different
          place.

          Above half screen it does not float and it is not in the drawer
          either: there is no map left to float over, and the drawer is what
          the pilot asked to see all of. See actionsFloating above. */}
      <FloatingCard
        visible={actionsFloating}
        // Compact wherever it floats, with no exception for the planner.
        //
        // The planner kept the wide card on the argument that its stop is fixed
        // at half the screen whether or not the card above it is wide, so the
        // width cost nothing. It does not: the planner's half is the half a
        // route is being drawn across, and a full-width slab with two labels on
        // it was taking a third of what was left to look at. The other two read
        // as one object moving between heights, and this one read as a
        // different card arriving.
        // Hugging its own width wherever it floats. A card as wide as the
        // drawer put its three buttons a third of a screen apart and read as
        // a bar of its own rather than as the small control that belongs to
        // the card below it.
        compact
        // Above whichever stop the drawer is at, and above the recording stats
        // when those are out too, rather than on top of them. One expression
        // for both heights now that the stop is the only thing that decides it,
        // so the card slides between them instead of jumping.
        bottom={`${vh - stopY(vh, Math.min(snap, 50)) + (snap === 25 && recording ? 132 : 0) + 10}px`}>
        {actionRow(true)}
      </FloatingCard>

      {/* The one line the drawer says about itself, on the floor of the
          screen rather than tucked under the route.

          It sits in the shell, not in the drawer, because the drawer's box is
          a full screen tall and hangs below the fold: its own bottom edge is
          nowhere near the one a pilot can see. Anchored here it lands on the
          real bottom, in the room the resting stop has spare. */}
      {gestureHint && (
        <div style={{
          // Above the drawer, which is 600. The line lands in the drawer's
          // own empty bottom, so it has to paint on top of it rather than
          // underneath, which is where 560 put it: correctly positioned and
          // completely invisible.
          position: 'absolute', left: 0, right: 0, zIndex: 620,
          bottom: 'calc(var(--safe-bottom) + 4px)',
          textAlign: 'center', pointerEvents: 'none',
        }}>
          {/* Keyed on the words, so a hint that changes is a hint that gets
              said again rather than one that quietly swapped its text while
              nobody was looking at it. */}
          <span key={gestureHint} className="hint-bounce" style={{
            fontSize: 11, fontWeight: 600, color: 'var(--map-ink-faint)',
          }}>{gestureHint}</span>
        </div>
      )}

      {/* Traffic, and the selected aircraft. Present only while the layer is
          on, because a warning about data that is not on screen is noise, and
          absent once the sheet is expanded so it does not fight the logbook
          for the same space.

          The same card the recording stats use, in the same place and at the
          same width, because it is the same kind of thing: what is happening
          right now, said above the drawer rather than over the map. It was a
          300px panel in the bottom left corner with a paragraph of warning in
          it, which covered a quarter of the map at the exact moment the pilot
          had asked to look at the map. */}
      <FloatingCard
        visible={layers.traffic && !expanded}
        bottom={`${restPx + (recording ? 132 : 10)}px`}>
        {/* Mounted with the layer, not with the card. FloatingCard always
            renders its children and animates the box around them, which is
            right for the fade out when the drawer takes the screen, and wrong
            for a layer that is off: the strip would sit in the DOM invisible,
            ticking its one-second age clock forever, for a pilot who has never
            turned traffic on. */}
        {layers.traffic && (selected ? (
          <SelectedAircraft ac={selected} onClose={() => setSelected(null)} />
        ) : (
          <TrafficLegend
            meta={traffic.meta}
            filter={tfcFilter}
            onFilter={setTfcFilter}
            lightCount={traffic.meta.lightCount}
            onClose={() => toggleLayer('traffic')} />
        ))}
      </FloatingCard>

      {basePicker && createPortal(
        <AirportPickerModal
          onConfirm={(id) => { setBasePicker(false); changeBase(id) }}
          onClose={() => setBasePicker(false)} />,
        document.body,
      )}

      {/* What a held button offers. A sheet from the bottom rather than a menu
          at the finger: the row sits low on the screen already, and a menu
          hanging off it would open under the thumb that raised it.

          Portalled to body for the same reason the airport picker is. This
          screen is a fixed box with its own stacking context, and a chooser
          that has to cover the drawer cannot live inside the drawer. */}
      {slotPicker != null && createPortal(
        <div
          onClick={() => setSlotPicker(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1500, background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'flex-end',
          }}>
          <div onClick={e => e.stopPropagation()} style={{
            ...DRAWER_PALETTE,
            width: '100%', background: 'var(--map-panel)',
            borderTopLeftRadius: 22, borderTopRightRadius: 22,
            padding: `18px 18px calc(var(--safe-bottom) + 18px)`,
            maxHeight: '70vh', overflowY: 'auto',
          }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--map-ink)', marginBottom: 4 }}>
              {['Left button', 'Middle button', 'Right button'][slotPicker]}
            </div>
            <div style={{ fontSize: 12, color: 'var(--map-ink-faint)', marginBottom: 14 }}>
              Hold any of the three to change it.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {HOME_ACTIONS.map(a => {
                const current = homeActions[slotPicker] === a.key
                return (
                  <button key={a.key} onClick={() => assignSlot(slotPicker, a.key)} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '13px 14px',
                    borderRadius: 16, cursor: 'pointer', textAlign: 'left',
                    border: current ? `2px solid ${ACCENT}` : '2px solid transparent',
                    background: 'var(--map-fill-soft)',
                    color: 'var(--map-ink)', fontSize: 13, fontWeight: 700,
                  }}>
                    <span style={{ display: 'flex', flexShrink: 0, width: 24, height: 24,
                      alignItems: 'center', justifyContent: 'center' }}>
                      {ACTION_ICONS[a.key] ?? null}
                    </span>
                    {a.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* The official airport diagram, over everything. A chart is read at
          arm's length with both hands, so it takes the whole screen rather
          than sharing it with the map that led to it. Portalled to body for
          the same reason the airport picker is: this screen is a fixed box
          with a drawer stacked in it, and a chart has to escape both. */}
      {chartOpen && createPortal(
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1400,
          background: 'var(--bg)', overflowY: 'auto',
          paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)',
        }}>
          <Suspense fallback={
            <div style={{ padding: '80px 20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 14 }}>
              Loading chart…
            </div>
          }>
            <ProcedureChartViewer
              icao={chartOpen.icao} cycle={chartOpen.cycle}
              chartName={`${chartOpen.icao} ${chartOpen.label}`} pdfName={chartOpen.pdf}
              onBack={() => setChartOpen(null)} />
          </Suspense>
        </div>,
        document.body,
      )}

      {/* The sheet. Collapsed it is the actions; dragged up it is the rest of
          the app; and while a flight is being planned it is the flight plan,
          resting at half the screen so the map stays in view above it. Resting
          heights and nothing in between, because a control surface that stops
          wherever the finger left it is a surface you have to aim at. */}
      <div ref={sheetRef} style={{
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
        // Measured from where the drawer is drawn to where the keyboard
        // starts, so a lifted drawer gets the taller column it has earned
        // rather than one still sized for the stop it left.
        height: planning ? `${Math.max(0, visibleH - liftedY)}px` : '100%',
      }}>

        {/* The grab area: handle and actions. Dragging anywhere on this moves
            the sheet, which is a bigger target than the handle alone and is
            what people reach for anyway. */}
        {/* THE 25 BLOCK. What is true at a glance: the flight category and the
            code above, the three actions, and the route if there is one. All
            of it has to fit in the resting stop, and the audit says so out
            loud when it stops fitting. */}
        <div
          ref={grabAndAudit}
          onPointerDown={onDragStart} onPointerMove={onDragMove}
          onPointerUp={onDragEnd} onPointerCancel={onDragEnd}
          style={{
            flexShrink: 0, touchAction: 'none', cursor: 'grab',
            // At full screen the sheet is under the status bar, so it has to
            // clear the notch itself. Below that the map is up there and this
            // padding would just be a gap.
            paddingTop: snap === 100 ? 'calc(var(--safe-top) + 10px)' : 10,
            paddingLeft: 18, paddingRight: 18,
            transition: 'padding-top 380ms cubic-bezier(0.32,0.72,0,1)',
          }}>
          <div
            onClick={() => {
              // Nothing to toggle while planning: the planner has one stop.
              // Tapping the handle used to take it to full screen, which is
              // the thing the plan is no longer allowed to do.
              if (planning) return
              // Deliberately not the flight plan, even with a route on the
              // drawer. Dragging opens the route; tapping opens the drawer.
              // Two gestures, two destinations, and nothing that needs a
              // route cleared before it can be reached.
              setSnap(s2 => (s2 === 25 ? 80 : 25))
            }}
            style={{
              width: 40, height: 5, borderRadius: 3, background: 'var(--map-hairline)',
              margin: planning ? '0 auto 8px' : '0 auto 14px', cursor: 'pointer',
            }} />

          {/* Weather, opposite the route planner. These are the two things a
              pilot does before a flight, so they flank the one thing they do
              during it. The aircraft keeps its place in the tools grid below;
              it is set once and rarely changed, which is not what a slot on
              the main surface is for.

              Here in one case only: the drawer resting with nothing of its own
              to say. That is the screen a pilot opens the app to, and the row
              is what it is for.

              Every other height moves it off this surface, and above half the
              screen it is nowhere at all rather than back here on top of the
              plan. See actionsInDrawer, where the whole rule is written out. */}
          {actionsInDrawer && actionRow()}

          {/* A route exists, so the drawer says so: it is the only thing that
              says what the line across the map is.

              At rest it lives up here in the grab area, filled to the stop, and
              a finger anywhere on it moves the sheet. With the plan open it
              moves down into the plan's own scroller instead, because there it
              is the top of a document rather than a fixed header: see below. */}
          {hasRoute && !planning && (
            <RouteSummary route={route} flight={flightFigures}
              onOpen={openPlanner} onRemoveLeg={removeRouteLeg}
              onRemoveEnd={removeRouteEnd}
              onReorder={reorderRouteLeg} onAddStop={addRouteStop} onFocusPoint={focusRoutePoint}
              fillTo={snap === 25
                // The hint's reserve only when there is a hint. It goes quiet
                // while a route is on the drawer, and 28px was still being
                // held back for a line that no longer renders, which is 28px
                // taken off the card that replaced it.
                ? Math.max(0, restPx - GRAB_ABOVE_ROUTE - 10 - safeBottom - (gestureHint ? HINT_RESERVE : 0))
                : 0} />
          )}
        </div>

        {/* The flight plan itself, filling what is left of the drawer. Mounted
            only while planning, so leaving it is what unmounts the megabyte of
            planner and its Leaflet previews rather than leaving them running
            under a map that is already drawing one.

            One scroller, and everything the plan is made of inside it: the
            route, its figures, the flight rules, then the steps. They used to
            be two surfaces, the first three nailed to the top of the drawer and
            the steps scrolling underneath them, so opening a step slid the form
            up under the rules row. They are one sheet and they move as one now,
            which is what the drawer looked like it was promising. */}
        {planning && (
          <div
            onPointerDown={onBodyDragStart} onPointerMove={onDragMove}
            onPointerUp={onDragEnd} onPointerCancel={onDragEnd}
            style={{
              flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
              // Scrolls once the drawer is the whole screen, exactly as the
              // tools list below does and for the same reason: below that there
              // is more sheet to open than plan to read, and a scroller here
              // would swallow the drag that opens it.
              overflowY: snap === 100 ? 'auto' : 'hidden',
              WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain',
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
              touchAction: snap === 100 ? 'pan-y' : 'pan-x',
            }}>
            {/* The route and the rules, at the top of the scroll rather than
                above it. Same card, same row, same handlers: only which
                surface they are on has changed, and it changed so that they
                scroll away with the plan instead of the plan sliding under
                them. */}
            {hasRoute && (
              <div style={{ padding: '0 18px', flexShrink: 0 }}>
                <RouteSummary route={route} flight={flightFigures}
                  onRemoveLeg={removeRouteLeg} onRemoveEnd={removeRouteEnd}
                  onReorder={reorderRouteLeg} onAddStop={addRouteStop}
                  onFocusPoint={focusRoutePoint} fillTo={0} />
              </div>
            )}
            {/* The rules, directly under the route, which is the whole point of
                them being here: the pilot sees the flight and what it is being
                filed as in one look, instead of answering the question on a
                screen that had hidden the route to ask it. */}
            <div style={{ padding: '14px 18px 0', flexShrink: 0 }}>
              <FlightRulesRow />
            </div>

            <Suspense fallback={
              <div style={{ padding: '40px 0', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, color: 'var(--map-ink-faint)' }}>
                Opening the flight plan…
              </div>
            }>
              {/* Its buttons only once the drawer is the whole screen. Below
                  that the route card is the subject and the sheet has no
                  height to spare for a footer. The title and its back button
                  are gone from the drawer at every height: see Checklists. */}
              <Planner embedded expanded={snap === 100}
                onClose={leavePlanner} onRouteCalculated={onRouteCalculated}
                onStepOpenChange={onStepOpenChange} />
            </Suspense>
          </div>
        )}

        {/* Everything else. Scrolls inside the sheet once expanded; inert while
            collapsed so a swipe there moves the sheet instead of the list.
            Gone entirely while planning, where the plan itself is what fills
            the drawer and carries the same handlers. */}
        {!planning && (
        <div
          ref={bodyRef}
          onPointerDown={onBodyDragStart} onPointerMove={onDragMove}
          onPointerUp={onDragEnd} onPointerCancel={onDragEnd}
          style={{
          flex: 1, minHeight: 0,
          // Scrolls only once the sheet is at full height. Below that there is
          // more sheet to open than list to read, so the gesture belongs to
          // the sheet and a scroller here would swallow it.
          overflowY: snap === 100 ? 'auto' : 'hidden',
          touchAction: snap === 100 ? 'pan-y' : 'none',
          WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain',
          padding: '6px 18px calc(var(--safe-bottom) + 24px)',
          // The tools grid fades out below the 25 stop, because down there the
          // drawer is the actions and the list behind them is not meant to be
          // read. A screen the pilot has deliberately opened is different: it
          // stays whatever height they drag it to, or dragging it down would
          // make the thing they just asked for disappear.
          opacity: (expanded || drawerView) ? 1 : 0,
          transition: 'opacity 200ms ease-out',
          pointerEvents: (expanded || drawerView) ? 'auto' : 'none',
        }}>
          {/* A screen, in the drawer, at the height the drawer already is.
              Everything below is what the drawer says when it is being itself.

              The palette is remapped on the wrapper so these screens read on
              glass instead of painting an opaque page inside it, and the
              horizontal padding is cancelled because each of them brings its
              own: they were written as pages and are still pages, only in a
              smaller room. */}
          {drawerView ? (
            <div style={{ ...DRAWER_PALETTE, margin: '0 -18px' }}>
              <Suspense fallback={
                <div style={{ padding: '40px 0', textAlign: 'center',
                  fontSize: 12, color: 'var(--map-ink-faint)' }}>
                  Opening…
                </div>
              }>
                {(() => {
                  const View = DRAWER_VIEWS[drawerView]
                  // onBack is passed where the component takes one, and the
                  // back override catches the rest. Both land on the same
                  // function, so it does not matter which a screen uses.
                  return View ? <View onBack={closeDrawerView} /> : null
                })()}
              </Suspense>
            </div>
          ) : (<>
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
          {/* THE 50 BLOCK. The aircraft the pilot is flying: the subject of
              whatever they are in the middle of, and the one thing at half
              height that is about this flight rather than about the app. */}
          <div ref={declareStop(50, 'aircraft')} style={{ marginBottom: 20 }}>
            <AircraftPanel
              ac={ac}
              aircraftId={aircraftId}
              currencyCards={currencyCards}
              imgCap={acImgCap}
              textRef={acTextRef}
              onOpenAircraft={() => navigate(ac?.id ? `/aircraft/${ac.id}` : '/aircraft')}
              onOpenPilot={() => setDrawerView('pilot')}
            />
          </div>

          {/* THE 80 BLOCK. A menu of next actions, which is what 80 is for:
              options to choose from rather than a task in itself. This is the
              one that used to be at 80 only by accident, because it was
              whatever was left after the aircraft above it. */}
          <div ref={declareStop(80, 'tools grid')}>
            {/* The rows that report something. Full width, because what makes
                them worth having is the live half on the right: the field's
                category and temperature, the medical, the fixes in the active
                plan, the messages waiting. A two-up grid has no room for any
                of that, which is why these are not in one. */}
            <AirportsHeroCard onOpen={openRow} />
            <HangarCard
              aircraftImage={ac?.image}
              activeAircraft={ac}
              aircraftCount={aircraftList?.length ?? 0}
              onOpen={openRow} />
            <PilotRow currencyCards={currencyCards} onOpen={openRow} />
            <FlightPlanCard route={fplRoute} onOpen={openRow} />
            <DiscoverCard onOpen={openRow} />

            {/* The rest stay two-up, in their own icons: they are doors, with
                nothing to report until they are opened. */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: ROW_GAP }}>
              {TOOLS.map(t => (
                <button key={t.view} onClick={() => setDrawerView(t.view)} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '14px 14px',
                  background: 'var(--map-fill-soft)', border: 'none', borderRadius: 16,
                  cursor: 'pointer', textAlign: 'left',
                }}>
                  {/* Tinted, not recoloured at the source. These are PNGs and a
                      stray SVG, black line art drawn back when this menu sat on
                      a white sheet, and there is no fill to set on an <img>.
                      The filter paints every opaque pixel the drawer's ink
                      colour, so they follow the theme the way the label beside
                      them does rather than being white in both. */}
                  <img src={t.icon} width={24} height={24} alt="" style={{
                    objectFit: 'contain', flexShrink: 0, filter: 'var(--map-icon-ink)',
                  }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--map-ink)', lineHeight: 1.25 }}>{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* THE 100 BLOCK. A list long enough to need its own scroll, which
              is the whole reason a full-screen stop exists. Declared but never
              measured: 100 is the stop that scrolls, so running past the
              bottom of the screen is what this block is supposed to do. */}
          <div ref={declareStop(100, 'logbook')}
            style={{ marginTop: 22, fontSize: 11, fontWeight: 700, letterSpacing: '0.6px',
            color: 'var(--map-ink-faint)', textTransform: 'uppercase' }}>
            {snap === 100 ? `Logbook · ${flights.length}` : 'Recent flights'}
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
              {(snap === 100 ? flights : flights.slice(0, 4)).map(f => (
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
          </>)}
        </div>
        )}
      </div>
      </div>

    </div>
  )
}
