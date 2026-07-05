import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { get, getAll, put } from '../../lib/db'
import WeatherCard   from '../../components/WeatherCard'
import CardOverlay   from '../../components/CardOverlay'
import FlightDetailDrawer from '../../components/FlightDetailDrawer'
import { IconChevronRight } from '../../components/Icons'
import Checklists  from '../Checklists/Checklists'
import Calculators from '../Calculators/Calculators'
import Currency    from '../Currency/Currency'
import Reference   from '../Reference/Reference'
import Aircraft    from '../Aircraft/Aircraft'

/* ── Flight record formatting ────────────────────────────── */
function fmtFlightRoute(flight) {
  if (flight.route) return flight.route
  if (flight.dep && flight.dest) return `${flight.dep} → ${flight.dest}`
  return flight.dep || flight.dest || 'Flight logged'
}

function fmtFlightDate(flight) {
  if (flight.date) return flight.date
  const iso = flight.savedAt
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtFlightDuration(flight) {
  if (flight.duration) return flight.duration
  const h = flight.flightTimeH
  if (h == null) return '—'
  const totalMin = Math.round(h * 60)
  return `${Math.floor(totalMin / 60)}h ${String(totalMin % 60).padStart(2, '0')}m`
}

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
      minWidth: 0,
      WebkitTapHighlightColor: 'transparent',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <img src={icon} width={28} height={28}
          style={{ objectFit: 'contain', flexShrink: 0, marginTop: 1, filter: 'var(--icon-filter)' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {label}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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

/* ── Hobbs quick-input — matches the registration text's size/style,
   sits inline on the same row instead of its own boxed chip ────── */
const REG_TEXT_STYLE = {
  fontSize: 11, fontWeight: 600, fontFamily: 'monospace',
  color: 'var(--text-secondary)', letterSpacing: '1.5px',
}

function HobbsInput({ hobbsTime, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState('')
  const inputRef = useRef(null)

  function startEdit(e) {
    e.stopPropagation()
    setDraft(hobbsTime != null ? String(hobbsTime) : '')
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function commit() {
    setEditing(false)
    const val = parseFloat(draft)
    if (!Number.isNaN(val) && val !== hobbsTime) onSave(val)
  }

  return (
    <span onClick={e => e.stopPropagation()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ ...REG_TEXT_STYLE, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Hobbs</span>
      {editing ? (
        <input
          ref={inputRef}
          type="number"
          inputMode="decimal"
          step="0.1"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => e.key === 'Enter' && inputRef.current?.blur()}
          placeholder={hobbsTime != null ? String(hobbsTime) : '0.0'}
          style={{
            ...REG_TEXT_STYLE, width: 54,
            background: 'none', border: 'none', outline: 'none', padding: 0,
          }}
        />
      ) : (
        <span onClick={startEdit} style={{ ...REG_TEXT_STYLE, cursor: 'text' }}>
          {hobbsTime != null ? hobbsTime.toFixed(1) : 'Set'}
        </span>
      )}
    </span>
  )
}

/* ── Aircraft card ──────────────────────────────────────── */
function AircraftCard({ aircraftName, registration, aircraftImage, hobbsTime, onSaveHobbs, onOpen }) {
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
        overflow: 'hidden', minHeight: 90,
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}>
        <div style={{ flex: 1, padding: '12px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80', flexShrink: 0 }} />
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Active Aircraft</span>
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.3px', lineHeight: 1.15 }}>
            {aircraftName || 'No aircraft set'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
            {registration && (
              <span style={{ fontSize: 11, fontWeight: 600, fontFamily: 'monospace', color: 'var(--text-secondary)', letterSpacing: '1.5px' }}>
                {registration}
              </span>
            )}
            <HobbsInput hobbsTime={hobbsTime} onSave={onSaveHobbs} />
          </div>
        </div>
        <div style={{ width: 150, position: 'relative', flexShrink: 0 }}>
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
  const [hobbsTime, setHobbsTime]         = useState(null)
  const [clChecked, setClChecked]         = useState(null)
  const [weatherExpanded, setWeatherExpanded] = useState(false)
  const [openSection, setOpenSection]     = useState(null)
  const [sectionRect, setSectionRect]     = useState(null)
  const [flights, setFlights] = useState([])
  const [selectedFlight, setSelectedFlight] = useState(null)

  const CL_TOTAL = 15

  useEffect(() => {
    get('aircraft', 'profile').then(p => {
      if (p?.registration) setRegistration(p.registration)
      if (p?.pilotName)    setPilotName(p.pilotName)
      if (p?.fullName)     setAircraftName(p.fullName)
      if (p?.image)        setAircraftImage(p.image)
      if (p?.hobbsTime != null) setHobbsTime(p.hobbsTime)
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
    if (openSection === 'aircraft') {
      get('aircraft', 'profile').then(p => {
        if (p?.registration) setRegistration(p.registration)
        if (p?.pilotName)    setPilotName(p.pilotName)
        if (p?.fullName)     setAircraftName(p.fullName)
        if (p?.image)        setAircraftImage(p.image)
        if (p?.hobbsTime != null) setHobbsTime(p.hobbsTime)
      })
    }
    setOpenSection(null)
    setSectionRect(null)
  }

  async function saveHobbs(val) {
    setHobbsTime(val)
    const p = await get('aircraft', 'profile')
    await put('aircraft', { ...(p ?? {}), id: 'profile', hobbsTime: val, hobbsUpdatedAt: Date.now() })
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
          hobbsTime={hobbsTime}
          onSaveHobbs={saveHobbs}
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
              desc="IM CURRENT · IM VALID"
              stat="Set up required"
            />

            <ModuleCard
              section="reference"
              onOpen={openCard}
              icon="/libros.png"
              label="Quick Reference"
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
              <div
                key={flight.id}
                onClick={() => setSelectedFlight(flight)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '11px 16px',
                  borderTop: '0.5px solid var(--border)',
                  cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                }}>
                <div style={{
                  width: 38, height: 38, borderRadius: 11, flexShrink: 0,
                  background: 'var(--accent-light)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <img
                    src={flight.category === 'helicopter' ? '/helicopter.png' : '/modo-avion.png'}
                    width={18} height={18} alt=""
                    style={{ objectFit: 'contain', filter: 'var(--icon-filter)' }}
                  />
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.3px', lineHeight: 1.2 }}>
                    {fmtFlightRoute(flight)}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {fmtFlightDate(flight)}
                  </div>
                </div>

                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.3px', lineHeight: 1.2 }}>
                    {fmtFlightDuration(flight)}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {flight.registration || flight.aircraft || '—'}
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

      {selectedFlight && (
        <FlightDetailDrawer flight={selectedFlight} onClose={() => setSelectedFlight(null)} />
      )}
    </>
  )
}
