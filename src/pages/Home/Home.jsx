import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { get, put } from '../../lib/db'
import { getGlobalCurrencyStatus } from '../../lib/currency'
import { loadWeather, parseFltCat, parseWind, parseVisib, parseTemp } from '../../lib/weather'
import { getCondition } from '../../components/WeatherAnimation'
import { usePilotProfile } from '../../context/PilotProfile'
import { useActiveAircraft } from '../../context/ActiveAircraft'
import AirportPickerModal from '../../components/AirportPickerModal'
import CardOverlay   from '../../components/CardOverlay'
import MapView, { LiveMap, MapViewSync } from '../../components/MapView'
import AirportInfo from '../../components/AirportInfo'
import ToolsMenu from '../../components/ToolsMenu'
import { AirportScene, PilotArt, HangarArt, FlightPlanArt } from '../../components/HomeHeroArt'
import HeroLabel, { HERO_LABEL_WIDTH } from '../../components/HeroLabel'
import { HomeLocationProvider, useHomeLocation } from '../../context/HomeLocation'
import { useMapLayer } from '../../hooks/useMapLayer'
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

/* ── Map card — a live, non-interactive preview of the real map. The
   preview map ignores taps/drags/pinches itself (all interaction props
   below are off) so any tap anywhere on the card always opens the real,
   fully interactive map instead of panning this little thumbnail. ── */
const PREVIEW_ZOOM = 12

// The Map card is the one hero button that grows: `flex: 1` lets it claim
// whatever vertical space is left over after every other (fixed-height)
// row, the tools/settings row, and the disclaimer text are laid out —
// rather than hardcoding a pixel value that would only be correct on one
// screen size, this is automatically "however much is missing" on any
// device. `minHeight` keeps it from disappearing if the rest of the stack
// ever grows taller than the viewport.
function MapCard({ onOpen, lastView }) {
  const ref = useRef(null)
  const { coords: liveCoords, status } = useHomeLocation()
  const position = liveCoords ? [liveCoords.lat, liveCoords.lon] : null
  const { layer } = useMapLayer()

  function handleClick() {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect()
      onOpen('map', { top: r.top, left: r.left, width: r.width, height: r.height })
    }
  }

  return (
    <div style={{ padding: `${ROW_GAP}px 18px 0`, flex: '1 1 auto', minHeight: HERO_HEIGHT, display: 'flex' }}>
      <div
        ref={ref}
        onClick={handleClick}
        role="button"
        aria-label="Open map"
        style={{
          background: 'var(--bg-card)', borderRadius: 20,
          boxShadow: 'var(--shadow-sm)',
          overflow: 'hidden', position: 'relative', isolation: 'isolate',
          flex: '1 1 auto', width: '100%',
          cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
        }}>
        {status !== 'pending' && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            {/* This preview mounts once and (per LiveMap's own design) never
                moves itself after that, same as the real map — lastView,
                fed down from Home and kept in sync with whatever the real
                map screen was last panned/zoomed to (see MapView's
                ViewReporter), is what lets this thumbnail catch up to a
                view that already existed before this component mounted, or
                change again on a later visit. Without it, this preview
                always showed a fixed default zoom on your live position,
                even right after leaving the real map panned somewhere else
                entirely — the app should feel like one continuous map, not
                a full map and a separate, independent preview. */}
            <LiveMap
              position={position} zoom={PREVIEW_ZOOM}
              initialCenter={lastView?.center} initialZoom={lastView?.zoom}
              layer={layer} markerRadius={6} interactive={false}
            >
              <MapViewSync view={lastView} />
            </LiveMap>
          </div>
        )}
        <HeroLabel>Map</HeroLabel>
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
  const { type: condition } = getCondition(wx?.metar ?? null)

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

/* ── Pilot row — small dot reflects currency status. Goes straight to
   /pilot, whose own main screen IS the currency view now (medical +
   flight currency, with a logbook slotted in next); profile-editing
   fields live one level deeper at /profile ("Profile Setup"). ── */
function PilotRow({ currencyDotColor }) {
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
          <span style={{
            position: 'absolute', top: 10, right: 14, zIndex: 1,
            width: 9, height: 9, borderRadius: '50%',
            background: currencyDotColor, boxShadow: '0 0 0 2px rgba(255,255,255,0.7)',
          }} />
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
function SectionContent({ section, order, onMoveRow, onMapViewChange, mapView }) {
  if (section === 'checklists') return <Checklists />
  if (section === 'aircraft')   return <Hangar />
  if (section === 'map')        return <MapView onViewChange={onMapViewChange} lastView={mapView} />
  if (section === 'airports')   return <AirportInfo />
  if (section === 'tools')      return <ToolsMenu />
  if (section === 'settings')   return <Settings order={order} onMoveRow={onMoveRow} />
  if (section === 'discover')   return <Discover />
  return null
}

const DEFAULT_ORDER = ['map', 'airports', 'hangar', 'pilot', 'flight', 'discover']

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
  const [currencyStatus, setCurrencyStatus] = useState('valid')
  const [order, setOrder] = useState(DEFAULT_ORDER)
  // Last {center, zoom} the pilot left the real map screen at — null until
  // they've opened it at least once this session. Lifted up here (rather
  // than living inside MapView, which fully unmounts every time its overlay
  // closes) purely so it survives between an open/close cycle for
  // MapCard's preview to pick up; see MapView's ViewReporter/MapViewSync.
  const [mapView, setMapView] = useState(null)
  const activeAircraft = aircraftList?.find(a => a.id === aircraftId)
  const aircraftImage = activeAircraft?.image ?? ''
  function loadCurrencyStatus() {
    get('currency', 'profile').then(d => setCurrencyStatus(getGlobalCurrencyStatus(d ?? {})))
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

  const currencyDotColor =
    currencyStatus === 'expired'  ? 'var(--danger)' :
    currencyStatus === 'expiring' ? 'var(--warn)' :
    'var(--ok)'

  function renderRow(key) {
    if (key === 'airports') return <AirportsHeroCard key={key} onOpen={openCard} />
    if (key === 'map')      return <MapCard key={key} onOpen={openCard} lastView={mapView} />
    if (key === 'hangar')   return <HangarCard key={key} aircraftImage={aircraftImage} aircraftCount={aircraftList?.length ?? 0} onOpen={openCard} />
    if (key === 'pilot')    return <PilotRow key={key} currencyDotColor={currencyDotColor} />
    if (key === 'flight')   return <FlightPlanCard key={key} onOpen={openCard} />
    if (key === 'discover') return <DiscoverCard key={key} onOpen={openCard} />
    return null
  }

  return (
    <HomeLocationProvider>
      <div style={{
        height: '100dvh', overflow: 'hidden', boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column',
        padding: '14px 0 10px',
      }}>

        {order.map(renderRow)}

        {/* ── Tools / Settings ── */}
        <div style={{ padding: `${ROW_GAP}px 18px 0`}}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <ModuleCard section="tools"    onOpen={openCard} Icon={IconWrench} label="Tools" />
            <ModuleCard section="settings" onOpen={openCard} Icon={IconGear}   label="Settings" />
          </div>
        </div>
      </div>

      {openSection && sectionRect && (
        <CardOverlay cardRect={sectionRect} onClose={closeCard}>
          <SectionContent section={openSection} order={order} onMoveRow={moveRow} onMapViewChange={setMapView} mapView={mapView} />
        </CardOverlay>
      )}
    </HomeLocationProvider>
  )
}
