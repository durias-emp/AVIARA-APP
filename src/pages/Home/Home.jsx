import { useState, useEffect, useRef, useMemo, useCallback, useContext } from 'react'
import { get, put } from '../../lib/db'
import { getCurrencyStatus } from '../../lib/currency'
import { computeTotalHours } from '../../lib/logbookFields'
import { useLogbook } from '../../context/Logbook'
import { loadWeather, parseFltCat, parseWind, parseVisib, parseTemp } from '../../lib/weather'
import { getCondition } from '../../components/WeatherAnimation'
import { loadAreaWeather, conditionFromArea, areaTemp, areaWind, areaVis } from '../../lib/areaWeather'
import { findAirport } from '../../lib/aerodromes'
import { usePilotProfile } from '../../context/PilotProfile'
import { useActiveAircraft } from '../../context/ActiveAircraft'
import AirportPickerModal from '../../components/AirportPickerModal'
import { OverlayCloseContext } from '../../context/OverlayClose'
import { BackOverrideContext } from '../../context/BackOverride'
import { useSwipeBack } from '../../hooks/useSwipeBack'
import MapView from '../../components/MapView'
import AirportInfo from '../../components/AirportInfo'
import ToolsMenu from '../../components/ToolsMenu'
import { HomeLocationProvider } from '../../context/HomeLocation'
import { IconAtom, IconGear, IconFriends, IconTower, IconHangar, IconHelmet, IconRoute, IconSky } from '../../components/Icons'
import { useAuth } from '../../context/AuthContext'
import { hasUnreadMessages } from '../../lib/messages'
import Checklists from '../Checklists/Checklists'
import Hangar     from '../Aircraft/Hangar'
import Settings   from '../Settings/Settings'
import Discover   from '../Discover/Discover'
import Pilot      from '../Pilot/Pilot'

// Uniform size for every hero button (Weather, Map, Airports, Hangar,
// Pilot, Flight Planning) and the Tools/Settings row — small enough that
// all seven rows plus the disclaimer text fit within one screen's height
// with no scrolling, on the shortest phones the app supports.
const HERO_HEIGHT = 64
const ROW_GAP = 8

/* ── The card shell every home row now shares ──────────────────────────
   Replaces five separate illustrated cards (painted airport scene, hangar,
   pilot, flight-plan desk, gradient) and their sideways labels. Those read
   as five unrelated posters; this reads as one instrument panel.

   Black with a hairline white border on purpose: over a map that is
   sometimes bright sectional and sometimes dark satellite, a black card is
   legible against both, and the hairline is what keeps its edge visible
   when the map behind it happens to be dark too.

   Fixed left half — glyph, then label — so the eye finds the same thing in
   the same place on every row. Everything live goes right, where the rows
   are free to differ. ── */
const CARD_BG = '#0d0d0f'
const CARD_BORDER = '1px solid rgba(255,255,255,0.18)'

function HeroCard({ Icon, label, sublabel, right, onOpen, ariaLabel }) {
  return (
    <div style={{ padding: `${ROW_GAP}px 18px 0` }}>
      <div onClick={onOpen} role="button" tabIndex={0} aria-label={ariaLabel}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
        style={{
          display: 'flex', alignItems: 'center', gap: 11,
          height: HERO_HEIGHT, boxSizing: 'border-box', padding: '0 14px',
          borderRadius: 16, background: CARD_BG, border: CARD_BORDER,
          cursor: 'pointer', WebkitTapHighlightColor: 'transparent', overflow: 'hidden',
        }}>
        <span style={{ color: '#fff', display: 'flex', flexShrink: 0 }}><Icon size={22} /></span>
        <span style={{ minWidth: 0, flexShrink: 0 }}>
          <span style={{
            display: 'block', fontSize: 15, fontWeight: 700, color: '#fff',
            letterSpacing: '-0.2px', whiteSpace: 'nowrap',
          }}>{label}</span>
          {sublabel && (
            <span style={{ display: 'block', fontSize: 10.5, color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap' }}>
              {sublabel}
            </span>
          )}
        </span>
        <span style={{
          marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 9,
          minWidth: 0, justifyContent: 'flex-end',
        }}>{right}</span>
      </div>
    </div>
  )
}

// Flight category, as a pill. Same colours the Airports page uses.
function CatPill({ cat }) {
  if (!cat) return null
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, letterSpacing: '0.05em', color: '#fff',
      background: cat.color, padding: '2px 7px', borderRadius: 20, flexShrink: 0,
    }}>{cat.label}</span>
  )
}

/* ── Module card — compact horizontal row, matches the hero buttons'
   height so the bottom row lines up with everything above it. ── */
function ModuleCard({ section, onOpen, Icon, label }) {

  function handleClick() {
    onOpen(section)
  }

  return (
    <div onClick={handleClick} role="button" tabIndex={0} aria-label={`Open ${label}`}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick() } }}
      style={{
      cursor: 'pointer',
      // Same black + hairline as the hero rows above. These two used to be
      // themed cards, which meant a light theme put two white buttons at
      // the bottom of a column of black ones.
      background: CARD_BG,
      border: CARD_BORDER,
      borderRadius: 16,
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      height: HERO_HEIGHT,
      boxSizing: 'border-box',
      padding: '0 14px',
      minWidth: 0,
      WebkitTapHighlightColor: 'transparent',
    }}>
      <span style={{ color: '#fff', display: 'flex', flexShrink: 0 }}>
        <Icon size={22} />
      </span>
      <div style={{
        fontSize: 14, fontWeight: 700, color: '#fff', letterSpacing: '-0.2px',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {label}
      </div>
    </div>
  )
}

/* ── Hangar card ──────────────────────────────────────────── */
function HangarCard({ aircraftImage, activeAircraft, aircraftCount = 0, onOpen }) {
  const empty = aircraftCount === 0
  const tail = activeAircraft?.tail || activeAircraft?.registration || activeAircraft?.name || null

  function handleClick() {
    onOpen('aircraft')
  }

  return (
    <HeroCard
      Icon={IconHangar}
      label="Hangar"
      sublabel={empty ? 'No aircraft yet' : tail}
      onOpen={handleClick}
      ariaLabel={empty ? 'Add aircraft' : 'Open hangar'}
      right={
        empty ? (
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', whiteSpace: 'nowrap' }}>+ Add</span>
        ) : (
          <>
            {aircraftImage && (
              <img src={aircraftImage} alt="" style={{
                width: 46, height: 32, objectFit: 'cover', borderRadius: 7,
                border: '1px solid rgba(255,255,255,0.22)', flexShrink: 0,
              }} />
            )}
            {/* Airworthiness at a glance. Grey until there is something to
                report: maintenance due dates are not modelled yet, and a
                green dot for data the app does not have would be the same
                lie the pilot's medical dot deliberately avoids. */}
            <span title="Maintenance status — not tracked yet" style={{
              width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
              background: 'rgba(255,255,255,0.28)',
              boxShadow: '0 0 0 1.5px rgba(255,255,255,0.18)',
            }} />
          </>
        )
      }
    />
  )
}

/* ── The map, filling the screen behind the drawer ────────── */
// The real map, not a copy of it. An earlier pass mounted a bare LiveMap
// here, which gave a basemap and a position dot and silently dropped
// everything else the map screen has: radar, flight category, TFRs, the
// airport/heliport/seaplane layers, the layers menu, locate, the flight plan
// bar and the GPS readout. Rendering MapView itself means there is one map in
// the app rather than two that have to be kept in step.
//
// It mounts once with Home and stays mounted, so a pan, a zoom, a chosen
// layer or a typed route all survive opening and closing a card over the top.
//
// The drawer reports three numbers and they are not interchangeable. The live
// height pegs the map's bottom controls to the drawer's edge frame by frame.
// The settled height drives the map's recentring, which should happen once per
// move rather than on every frame of a drag. The drag flag zeroes the
// controls' transition so they track a finger exactly, and restores it so they
// ease alongside the drawer when it snaps instead of arriving first.
function HomeMap({ metrics }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 0, background: 'var(--bg)' }}>
      <MapView
        bottomInset={metrics.live}
        // The LIVE height, not the settled one: the map's recentring tracks
        // the drawer frame by frame during a drag (finger down, 0ms) and
        // eases over the snap (finger up, 260ms) — see MapFocusOffset. An
        // earlier version fed the settled height so the map jumped once per
        // move; James asked for the map to follow the drawer instead.
        // Still capped at the drawer's open height: past that the map is
        // completely covered, so panning it further buys nothing and only
        // means a longer trip back when the section closes.
        focusInset={Math.min(metrics.live, metrics.openHeight || metrics.live)}
        insetDuration={metrics.dragging ? '0ms' : '260ms'}
        topInset="var(--safe-top)"
        showHomeButton={false}
      />
    </div>
  )
}

/* ── A section, hosted inside the drawer ──────────────────── */
// What CardOverlay used to provide, minus the full-screen portal: the close
// callback every section's Home button reaches for through context, and the
// edge-swipe that means "back".
//
// The swipe defers to BackOverride first, so a section with its own internal
// steps — the Hangar's detail and wizard views — steps back one level instead
// of dropping the whole thing.
function DrawerSection({ onClose, children }) {
  const backOverride = useContext(BackOverrideContext)
  const handleSwipeBack = useCallback(() => {
    const override = backOverride?.peek?.()
    if (override) { override(); return }
    onClose()
  }, [backOverride, onClose])
  const swipeRef = useSwipeBack(handleSwipeBack)

  return (
    <OverlayCloseContext.Provider value={onClose}>
      <div ref={swipeRef}>{children}</div>
    </OverlayCloseContext.Provider>
  )
}

/* ── The drawer ───────────────────────────────────────────── */
// Three stops, and the third is not always available.
//
//   peek  — the handle alone, map uncovered
//   open  — the height the card list needs, measured rather than declared,
//           which is what puts the cards where they have always sat without
//           pinning the drawer to a fraction that drifts when a row changes
//   full  — the whole viewport, reachable ONLY while a section is open,
//           because it exists to give that section room rather than to show
//           more of a card list that has already finished
//
// Sections live in here rather than in an overlay over the top. An overlay
// left the drawer and the map sitting behind whatever you had opened, which
// read as two screens stacked; a section that expands the drawer it was
// launched from reads as one.
const DRAWER_PEEK = 30
const DRAWER_MAX_FRACTION = 0.85

function HomeDrawer({ stop, onStopChange, sectionOpen, onHeightChange, children }) {
  const contentRef = useRef(null)
  const [cardsHeight, setCardsHeight] = useState(0)
  const [drag, setDrag] = useState(null)
  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight)

  // Measured, but only while the cards are what is in there. A section is far
  // taller, and letting it set this would make `open` mean something
  // different every time you came back from one.
  const sectionOpenRef = useRef(sectionOpen)
  useEffect(() => { sectionOpenRef.current = sectionOpen }, [sectionOpen])
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const read = h => { if (!sectionOpenRef.current) setCardsHeight(h) }
    const ro = new ResizeObserver(([entry]) => read(entry.contentRect.height))
    ro.observe(el)
    read(el.getBoundingClientRect().height)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const openHeight = Math.min(cardsHeight + DRAWER_PEEK, viewportHeight * DRAWER_MAX_FRACTION)
  const heights = { peek: DRAWER_PEEK, open: openHeight, full: viewportHeight }
  // `full` is off the menu unless a section is open, so an ordinary drag can
  // never strand the card list against the top of the screen. Everything else
  // stays available either way — a section can be peeked past to see the map,
  // the same as the cards can.
  const reachable = sectionOpen ? ['peek', 'open', 'full'] : ['peek', 'open']

  const settledHeight = heights[stop] ?? openHeight
  const height = drag == null ? settledHeight : drag
  const atFull = stop === 'full'

  useEffect(() => {
    onHeightChange({ live: height, settled: settledHeight, dragging: drag != null, openHeight })
  }, [height, settledHeight, drag, openHeight, onHeightChange])

  // Where a tap (as opposed to a drag) goes. With three stops a plain toggle
  // is ambiguous, so it steps up until there is nowhere left to go and then
  // comes back down — peek -> open -> full -> open.
  function tapTarget() {
    if (stop === 'peek') return 'open'
    if (stop === 'open') return sectionOpen ? 'full' : 'peek'
    return 'open'
  }

  function nearestStop(h) {
    return reachable.reduce((best, k) =>
      Math.abs(heights[k] - h) < Math.abs(heights[best] - h) ? k : best, reachable[0])
  }

  function handlePointerDown(e) {
    // The element is captured into a local, NOT read off the event later.
    // React sets currentTarget back to null once the handler returns, so a
    // listener that reaches for e.currentTarget throws the moment it fires,
    // which loses the drag silently.
    const el = e.currentTarget
    try { el.setPointerCapture(e.pointerId) } catch { /* drag still works */ }
    const startY = e.clientY
    const startH = settledHeight
    let moved = false

    const lo = Math.min(...reachable.map(k => heights[k]))
    const hi = Math.max(...reachable.map(k => heights[k]))

    const move = ev => {
      if (Math.abs(startY - ev.clientY) > 4) moved = true
      setDrag(Math.max(lo, Math.min(hi, startH + (startY - ev.clientY))))
    }
    const finish = ev => {
      try { el.releasePointerCapture(ev.pointerId) } catch { /* never captured */ }
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', finish)
      el.removeEventListener('pointercancel', finish)
      const finalH = Math.max(lo, Math.min(hi, startH + (startY - ev.clientY)))
      // A drag snaps to the nearest reachable stop; a tap steps one along.
      onStopChange(moved ? nearestStop(finalH) : tapTarget())
      setDrag(null)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', finish)
    el.addEventListener('pointercancel', finish)
  }

  return (
    <div style={{
      position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 400,
      height, boxSizing: 'border-box',
      background: 'var(--bg)',
      // Square at full height: rounded corners against the top of the screen
      // read as an unfinished sheet rather than as a page.
      borderTopLeftRadius: atFull ? 0 : 22, borderTopRightRadius: atFull ? 0 : 22,
      boxShadow: atFull ? 'none' : '0 -6px 24px rgba(0,0,0,0.22)',
      transition: drag == null
        ? 'height 260ms cubic-bezier(0.32, 0.72, 0, 1), border-radius 200ms ease'
        : 'none',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      touchAction: 'none',
      // Sections pin their own chrome with position:fixed — Discover's Home
      // button and tab bar, the Checklists pane's inset:0. Against the
      // viewport that chrome escapes the drawer and lands on the map. A
      // transform makes this element their containing block instead, so
      // "fixed" means fixed to the drawer, which is what a section rendered
      // inside one should mean. Cheaper and far less brittle than rewriting
      // the positioning in every section.
      transform: 'translateZ(0)',
      // Only at full height does the drawer reach the notch.
      paddingTop: atFull ? 'var(--safe-top)' : 0,
    }}>
      {/* The grab handle is the whole strip, not just the pill — a 4px target
          on a moving drawer is not a target. */}
      <div
        onPointerDown={handlePointerDown}
        role="button"
        tabIndex={0}
        aria-label={stop === 'peek' ? 'Expand drawer' : 'Collapse drawer'}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onStopChange(tapTarget()) } }}
        style={{
          height: DRAWER_PEEK, flexShrink: 0, cursor: 'grab',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          WebkitTapHighlightColor: 'transparent',
        }}>
        <div style={{ width: 38, height: 4, borderRadius: 2, background: 'var(--text-secondary)', opacity: 0.4 }} />
      </div>

      <div style={{ flex: '1 1 auto', overflowY: 'auto', overscrollBehavior: 'contain' }}>
        <div ref={contentRef}>
          {children}
          <div style={{ height: 'calc(var(--safe-bottom) + 12px)' }} />
        </div>
      </div>
    </div>
  )
}

/* ── Airports card — the airport tower/runway scene stays the primary
   image; current conditions (sun, clouds, rain, snow, storm) are just a
   small flourish layered on top of it, not the main picture. ICAO + VFR/
   MVFR/IFR/LIFR pill sit together on the left; temp/wind/vis stay small
   and off to the right so nothing overlaps. ── */
function AirportsHeroCard({ onOpen }) {
  const { profile } = usePilotProfile()
  const units = profile ?? {}
  const [icao, setIcao] = useState('')
  const [pickerOpen, setPicker] = useState(false)
  const [wx, setWx] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    get('settings', 'homeAirport').then(row => {
      if (row?.value) setIcao(row.value)
      else setPicker(true)
    })
  }, [])

  useEffect(() => {
    if (!icao) return
    setLoading(true)
    get('weather', icao).then(cached => { if (cached) setWx(cached) })
    loadWeather(icao).then(setWx).catch(() => {}).finally(() => setLoading(false))
  }, [icao])

  // A great many fields publish no METAR — that is the whole reason the
  // Airports page grew its substitute-weather cards. Without this the home
  // screen would fall back to "clear" for every one of them and paint a
  // confident blue sky over an airport it knows nothing about.
  //
  // Only fetched when AWC has actually answered "nothing here" (noReport),
  // never on a failed lookup, and never for a field that does report: the
  // same gate the Airports page uses.
  const [area, setArea] = useState(null)
  useEffect(() => {
    setArea(null)
    if (!icao || !wx?.noReport) return
    let cancelled = false
    findAirport(icao).then(hit => {
      if (cancelled || !hit) return
      return loadAreaWeather(icao, hit.lat, hit.lon)
        .then(a => { if (!cancelled) setArea(a) })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [icao, wx?.noReport])
  const areaSky = area ? conditionFromArea(area) : null

  // This card's own weather art. It used to also publish the sky upward so the
  // whole home screen could be tinted from it; the map is the background now,
  // so nothing is listening and the card keeps its weather to itself.
  const sky = getCondition(wx?.metar ?? null)
  const resolved = wx?.metar ? sky : areaSky

  function handleClick() {
    onOpen('airports')
  }

  function confirmAirport(id) {
    put('settings', { key: 'homeAirport', value: id })
    setIcao(id)
    setPicker(false)
  }

  // The picker modal is rendered once, below, outside both branches — it
  // needs to be reachable regardless of whether `icao` happens to be set,
  // since pickerOpen can be true with an empty icao (no home airport ever
  // chosen yet). It used to live only inside this branch's own JSX, gated
  // on `pickerOpen` — but that branch's own guard requires `!pickerOpen` to
  // even be entered, so the modal could never actually render: the very
  // first time this card mounted with no home airport set, pickerOpen went
  // true, the guard then excluded this branch, and the component fell
  // through to the "confirmed" view below with a blank icao and no way to
  // ever open the picker again.
  if (!icao && !pickerOpen) {
    return (
      <div style={{ padding: `${ROW_GAP}px 18px 0`}}>
        <div onClick={() => setPicker(true)} style={{
          background: 'var(--bg-card)', borderRadius: 20, boxShadow: 'var(--shadow-sm)',
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '0 20px', height: HERO_HEIGHT, boxSizing: 'border-box',
          cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
        }}>
          <span style={{ fontSize: 20 }}>✈️</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Set Home Airport</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Tap to look one up</div>
          </div>
        </div>
      </div>
    )
  }

  if (pickerOpen) {
    return <AirportPickerModal current={icao} onConfirm={confirmAirport} onClose={() => setPicker(false)} />
  }

  const cat = wx?.metar ? parseFltCat(wx.metar) : null
  // A field with no station of its own still gets the right illustration: the
  // model estimate stands in, so it doesn't show a sunny scene in a storm.
  const condition = resolved?.type ?? sky.type

  // The ICAO is the label here: the tower glyph already says "airport", so
  // spending the label on the word would waste the one line that can carry
  // the field you're actually looking at.
  return (
    <HeroCard
      Icon={IconTower}
      label={icao}
      onOpen={handleClick}
      ariaLabel="Open airports"
      right={
        <>
          <span style={{ color: '#fff', display: 'flex', flexShrink: 0, opacity: 0.95 }}>
            <IconSky type={condition} size={21} />
          </span>
          <CatPill cat={cat} />
          <span style={{
            fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.82)',
            whiteSpace: 'nowrap', flexShrink: 0, fontVariantNumeric: 'tabular-nums',
          }}>
            {wx?.metar
              ? `${parseTemp(wx.metar, units)} · ${parseWind(wx.metar, units)}`
              // A field with no station of its own still gets numbers, from
              // the model at its coordinates. No category pill on this path
              // (`cat` stays null without a published METAR), so the card
              // never asserts VFR on the strength of a forecast.
              : area ? `${areaTemp(area, units)} · ${areaWind(area, units)}`
              : loading ? 'Loading…' : '—'}
          </span>
        </>
      }
    />
  )
}

/* ── Flight Planning card ─────────────────────────────────── */
function FlightPlanCard({ onOpen }) {

  function handleClick() {
    onOpen('checklists')
  }

  // Right side deliberately empty for now — see the options in the commit
  // message. Better an honest gap than a decorative number.
  return (
    <HeroCard
      Icon={IconRoute}
      label="FPL"
      onOpen={handleClick}
      ariaLabel="Open flight planning"
    />
  )
}

/* ── Friends card — social/marketplace, still branded "Discover"
   internally (Discover.jsx, its routes, its own copy) since this is a
   user-facing label change, not a restructuring; only what's actually
   shown to the pilot changed. Vibrant gradient (rather than the earlier
   gold/amber, which read as more "hangar/pilot" than "social") so the
   card itself signals what kind of feature this is before you even tap
   it — deliberately its own blue/violet/pink palette, not another app's
   brand colors. Plain gradient rather than an illustrated scene like the
   other cards: the feature itself is still a placeholder (Discover.jsx),
   so a quick painted background beats investing in custom art for a
   shape that's still expected to change. ── */
function DiscoverCard({ onOpen }) {
  const { user } = useAuth()
  const [unread, setUnread] = useState(0)

  // Polled on mount and whenever the app regains focus, matching how
  // hasUnreadMessages is already used elsewhere: a standing realtime
  // subscription just to paint a badge is the first step toward a
  // notification system this pass is not building.
  useEffect(() => {
    if (!user?.id) { setUnread(0); return }
    let alive = true
    const load = () => hasUnreadMessages(user.id)
      .then(({ count }) => { if (alive) setUnread(count ?? 0) })
      .catch(() => {})
    load()
    window.addEventListener('focus', load)
    return () => { alive = false; window.removeEventListener('focus', load) }
  }, [user?.id])

  function handleClick() {
    onOpen('discover')
  }

  return (
    <HeroCard
      Icon={IconFriends}
      label="Social"
      onOpen={handleClick}
      ariaLabel="Open social"
      right={unread > 0 ? (
        <span style={{
          minWidth: 20, height: 20, padding: '0 6px', borderRadius: 10,
          background: 'var(--danger)', color: '#fff',
          fontSize: 11, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>{unread > 99 ? '99+' : unread}</span>
      ) : null}
    />
  )
}

/* ── Pilot row — the uniformed figure sits on the left of the art, and the
   right-hand side carries the readout: flight currency and medical, each
   with its own status dot, and total logged time under them. Goes straight
   to /pilot, whose own main screen IS the currency view (medical + flight
   currency, with the logbook alongside); profile-editing fields live one
   level deeper at /profile ("Profile Setup"). ── */

// Grey, deliberately, for 'incomplete'/'unknown'. The rolled-up Home dot used
// to treat "not entered yet" as valid so it wouldn't nag, which is defensible
// for a single anonymous dot but not here: a dot sitting next to the word
// "Medical" is a claim about the medical, and showing green for one nobody
// has entered would be the app asserting something it does not know.
const STATUS_DOT = {
  expired:  'var(--danger)',
  expiring: 'var(--warn)',
  valid:    'var(--ok)',
}
function statusDotColor(status) {
  return STATUS_DOT[status] ?? 'rgba(255,255,255,0.35)'
}

function StatusLine({ label, status }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
      <span>{label}</span>
      <span style={{
        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
        background: statusDotColor(status),
        boxShadow: '0 0 0 1.5px rgba(255,255,255,0.55)',
      }} />
    </div>
  )
}

function PilotRow({ currencyCards, onOpen }) {
  const { entries } = useLogbook()
  const totalHours = computeTotalHours(entries)

  function handleClick() {
    onOpen('pilot')
  }

  return (
    <HeroCard
      Icon={IconHelmet}
      label="Pilot"
      onOpen={handleClick}
      ariaLabel="Open pilot"
      right={
        <span style={{
          display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3,
          fontSize: 11, fontWeight: 700, color: '#fff', lineHeight: 1,
        }}>
          <StatusLine label="Currency" status={currencyCards?.current.status} />
          <StatusLine label="Medical"  status={currencyCards?.valid.status} />
          <span style={{ textAlign: 'right', fontWeight: 600, color: 'rgba(255,255,255,0.7)', fontVariantNumeric: 'tabular-nums' }}>
            TT: {totalHours.toFixed(1)}
          </span>
        </span>
      }
    />
  )
}

/* ── Reorder screen — plain list, up/down arrows. Not drag-and-drop:
   these rows have real interactive content (live map, weather fetch),
   and a full drag gesture would fight the app's existing edge-swipe-back
   gesture — up/down is simpler and just as functional. Changes save
   immediately, no separate "Save" step — now lives inside Settings
   rather than as its own Home button (see Settings.jsx's own ROW_LABELS
   for the reorder list's display names). ── */

/* ── Section content map ──────────────────────────────────── */
function SectionContent({ section, order, onMoveRow }) {
  if (section === 'checklists') return <Checklists />
  if (section === 'aircraft')   return <Hangar />
  if (section === 'airports')   return <AirportInfo />
  if (section === 'tools')      return <ToolsMenu />
  if (section === 'settings')   return <Settings order={order} onMoveRow={onMoveRow} />
  if (section === 'discover')   return <Discover />
  if (section === 'pilot')      return <Pilot />
  return null
}

// No 'map' row: the map is the screen the drawer sits on, not a card in it.
// Saved orders from before that change still carry 'map', and it is filtered
// out on load rather than migrated away, so a pilot who reordered their rows
// keeps the order they chose either way.
const DEFAULT_ORDER = ['airports', 'hangar', 'pilot', 'flight', 'discover']

// The order shipped before Map moved to the top — a saved homeOrder that
// still matches this exactly means the pilot never actually touched the
// reorder feature, they just have the old built-in default persisted.
// Treating that case as "still on defaults" (and re-saving the new default
// in its place) lets the new default actually take effect for them, while
// never touching anyone who genuinely customized their own order on purpose.
const PRE_MAP_TOP_DEFAULT_ORDER = ['airports', 'map', 'hangar', 'pilot', 'flight']

/* ── Home ────────────────────────────────────────────────── */
export default function Home() {
  const { aircraftId, aircraftList, refreshAircraftList } = useActiveAircraft()
  const [openSection, setOpenSection]     = useState(null)
  // Raw currency/profile record rather than a rolled-up status: the Pilot
  // card reports flight currency and medical separately now, so it needs both
  // of getCurrencyStatus()'s cards, not the worst of the two.
  const [currencyData, setCurrencyData] = useState(null)
  const [order, setOrder] = useState(DEFAULT_ORDER)
  // The drawer, and how much of the map it is covering. Open on launch, at
  // the height its own content needs.
  // 'peek' | 'open' | 'full'. Only opening a section ever reaches 'full'.
  const [drawerStop, setDrawerStop] = useState('open')
  const [drawerMetrics, setDrawerMetrics] = useState({ live: 0, settled: 0, dragging: false, openHeight: 0 })
  const handleDrawerHeight = useCallback(m => setDrawerMetrics(m), [])

  const activeAircraft = aircraftList?.find(a => a.id === aircraftId)
  const aircraftImage = activeAircraft?.image ?? ''
  function loadCurrencyStatus() {
    get('currency', 'profile').then(d => setCurrencyData(d ?? {}))
  }

  useEffect(() => {
    loadCurrencyStatus()
    get('settings', 'homeOrder').then(row => {
      if (!Array.isArray(row?.value)) return
      // A saved order identical to the old shipped default means this pilot
      // never actually used the reorder feature — migrate them onto the new
      // default (and persist that) rather than leaving them stuck on a
      // "customization" they never made. See PRE_MAP_TOP_DEFAULT_ORDER above.
      if (row.value.length === PRE_MAP_TOP_DEFAULT_ORDER.length &&
          row.value.every((k, i) => k === PRE_MAP_TOP_DEFAULT_ORDER[i])) {
        setOrder(DEFAULT_ORDER)
        put('settings', { key: 'homeOrder', value: DEFAULT_ORDER }).catch(() => {})
        return
      }
      // Forward-compatible: keep any saved positions, append new row types
      // (added in a later app update) that aren't in the saved order yet.
      const saved = row.value.filter(k => DEFAULT_ORDER.includes(k))
      const missing = DEFAULT_ORDER.filter(k => !saved.includes(k))
      setOrder([...saved, ...missing])
    })
  }, [])

  // Opening a section does NOT raise the drawer. The whole point of putting
  // sections in here is that you can read one — airports, say — with the map
  // still in view above it. Going full screen is the pilot's choice, not a
  // consequence of tapping a card. The only nudge is out of 'peek', where the
  // section would be behind the handle you just tapped through.
  function openCard(section) {
    setOpenSection(section)
    setDrawerStop(stop => (stop === 'peek' ? 'open' : stop))
  }

  function closeCard() {
    // The Hangar overlay can create/edit/delete aircraft while open — refresh
    // the list so this screen's preview image and the hero card's empty/
    // non-empty state stay in sync with whatever changed in there.
    if (openSection === 'aircraft') {
      refreshAircraftList()
    }
    // Airworthiness (on Aircraft) and Checklists (IM SAFE/CURRENT) both write
    // to the same currency/profile record the Home icon reflects. Editing
    // currency itself now happens on the separate /currency route (via
    // Pilot → Profile), which remounts Home on return, so it doesn't need
    // handling here too.
    if (openSection === 'aircraft' || openSection === 'checklists') {
      loadCurrencyStatus()
    }
    setOpenSection(null)
    // 'full' is not a legal height for the card list, so drop back to the
    // standard one; any other height the pilot chose is left alone.
    setDrawerStop(stop => (stop === 'full' ? 'open' : stop))
  }

  // Height and section are independent. Dragging the drawer down out of full
  // leaves the section open at the standard height with the map back in view;
  // only the Home button closes a section. The single rule is that 'full'
  // needs a section to be showing, since it exists to give one room.
  function handleStopChange(next) {
    if (next === 'full' && !openSection) return
    setDrawerStop(next)
  }

  function moveRow(index, dir) {
    const j = index + dir
    if (j < 0 || j >= order.length) return
    const next = [...order]
    ;[next[index], next[j]] = [next[j], next[index]]
    setOrder(next)
    put('settings', { key: 'homeOrder', value: next }).catch(() => {})
  }

  // Both cards come from one pass over the same record. Until it has loaded
  // there is nothing to report, so the dots stay grey rather than flashing a
  // confident green on the way in.
  const currencyCards = useMemo(
    () => (currencyData ? getCurrencyStatus(currencyData) : null),
    [currencyData])

  function renderRow(key) {
    if (key === 'airports') return <AirportsHeroCard key={key} onOpen={openCard} />
    if (key === 'hangar')   return <HangarCard key={key} aircraftImage={aircraftImage} activeAircraft={activeAircraft} aircraftCount={aircraftList?.length ?? 0} onOpen={openCard} />
    if (key === 'pilot')    return <PilotRow key={key} currencyCards={currencyCards} onOpen={openCard} />
    if (key === 'flight')   return <FlightPlanCard key={key} onOpen={openCard} />
    if (key === 'discover') return <DiscoverCard key={key} onOpen={openCard} />
    return null
  }

  return (
    <HomeLocationProvider>
      <HomeMap metrics={drawerMetrics} />

      <HomeDrawer
        stop={drawerStop}
        onStopChange={handleStopChange}
        sectionOpen={!!openSection}
        onHeightChange={handleDrawerHeight}
      >
        {openSection ? (
          <DrawerSection onClose={closeCard}>
            <SectionContent section={openSection} order={order} onMoveRow={moveRow} />
          </DrawerSection>
        ) : (
          <>
            {order.map(renderRow)}

            {/* ── Tools / Settings ── */}
            <div style={{ padding: `${ROW_GAP}px 18px 0`}}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <ModuleCard section="tools"    onOpen={openCard} Icon={IconAtom}   label="Tools" />
                <ModuleCard section="settings" onOpen={openCard} Icon={IconGear}   label="Settings" />
              </div>
            </div>
          </>
        )}
      </HomeDrawer>
    </HomeLocationProvider>
  )
}
