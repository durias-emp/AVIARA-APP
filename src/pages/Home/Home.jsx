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
import MapView, { LiveMap } from '../../components/MapView'
import AirportInfo from '../../components/AirportInfo'
import ToolsMenu from '../../components/ToolsMenu'
import { AirportScene, PilotArt, HangarArt, FlightPlanArt } from '../../components/HomeHeroArt'
import HeroLabel, { HERO_LABEL_WIDTH } from '../../components/HeroLabel'
import { useCurrentLocation } from '../../hooks/useCurrentLocation'
import { useMapLayer } from '../../hooks/useMapLayer'
import { IconWrench, IconGear } from '../../components/Icons'
import Checklists from '../Checklists/Checklists'
import Hangar     from '../Aircraft/Hangar'
import Settings   from '../Settings/Settings'

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

function MapCard({ onOpen }) {
  const ref = useRef(null)
  const { position, status } = useCurrentLocation()
  const { layer } = useMapLayer()

  function handleClick() {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect()
      onOpen('map', { top: r.top, left: r.left, width: r.width, height: r.height })
    }
  }

  return (
    <div style={{ padding: `${ROW_GAP}px 18px 0`}}>
      <div
        ref={ref}
        onClick={handleClick}
        role="button"
        aria-label="Open map"
        style={{
          background: 'var(--bg-card)', borderRadius: 20,
          boxShadow: 'var(--shadow-sm)',
          overflow: 'hidden', position: 'relative', isolation: 'isolate',
          height: HERO_HEIGHT,
          cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
        }}>
        {status !== 'pending' && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <LiveMap position={position} zoom={PREVIEW_ZOOM} layer={layer} markerRadius={6} interactive={false} />
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
        {pickerOpen && <AirportPickerModal current={icao} onConfirm={confirmAirport} onClose={() => setPicker(false)} />}
      </div>
    )
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

/* ── Pilot row — small dot reflects currency status, since currency
   lives inside the Pilot Profile page now rather than its own Home
   button. ── */
function PilotRow({ currencyDotColor }) {
  return (
    <div style={{ padding: `${ROW_GAP}px 18px 0`}}>
      <Link to="/profile" style={{ textDecoration: 'none' }}>
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
function SectionContent({ section, order, onMoveRow }) {
  if (section === 'checklists') return <Checklists />
  if (section === 'aircraft')   return <Hangar />
  if (section === 'map')        return <MapView />
  if (section === 'airports')   return <AirportInfo />
  if (section === 'tools')      return <ToolsMenu />
  if (section === 'settings')   return <Settings order={order} onMoveRow={onMoveRow} />
  return null
}

const DEFAULT_ORDER = ['airports', 'map', 'hangar', 'pilot', 'flight']

/* ── Home ────────────────────────────────────────────────── */
export default function Home() {
  const { aircraftId, aircraftList, refreshAircraftList } = useActiveAircraft()
  const [openSection, setOpenSection]     = useState(null)
  const [sectionRect, setSectionRect]     = useState(null)
  const [currencyStatus, setCurrencyStatus] = useState('valid')
  const [order, setOrder] = useState(DEFAULT_ORDER)
  const activeAircraft = aircraftList?.find(a => a.id === aircraftId)
  const aircraftImage = activeAircraft?.image ?? ''
  function loadCurrencyStatus() {
    get('currency', 'profile').then(d => setCurrencyStatus(getGlobalCurrencyStatus(d ?? {})))
  }

  useEffect(() => {
    loadCurrencyStatus()
    get('settings', 'homeOrder').then(row => {
      if (!Array.isArray(row?.value)) return
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
    if (key === 'map')      return <MapCard key={key} onOpen={openCard} />
    if (key === 'hangar')   return <HangarCard key={key} aircraftImage={aircraftImage} aircraftCount={aircraftList?.length ?? 0} onOpen={openCard} />
    if (key === 'pilot')    return <PilotRow key={key} currencyDotColor={currencyDotColor} />
    if (key === 'flight')   return <FlightPlanCard key={key} onOpen={openCard} />
    return null
  }

  return (
    <>
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

        <p style={{
          fontSize: 10, color: 'var(--text-tertiary)', textAlign: 'center',
          padding: '10px 24px 0', lineHeight: 1.4, flexShrink: 0,
        }}>
          Reference aid only · Always consult current FAR/AIM
        </p>
      </div>

      {openSection && sectionRect && (
        <CardOverlay cardRect={sectionRect} onClose={closeCard}>
          <SectionContent section={openSection} order={order} onMoveRow={moveRow} />
        </CardOverlay>
      )}
    </>
  )
}
