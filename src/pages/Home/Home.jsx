import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { get, put } from '../../lib/db'
import { getGlobalCurrencyStatus } from '../../lib/currency'
import WeatherCard   from '../../components/WeatherCard'
import CardOverlay   from '../../components/CardOverlay'
import MapView, { LiveMap } from '../../components/MapView'
import AirportInfo from '../../components/AirportInfo'
import ToolsMenu from '../../components/ToolsMenu'
import { PilotArt, HangarArt, FlightPlanArt } from '../../components/HomeHeroArt'
import HeroLabel from '../../components/HeroLabel'
import { BackButton } from '../../components/Shell'
import { useCurrentLocation } from '../../hooks/useCurrentLocation'
import { useMapLayer } from '../../hooks/useMapLayer'
import { IconChevronRight, IconWrench, IconGear } from '../../components/Icons'
import Checklists from '../Checklists/Checklists'
import Aircraft   from '../Aircraft/Aircraft'
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
    <div ref={ref} onClick={handleClick} style={{
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
function HangarCard({ aircraftImage, onOpen }) {
  const ref = useRef(null)

  function handleClick() {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect()
      onOpen('aircraft', { top: r.top, left: r.left, width: r.width, height: r.height })
    }
  }

  return (
    <div style={{ padding: `${ROW_GAP}px 18px 0`}}>
      <div ref={ref} onClick={handleClick} style={{
        position: 'relative', overflow: 'hidden', borderRadius: 20, isolation: 'isolate',
        boxShadow: 'var(--shadow-sm)',
        height: HERO_HEIGHT, boxSizing: 'border-box',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}>
        {aircraftImage ? (
          <img src={aircraftImage} alt="" style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            objectFit: 'cover', objectPosition: 'center',
          }} />
        ) : (
          <HangarArt />
        )}

        <div style={{
          position: 'absolute', inset: 0, zIndex: 0,
          background: 'linear-gradient(108deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.3) 55%, rgba(0,0,0,0.05) 100%)',
        }} />

        <HeroLabel>Hangar</HeroLabel>
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

/* ── Airports card — doubles as the live weather button (VFR/MVFR/IFR/
   LIFR color-coded, same as before), since checking weather is part of
   what the Airports section is for. Tapping it opens Airports directly
   instead of the standalone METAR/TAF popup. ── */
function AirportsCard({ onOpen }) {
  return (
    <div style={{ padding: `${ROW_GAP}px 18px 0`}}>
      <WeatherCard
        mini
        label="Airports"
        showChevron
        height={HERO_HEIGHT}
        onCardClick={rect => onOpen('airports', rect)}
      />
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
      <div ref={ref} onClick={handleClick} style={{
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
        <HeroLabel>Flight</HeroLabel>
        <span style={{
          position: 'absolute', top: '50%', right: 18, transform: 'translateY(-50%)',
          zIndex: 1, color: '#fff', display: 'flex',
        }}>
          <IconChevronRight size={18} />
        </span>
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
          <span style={{
            position: 'absolute', top: '50%', right: 18, transform: 'translateY(-50%)',
            zIndex: 1, color: '#fff', display: 'flex',
          }}>
            <IconChevronRight size={18} />
          </span>
        </div>
      </Link>
    </div>
  )
}

/* ── Reorder screen — plain list, up/down arrows. Not drag-and-drop:
   these rows have real interactive content (live map, weather fetch),
   and a full drag gesture would fight the app's existing edge-swipe-back
   gesture — up/down is simpler and just as functional. Changes save
   immediately, no separate "Save" step. ── */
const ROW_LABELS = {
  airports: 'Airports (Weather)',
  map: 'Map',
  hangar: 'Hangar',
  pilot: 'Pilot',
  flight: 'Flight Planning',
}

function ReorderScreen({ order, onMove }) {
  return (
    <div>
      <div style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <BackButton />
        <h2 style={{
          fontSize: 28, fontWeight: 700, letterSpacing: '-0.4px', color: 'var(--text)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
        }}>Reorder Home</h2>
      </div>

      <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {order.map((key, i) => (
          <div key={key} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'var(--bg-card)', borderRadius: 14, boxShadow: 'var(--shadow-sm)',
            padding: '13px 16px',
          }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{ROW_LABELS[key]}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => onMove(i, -1)}
                disabled={i === 0}
                style={{
                  width: 32, height: 32, borderRadius: 10, border: 'none',
                  background: 'var(--bg-card-2)', color: i === 0 ? 'var(--text-tertiary)' : 'var(--text)',
                  fontSize: 16, cursor: i === 0 ? 'default' : 'pointer',
                }}>↑</button>
              <button
                onClick={() => onMove(i, 1)}
                disabled={i === order.length - 1}
                style={{
                  width: 32, height: 32, borderRadius: 10, border: 'none',
                  background: 'var(--bg-card-2)', color: i === order.length - 1 ? 'var(--text-tertiary)' : 'var(--text)',
                  fontSize: 16, cursor: i === order.length - 1 ? 'default' : 'pointer',
                }}>↓</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Section content map ──────────────────────────────────── */
function SectionContent({ section }) {
  if (section === 'checklists') return <Checklists />
  if (section === 'aircraft')   return <Aircraft />
  if (section === 'map')        return <MapView />
  if (section === 'airports')   return <AirportInfo />
  if (section === 'tools')      return <ToolsMenu />
  if (section === 'settings')   return <Settings />
  return null
}

const DEFAULT_ORDER = ['airports', 'map', 'hangar', 'pilot', 'flight']

/* ── Home ────────────────────────────────────────────────── */
export default function Home() {
  const [pilotName, setPilotName]         = useState('')
  const [aircraftImage, setAircraftImage] = useState('')
  const [openSection, setOpenSection]     = useState(null)
  const [sectionRect, setSectionRect]     = useState(null)
  const [currencyStatus, setCurrencyStatus] = useState('valid')
  const [order, setOrder] = useState(DEFAULT_ORDER)
  const editRef = useRef(null)

  function loadCurrencyStatus() {
    get('currency', 'profile').then(d => setCurrencyStatus(getGlobalCurrencyStatus(d ?? {})))
  }

  useEffect(() => {
    get('aircraft', 'profile').then(p => {
      if (p?.pilotName) setPilotName(p.pilotName)
      if (p?.image)     setAircraftImage(p.image)
    })
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
    if (openSection === 'aircraft') {
      get('aircraft', 'profile').then(p => {
        if (p?.pilotName) setPilotName(p.pilotName)
        if (p?.image)     setAircraftImage(p.image)
      })
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

  function handleEditClick() {
    if (editRef.current) {
      const r = editRef.current.getBoundingClientRect()
      openCard('reorder', { top: r.top, left: r.left, width: r.width, height: r.height })
    }
  }

  const currencyDotColor =
    currencyStatus === 'expired'  ? 'var(--danger)' :
    currencyStatus === 'expiring' ? 'var(--warn)' :
    'var(--ok)'

  function renderRow(key) {
    if (key === 'airports') return <AirportsCard key={key} onOpen={openCard} />
    if (key === 'map')      return <MapCard key={key} onOpen={openCard} />
    if (key === 'hangar')   return <HangarCard key={key} aircraftImage={aircraftImage} onOpen={openCard} />
    if (key === 'pilot')    return <PilotRow key={key} currencyDotColor={currencyDotColor} />
    if (key === 'flight')   return <FlightPlanCard key={key} onOpen={openCard} />
    return null
  }

  return (
    <>
      <div style={{
        height: '100dvh', overflow: 'hidden', boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column',
        padding: '10px 0 10px',
      }}>

        {/* ── Edit-order trigger ── */}
        <div style={{ padding: '0 18px 6px', display: 'flex', justifyContent: 'flex-end' }}>
          <button ref={editRef} onClick={handleEditClick} style={{
            background: 'none', border: 'none', padding: '4px 2px',
            fontSize: 12, fontWeight: 700, color: 'var(--accent)', cursor: 'pointer',
          }}>
            Edit Order
          </button>
        </div>

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
          {openSection === 'reorder'
            ? <ReorderScreen order={order} onMove={moveRow} />
            : <SectionContent section={openSection} />}
        </CardOverlay>
      )}
    </>
  )
}
