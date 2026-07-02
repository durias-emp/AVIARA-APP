import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { get, getAll } from '../../lib/db'
import WeatherCard   from '../../components/WeatherCard'
import CardOverlay   from '../../components/CardOverlay'
import { IconChevronRight, IconPlane } from '../../components/Icons'
import Checklists  from '../Checklists/Checklists'
import Calculators from '../Calculators/Calculators'
import Currency    from '../Currency/Currency'
import Reference   from '../Reference/Reference'
import Aircraft    from '../Aircraft/Aircraft'

/* ── Module card ─────────────────────────────────────────── */
function ModuleCard({ section, onOpen, icon, label, desc, stat, statColor, badge }) {
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
      borderRadius: 20,
      border: '0.5px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      padding: 14,
      WebkitTapHighlightColor: 'transparent',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <img src={icon} width={28} height={28}
          style={{ objectFit: 'contain', flexShrink: 0, marginTop: 1, filter: 'var(--icon-filter)' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {label}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.35 }}>
            {desc}
          </div>
        </div>
        <div style={{ color: 'var(--text-tertiary)', flexShrink: 0, marginTop: 2 }}>
          <IconChevronRight size={14} />
        </div>
      </div>

      <div style={{
        marginTop: 'auto', paddingTop: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 11, fontWeight: 500, color: statColor || 'var(--text-tertiary)' }}>
          {stat}
        </span>
        {badge && (
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.2px',
            color: badge.color, background: badge.bg,
            padding: '2px 7px', borderRadius: 10,
          }}>
            {badge.label}
          </span>
        )}
      </div>
    </div>
  )
}

/* ── Aircraft card ──────────────────────────────────────── */
function AircraftCard({ aircraftName, registration, aircraftImage, onOpen }) {
  const ref = useRef(null)

  function handleClick() {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect()
      onOpen('aircraft', { top: r.top, left: r.left, width: r.width, height: r.height })
    }
  }

  return (
    <div style={{ padding: '10px 18px 0' }}>
      <div ref={ref} onClick={handleClick} style={{
        background: 'var(--bg-card)', borderRadius: 20,
        border: '0.5px solid var(--border)',
        display: 'flex', alignItems: 'stretch',
        overflow: 'hidden', height: 90,
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}>
        <div style={{ flex: 1, padding: '12px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
            <span style={{ position: 'relative', display: 'flex', width: 6, height: 6 }}>
              <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#4ade80', opacity: 0.75, animation: 'ping 1.2s cubic-bezier(0,0,0.2,1) infinite' }} />
              <span style={{ position: 'relative', width: 6, height: 6, borderRadius: '50%', background: '#4ade80' }} />
            </span>
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Active Aircraft</span>
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.3px', lineHeight: 1.15 }}>
            {aircraftName || 'No aircraft set'}
          </div>
          {registration && (
            <div style={{ fontSize: 11, fontWeight: 600, fontFamily: 'monospace', color: 'var(--text-secondary)', letterSpacing: '1.5px', marginTop: 2 }}>
              {registration}
            </div>
          )}
        </div>
        <div style={{ width: 150, background: 'var(--bg-card)', position: 'relative', flexShrink: 0 }}>
          {aircraftImage && (
            <img src={aircraftImage} alt="" style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%',
              objectFit: 'contain', objectPosition: 'center',
            }} />
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Section content map ──────────────────────────────────── */
function SectionContent({ section }) {
  if (section === 'checklists') return <Checklists />
  if (section === 'calc')       return <Calculators />
  if (section === 'currency')   return <Currency />
  if (section === 'reference')  return <Reference />
  if (section === 'aircraft')   return <Aircraft />
  return null
}

/* ── Home ────────────────────────────────────────────────── */
export default function Home() {
  const [registration, setRegistration]   = useState('')
  const [pilotName, setPilotName]         = useState('')
  const [aircraftName, setAircraftName]   = useState('')
  const [aircraftImage, setAircraftImage] = useState('')
  const [clChecked, setClChecked]         = useState(null)
  const [weatherExpanded, setWeatherExpanded] = useState(false)
  const [openSection, setOpenSection]     = useState(null)
  const [sectionRect, setSectionRect]     = useState(null)
  const [flights, setFlights] = useState([
    { id: 3, route: 'KFLL → KMIA', date: 'Jun 17, 2026', duration: '0h 42m', aircraft: 'N4723A' },
    { id: 2, route: 'KOPF → KFLL', date: 'Jun 10, 2026', duration: '0h 28m', aircraft: 'N4723A' },
    { id: 1, route: 'KMIA → KFXE', date: 'Jun 5,  2026', duration: '1h 05m', aircraft: 'N4723A' },
  ])

  const CL_TOTAL = 15

  useEffect(() => {
    get('aircraft', 'profile').then(p => {
      if (p?.registration) setRegistration(p.registration)
      if (p?.pilotName)    setPilotName(p.pilotName)
      if (p?.fullName)     setAircraftName(p.fullName)
      if (p?.image)        setAircraftImage(p.image)
    })
    get('checklists', 'flight-plan').then(saved => {
      if (saved?.checked) setClChecked(saved.checked.length)
    })
    getAll('flights').then(stored => {
      if (stored.length > 0) setFlights([...stored].sort((a, b) => b.id - a.id))
    })
  }, [])

  function greeting() {
    const h = new Date().getHours()
    if (h >= 5  && h < 12) return 'Good morning'
    if (h >= 12 && h < 17) return 'Good afternoon'
    return 'Good evening'
  }

  function openCard(section, rect) {
    setSectionRect(rect)
    setOpenSection(section)
  }

  function closeCard() {
    setOpenSection(null)
    setSectionRect(null)
  }

  const clDone     = clChecked ?? 0
  const clComplete = clDone >= CL_TOTAL
  const clStarted  = clDone > 0 && !clComplete
  const clStat     = clChecked === null ? '1 checklist' : `${clDone} / ${CL_TOTAL} items`
  const clColor    = clComplete ? 'var(--ok)' : clStarted ? 'var(--warn)' : 'var(--text-tertiary)'
  const clBadge    = clComplete
    ? { label: 'Complete', color: 'var(--ok)',   bg: 'var(--ok-light)' }
    : clStarted
    ? { label: 'In progress', color: 'var(--warn)', bg: 'var(--warn-light)' }
    : null

  const anyExpanded = weatherExpanded || !!openSection

  return (
    <>
      <div style={{
        padding: '0 0 32px',
        transition: anyExpanded
          ? 'transform 420ms cubic-bezier(0.16, 1, 0.3, 1), opacity 300ms ease'
          : 'transform 300ms cubic-bezier(0.55, 0, 0.8, 0.9), opacity 260ms ease',
        transform: anyExpanded ? 'scale(0.93)' : 'scale(1)',
        opacity: anyExpanded ? 0.3 : 1,
        pointerEvents: anyExpanded ? 'none' : 'auto',
        transformOrigin: 'center top',
        willChange: 'transform, opacity',
      }}>

        {/* ── Header ── */}
        <div style={{
          padding: '28px 18px 22px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 15, color: 'var(--text-secondary)', letterSpacing: '0.01em', lineHeight: 1 }}>
              {greeting()}{pilotName ? ',' : ''}
            </div>
            <div style={{ fontSize: 36, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.8px', lineHeight: 1.1, marginTop: 4 }}>
              {pilotName || 'PQRH'}
            </div>
          </div>

          <Link to="/profile" style={{ textDecoration: 'none', flexShrink: 0 }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 20,
              background: 'var(--bg-card)', border: '0.5px solid var(--border)',
            }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.1px' }}>
                Pilot
              </span>
            </div>
          </Link>
        </div>

        {/* ── Weather hero ── */}
        <div style={{ padding: '0 18px' }}>
          <WeatherCard compact onOpenChange={setWeatherExpanded} />
        </div>

        {/* ── Aircraft card ── */}
        <AircraftCard
          aircraftName={aircraftName}
          registration={registration}
          aircraftImage={aircraftImage}
          onOpen={openCard}
        />

        {/* ── Module grid ── */}
        <div style={{ padding: '12px 18px 0' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>

            <ModuleCard
              section="checklists"
              onOpen={openCard}
              icon="/clipboard.png"
              label="Flight Planning"
              desc="Pre-flight · Briefing"
              stat={clStat}
              statColor={clColor}
              badge={clBadge}
            />

            <ModuleCard
              section="calc"
              onOpen={openCard}
              icon="/E6B CALC.svg"
              label="Calculators"
              desc="PA · DA · V-REF · XW"
              stat="4 calculators"
            />

            <ModuleCard
              section="currency"
              onOpen={openCard}
              icon="/cheque.png"
              label="Currency"
              desc="IM SAFE · IM CURRENT"
              stat="Set up required"
            />

            <ModuleCard
              section="reference"
              onOpen={openCard}
              icon="/libros.png"
              label="Reference"
              desc="Air law · Signals"
              stat="14 sections"
            />

          </div>

          {/* ── Flights ── */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginTop: 24, marginBottom: 10,
          }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.5px' }}>
              Flights
            </span>
          </div>

          <div style={{
            background: 'var(--bg-card)',
            borderRadius: 20,
            border: '0.5px solid var(--border)',
            overflow: 'hidden',
          }}>
            {flights.map((flight) => (
              <div key={flight.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '11px 16px',
                borderTop: '0.5px solid var(--border)',
              }}>
                <div style={{
                  width: 38, height: 38, borderRadius: 11, flexShrink: 0,
                  background: 'var(--accent-light)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--text-secondary)',
                }}>
                  <IconPlane size={18} />
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.3px', lineHeight: 1.2 }}>
                    {flight.route}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {flight.date}
                  </div>
                </div>

                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.3px', lineHeight: 1.2 }}>
                    {flight.duration}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {flight.aircraft}
                  </div>
                </div>

                <div style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>
                  <IconChevronRight size={14} />
                </div>
              </div>
            ))}

            {flights.length === 0 && (
              <div style={{ padding: '12px 16px 28px', textAlign: 'center' }}>
                <div style={{ fontSize: 13, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                  No flights logged yet
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                  Complete the Flight Plan checklist to log your first flight
                </div>
              </div>
            )}
          </div>

        </div>

        <p style={{ fontSize: 10, color: 'var(--text-tertiary)', textAlign: 'center', padding: '20px 24px 0', lineHeight: 1.5 }}>
          Reference aid only · Always consult current FAR/AIM
        </p>
      </div>

      {openSection && sectionRect && (
        <CardOverlay cardRect={sectionRect} onClose={closeCard}>
          <SectionContent section={openSection} />
        </CardOverlay>
      )}
    </>
  )
}
