import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { get, getAll } from '../../lib/db'
import WeatherCard from '../../components/WeatherCard'
import { IconChevronRight, IconPlane } from '../../components/Icons'

/* ── Module card ─────────────────────────────────────────── */
function ModuleCard({ to, icon, label, desc, stat, statColor, badge }) {
  return (
    <Link to={to} style={{
      textDecoration: 'none',
      background: 'var(--bg-card)',
      borderRadius: 20,
      border: '0.5px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      padding: 14,
    }}>
      {/* Header row */}
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

      {/* Stat row — pushed to bottom via auto margin */}
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
    </Link>
  )
}

/* ── Home ────────────────────────────────────────────────── */
export default function Home() {
  const [registration, setRegistration] = useState('')
  const [pilotName, setPilotName]       = useState('')
  const [aircraftName, setAircraftName] = useState('')
  const [aircraftImage, setAircraftImage] = useState('')
  const [clChecked, setClChecked]       = useState(null)
  const [flights, setFlights]           = useState([
    { id: 3, route: 'KFLL → KMIA', date: 'Jun 17, 2026', duration: '0h 42m', aircraft: 'N4723A' },
    { id: 2, route: 'KOPF → KFLL', date: 'Jun 10, 2026', duration: '0h 28m', aircraft: 'N4723A' },
    { id: 1, route: 'KMIA → KFXE', date: 'Jun 5,  2026', duration: '1h 05m', aircraft: 'N4723A' },
  ])

  const CL_TOTAL = 12   // static: Flight Plan checklist has 12 checkable items (incl. W&B)

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

  // Checklist status
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

  return (
    <div style={{ padding: '0 0 32px' }}>

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
        <WeatherCard compact />
      </div>

      {/* ── Aircraft card ── */}
      <div style={{ padding: '10px 18px 0' }}>
        <Link to="/aircraft" style={{ textDecoration: 'none' }}>
          <div style={{
            background: 'var(--bg-card)', borderRadius: 20,
            border: '0.5px solid var(--border)',
            display: 'flex', alignItems: 'stretch',
            overflow: 'hidden', height: 90,
          }}>
            {/* Info */}
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
            {/* Image */}
            <div style={{ width: 150, background: 'var(--bg-card)', position: 'relative', flexShrink: 0 }}>
              {aircraftImage && (
                <img src={aircraftImage} alt="" style={{
                  position: 'absolute', inset: 0,
                  width: '100%', height: '100%',
                  objectFit: 'contain', objectPosition: 'center',
                  mixBlendMode: 'screen',
                }} />
              )}
            </div>
          </div>
        </Link>
      </div>

      {/* ── Module grid ── */}
      <div style={{ padding: '12px 18px 0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>

          <ModuleCard
            to="/checklists"
            icon="/clipboard.png"
            label="Flight Planning"
            desc="Pre-flight · Briefing"
            stat={clStat}
            statColor={clColor}
            badge={clBadge}
          />

          <ModuleCard
            to="/calc"
            icon="/E6B CALC.svg"
            label="Calculators"
            desc="PA · DA · V-REF · XW"
            stat="4 calculators"
          />

          <ModuleCard
            to="/currency"
            icon="/cheque.png"
            label="Currency"
            desc="IM SAFE · IM CURRENT"
            stat="Set up required"
          />

          <ModuleCard
            to="/reference"
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
  )
}
