import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
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
import CardOverlay   from '../../components/CardOverlay'
import MapView from '../../components/MapView'
import AirportInfo from '../../components/AirportInfo'
import ToolsMenu from '../../components/ToolsMenu'
import { AirportScene, PilotArt, HangarArt, FlightPlanArt } from '../../components/HomeHeroArt'
import HeroLabel, { HERO_LABEL_WIDTH } from '../../components/HeroLabel'
import { HomeLocationProvider } from '../../context/HomeLocation'
import { IconWrench, IconGear, IconFriends } from '../../components/Icons'
import Checklists from '../Checklists/Checklists'
import Hangar     from '../Aircraft/Hangar'
import Settings   from '../Settings/Settings'
import Discover   from '../Discover/Discover'

// Uniform size for every hero button (Weather, Map, Airports, Hangar,
// Pilot, Flight Planning) and the Tools/Settings row — small enough that
// all seven rows plus the disclaimer text fit within one screen's height
// with no scrolling, on the shortest phones the app supports.
const HERO_HEIGHT = 64
const ROW_GAP = 8

/* ── Module card — compact horizontal row, matches the hero buttons'
   height so the bottom row lines up with everything above it. ── */
function ModuleCard({ section, onOpen, Icon, label }) {
  const ref = useRef(null)

  function handleClick() {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect()
      onOpen(section, { top: r.top, left: r.left, width: r.width, height: r.height })
    }
  }

  return (
    <div ref={ref} onClick={handleClick} role="button" tabIndex={0} aria-label={`Open ${label}`}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick() } }}
      style={{
      cursor: 'pointer',
      background: 'var(--bg-card)',
      borderRadius: 16,
      boxShadow: 'var(--shadow-sm)',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      height: HERO_HEIGHT,
      boxSizing: 'border-box',
      padding: '0 14px',
      minWidth: 0,
      WebkitTapHighlightColor: 'transparent',
    }}>
      <span style={{ color: 'var(--text)', display: 'flex', flexShrink: 0 }}>
        <Icon size={22} />
      </span>
      <div style={{
        fontSize: 14, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.2px',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {label}
      </div>
    </div>
  )
}

/* ── Hangar card ──────────────────────────────────────────── */
function HangarCard({ aircraftImage, aircraftCount = 0, onOpen }) {
  const ref = useRef(null)
  const empty = aircraftCount === 0

  function handleClick() {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect()
      onOpen('aircraft', { top: r.top, left: r.left, width: r.width, height: r.height })
    }
  }

  return (
    <div style={{ padding: `${ROW_GAP}px 18px 0`}}>
      <div ref={ref} onClick={handleClick} role="button" tabIndex={0} aria-label={empty ? 'Add aircraft' : 'Open hangar'}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick() } }}
        style={{
        position: 'relative', overflow: 'hidden', borderRadius: 20, isolation: 'isolate',
        boxShadow: 'var(--shadow-sm)',
        height: HERO_HEIGHT, boxSizing: 'border-box',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}>
        {empty ? (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: 'var(--bg-card-2)',
          }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)', lineHeight: 1 }}>+</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Add Aircraft</span>
          </div>
        ) : aircraftImage ? (
          <img src={aircraftImage} alt="" style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            objectFit: 'cover', objectPosition: 'center',
          }} />
        ) : (
          <HangarArt />
        )}

        {!empty && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 0,
            background: 'linear-gradient(108deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.3) 55%, rgba(0,0,0,0.05) 100%)',
          }} />
        )}

        {!empty && <HeroLabel>Hangar</HeroLabel>}
      </div>
    </div>
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
// `bottomInset` is the drawer's height: MapView lifts its bottom-anchored
// controls above it and pans the view up by half of it, so what you are
// looking at stays centred in the strip still showing.
function HomeMap({ coveredHeight, drawerOpen }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 0, background: 'var(--bg)' }}>
      <MapView
        bottomInset={coveredHeight}
        topInset="var(--safe-top)"
        showHomeButton={false}
        compactControls={drawerOpen}
      />
    </div>
  )
}

/* ── The drawer ───────────────────────────────────────────── */
// Two stops. Open is the height its own content needs — which is what puts
// the cards exactly where they used to sit, without pinning the drawer to a
// percentage that would drift the moment a row is added or removed. Peek is a
// handle and nothing else.
const DRAWER_PEEK = 30
const DRAWER_MAX_FRACTION = 0.85

function HomeDrawer({ open, onOpenChange, onHeightChange, children }) {
  const contentRef = useRef(null)
  const [contentHeight, setContentHeight] = useState(0)
  const [drag, setDrag] = useState(null)

  // The content measures itself, so the open height follows whatever is in
  // the drawer rather than a number that has to be kept in step by hand.
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setContentHeight(entry.contentRect.height))
    ro.observe(el)
    setContentHeight(el.getBoundingClientRect().height)
    return () => ro.disconnect()
  }, [])

  // contentHeight measures the rows alone; the handle strip sits above them.
  const openHeight = Math.min(contentHeight + DRAWER_PEEK, window.innerHeight * DRAWER_MAX_FRACTION)
  const settledHeight = open ? openHeight : DRAWER_PEEK
  const height = drag == null ? settledHeight : drag

  // Only the settled height reaches the map. Re-centring it on every frame of
  // a drag means two things easing at once, which reads as the map lagging.
  useEffect(() => { onHeightChange(settledHeight) }, [settledHeight, onHeightChange])

  function handlePointerDown(e) {
    // The element is captured into a local, NOT read off the event later.
    // React sets currentTarget back to null once the handler returns, so a
    // listener that reaches for e.currentTarget throws the moment it fires.
    // That is not a crash you see: the drawer stays wherever the drag left it
    // because setDrag(null) never runs, while `open` never changes — so the
    // map goes on reserving room for a drawer that looks closed.
    const el = e.currentTarget
    // Capture is an optimisation — it keeps the drag alive if the finger
    // leaves the handle — not a requirement. It throws for a pointer id the
    // browser doesn't recognise, and letting that escape would abort this
    // handler before it binds anything, which loses the drag completely.
    try { el.setPointerCapture(e.pointerId) } catch { /* drag still works */ }
    const startY = e.clientY
    const startH = settledHeight
    let moved = false

    const move = ev => {
      if (Math.abs(startY - ev.clientY) > 4) moved = true
      const next = startH + (startY - ev.clientY)
      setDrag(Math.max(DRAWER_PEEK, Math.min(openHeight, next)))
    }
    const finish = ev => {
      try { el.releasePointerCapture(ev.pointerId) } catch { /* never captured */ }
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', finish)
      el.removeEventListener('pointercancel', finish)
      const finalH = startH + (startY - ev.clientY)
      // A tap toggles; a drag snaps to whichever stop it ended up nearer.
      onOpenChange(moved ? finalH > (openHeight + DRAWER_PEEK) / 2 : !open)
      setDrag(null)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', finish)
    // A cancelled pointer (a system gesture taking over, say) has to settle the
    // drawer too, or it is left stuck exactly as above.
    el.addEventListener('pointercancel', finish)
  }

  return (
    <div style={{
      position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 400,
      height, boxSizing: 'border-box',
      background: 'var(--bg)',
      borderTopLeftRadius: 22, borderTopRightRadius: 22,
      boxShadow: '0 -6px 24px rgba(0,0,0,0.22)',
      transition: drag == null ? 'height 260ms cubic-bezier(0.32, 0.72, 0, 1)' : 'none',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      touchAction: 'none',
    }}>
      {/* The grab handle is the whole strip, not just the pill — a 4px target
          on a moving drawer is not a target. */}
      <div
        onPointerDown={handlePointerDown}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={open ? 'Collapse drawer' : 'Expand drawer'}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenChange(!open) } }}
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
          <div style={{ height: `calc(var(--safe-bottom) + 12px)` }} />
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
  const ref = useRef(null)

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
    if (ref.current) {
      const r = ref.current.getBoundingClientRect()
      onOpen('airports', { top: r.top, left: r.left, width: r.width, height: r.height })
    }
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

  return (
    <div style={{ padding: `${ROW_GAP}px 18px 0`}}>
      <div ref={ref} onClick={handleClick} role="button" tabIndex={0} aria-label="Open airports"
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick() } }}
        style={{
        position: 'relative', overflow: 'hidden', borderRadius: 20, isolation: 'isolate',
        boxShadow: 'var(--shadow-sm)',
        height: HERO_HEIGHT, boxSizing: 'border-box',
        cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
      }}>
        <AirportScene condition={condition} />
        <div style={{
          position: 'absolute', inset: 0, zIndex: 0,
          background: 'linear-gradient(108deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.2) 55%, rgba(0,0,0,0.04) 100%)',
        }} />
        <HeroLabel>Airports</HeroLabel>

        <div style={{
          position: 'relative', zIndex: 1, height: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: `0 14px 0 ${HERO_LABEL_WIDTH + 14}px`, boxSizing: 'border-box',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: '#fff', fontFamily: 'monospace', letterSpacing: '0.06em' }}>
              {icao}
            </span>
            {cat && (
              <span style={{
                fontSize: 9, fontWeight: 800, letterSpacing: '0.05em', color: '#fff',
                background: cat.color, padding: '2px 7px', borderRadius: 20,
                boxShadow: `0 1px 4px ${cat.color}66`, flexShrink: 0,
              }}>{cat.label}</span>
            )}
          </div>

          <div style={{ textAlign: 'right', fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.85)', lineHeight: 1.5, flexShrink: 0 }}>
            {wx?.metar ? (
              <>
                <div>{parseTemp(wx.metar, units)} · {parseWind(wx.metar, units)}</div>
                <div style={{ color: 'rgba(255,255,255,0.65)' }}>{parseVisib(wx.metar, units)} vis</div>
              </>
            ) : area ? (
              // A field with no station still gets numbers, from the model at
              // its own coordinates. There is no flight-category pill on this
              // path — `cat` stays null without a published one — so the card
              // never asserts VFR on the strength of a forecast. The Airports
              // page carries the full "not observed here" labelling; this is
              // the summary that sends you there.
              <>
                <div>{areaTemp(area, units)} · {areaWind(area, units)}</div>
                <div style={{ color: 'rgba(255,255,255,0.55)' }}>{areaVis(area, units)} · forecast</div>
              </>
            ) : (
              <span style={{ color: 'rgba(255,255,255,0.65)' }}>{loading ? 'Loading…' : '—'}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Flight Planning card ─────────────────────────────────── */
function FlightPlanCard({ onOpen }) {
  const ref = useRef(null)

  function handleClick() {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect()
      onOpen('checklists', { top: r.top, left: r.left, width: r.width, height: r.height })
    }
  }

  return (
    <div style={{ padding: `${ROW_GAP}px 18px 0`}}>
      <div ref={ref} onClick={handleClick} role="button" tabIndex={0} aria-label="Open flight planning"
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick() } }}
        style={{
        position: 'relative', overflow: 'hidden', borderRadius: 20, isolation: 'isolate',
        boxShadow: 'var(--shadow-sm)',
        height: HERO_HEIGHT, boxSizing: 'border-box',
        cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
      }}>
        <FlightPlanArt />
        <div style={{
          position: 'absolute', inset: 0, zIndex: 0,
          background: 'linear-gradient(108deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.16) 55%, rgba(0,0,0,0.02) 100%)',
        }} />
        <HeroLabel>FPL</HeroLabel>
      </div>
    </div>
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
  const ref = useRef(null)

  function handleClick() {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect()
      onOpen('discover', { top: r.top, left: r.left, width: r.width, height: r.height })
    }
  }

  return (
    <div style={{ padding: `${ROW_GAP}px 18px 0`}}>
      <div ref={ref} onClick={handleClick} role="button" tabIndex={0} aria-label="Open friends"
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick() } }}
        style={{
        position: 'relative', overflow: 'hidden', borderRadius: 20, isolation: 'isolate',
        boxShadow: 'var(--shadow-sm)',
        height: HERO_HEIGHT, boxSizing: 'border-box',
        background: 'linear-gradient(108deg, #2563eb 0%, #7c3aed 55%, #ec4899 100%)',
        cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
      }}>
        <span style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          zIndex: 1, color: 'rgba(255,255,255,0.9)', display: 'flex',
        }}>
          <IconFriends size={30} />
        </span>
        <HeroLabel>Friends</HeroLabel>
      </div>
    </div>
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

function PilotRow({ currencyCards }) {
  const { entries } = useLogbook()
  const totalHours = computeTotalHours(entries)

  return (
    <div style={{ padding: `${ROW_GAP}px 18px 0`}}>
      <Link to="/pilot" style={{ textDecoration: 'none' }}>
        <div style={{
          position: 'relative', overflow: 'hidden', borderRadius: 20, isolation: 'isolate',
          boxShadow: 'var(--shadow-sm)',
          height: HERO_HEIGHT, boxSizing: 'border-box',
          cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
        }}>
          <PilotArt />
          <div style={{
            position: 'absolute', inset: 0, zIndex: 0,
            background: 'linear-gradient(108deg, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0.2) 55%, rgba(0,0,0,0.04) 100%)',
          }} />
          <HeroLabel>Pilot</HeroLabel>

          <div style={{
            position: 'absolute', top: 0, bottom: 0, right: 14, zIndex: 1,
            display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3,
            fontSize: 11, fontWeight: 700, color: '#fff', lineHeight: 1,
            textShadow: '0 1px 2px rgba(0,0,0,0.45)',
          }}>
            <StatusLine label="Currency" status={currencyCards?.current.status} />
            <StatusLine label="Medical"  status={currencyCards?.valid.status} />
            <div style={{ textAlign: 'right', fontWeight: 600, color: 'rgba(255,255,255,0.85)', fontVariantNumeric: 'tabular-nums' }}>
              TT: {totalHours.toFixed(1)}
            </div>
          </div>
        </div>
      </Link>
    </div>
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
  const [sectionRect, setSectionRect]     = useState(null)
  // Raw currency/profile record rather than a rolled-up status: the Pilot
  // card reports flight currency and medical separately now, so it needs both
  // of getCurrencyStatus()'s cards, not the worst of the two.
  const [currencyData, setCurrencyData] = useState(null)
  const [order, setOrder] = useState(DEFAULT_ORDER)
  // The drawer, and how much of the map it is covering. Open on launch, at
  // the height its own content needs.
  const [drawerOpen, setDrawerOpen] = useState(true)
  const [coveredHeight, setCoveredHeight] = useState(0)
  const handleDrawerHeight = useCallback(h => setCoveredHeight(h), [])

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

  function openCard(section, rect) {
    setSectionRect(rect)
    setOpenSection(section)
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
    setSectionRect(null)
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
    if (key === 'hangar')   return <HangarCard key={key} aircraftImage={aircraftImage} aircraftCount={aircraftList?.length ?? 0} onOpen={openCard} />
    if (key === 'pilot')    return <PilotRow key={key} currencyCards={currencyCards} />
    if (key === 'flight')   return <FlightPlanCard key={key} onOpen={openCard} />
    if (key === 'discover') return <DiscoverCard key={key} onOpen={openCard} />
    return null
  }

  return (
    <HomeLocationProvider>
      <HomeMap coveredHeight={coveredHeight} drawerOpen={drawerOpen} />

      <HomeDrawer open={drawerOpen} onOpenChange={setDrawerOpen} onHeightChange={handleDrawerHeight}>
        {order.map(renderRow)}

        {/* ── Tools / Settings ── */}
        <div style={{ padding: `${ROW_GAP}px 18px 0`}}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <ModuleCard section="tools"    onOpen={openCard} Icon={IconWrench} label="Tools" />
            <ModuleCard section="settings" onOpen={openCard} Icon={IconGear}   label="Settings" />
          </div>
        </div>
      </HomeDrawer>

      {openSection && sectionRect && (
        <CardOverlay cardRect={sectionRect} onClose={closeCard}>
          <SectionContent section={openSection} order={order} onMoveRow={moveRow} />
        </CardOverlay>
      )}
    </HomeLocationProvider>
  )
}
