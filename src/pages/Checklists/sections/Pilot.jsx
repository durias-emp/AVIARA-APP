import { useState, useEffect } from 'react'
import { get, put } from '../../../lib/db'
import { getCurrencyStatus, fmtDate, fmtDaysLeft, calendarMonthExpiry, statusFromExpiry } from '../../../lib/currency'
import { ExpandableCard, DoneButton } from '../shared/ui'

/* ── IM SAFE / CURRENT / VALID / AIRWORTHY checklist cards ──── */
const IMSAFE_ITEMS = [
  { key: 'illness',    letter: 'I', label: 'Illness',    detail: 'No symptoms affecting performance' },
  { key: 'medication', letter: 'M', label: 'Medication', detail: 'None affecting performance or judgment' },
  { key: 'stress',     letter: 'S', label: 'Stress',     detail: 'Psychological pressure manageable' },
  { key: 'alcohol',    letter: 'A', label: 'Alcohol',    detail: '8 hrs bottle-to-throttle · BAC < 0.04%' },
  { key: 'fatigue',    letter: 'F', label: 'Fatigue',    detail: 'Rested and alert' },
  { key: 'eating',     letter: 'E', label: 'Eating',     detail: 'Adequately nourished and hydrated' },
]

function imStatusColor(status) {
  if (status === 'valid')     return 'var(--ok)'
  if (status === 'expiring')  return '#f59e0b'
  if (status === 'expired')   return 'var(--danger)'
  return 'var(--text-tertiary)'
}

function imStatusLabel(status) {
  if (status === 'valid')      return 'Current'
  if (status === 'expiring')   return 'Expiring'
  if (status === 'expired')    return 'Expired'
  if (status === 'incomplete') return 'Incomplete'
  return 'Not set'
}

function IMSafeRow({ letter, label, detail, checked, onToggle }) {
  return (
    <div
      onClick={onToggle}
      style={{
        padding: '9px 16px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', gap: 8, cursor: 'pointer',
      }}
    >
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{letter} {label}</div>
        {detail && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{detail}</div>}
      </div>
      <div style={{
        width: 20, height: 20, borderRadius: 6, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: checked ? 'var(--text)' : 'transparent',
        border: `1.5px solid ${checked ? 'var(--text)' : 'var(--border-strong)'}`,
        transition: 'all 0.2s',
      }}>
        {checked && (
          <svg width={11} height={11} viewBox="0 0 24 24" fill="none" style={{ color: 'var(--bg-card)' }}>
            <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </div>
    </div>
  )
}

function IMStatusRow({ label, detail, status, extra }) {
  const color = imStatusColor(status)
  return (
    <div style={{ padding: '9px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{label}</div>
        {detail && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{detail}</div>}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color }}>{imStatusLabel(status)}</div>
        {extra && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>{extra}</div>}
      </div>
    </div>
  )
}

export function IMChecklistItem({ item, isChecked, onToggle, statusKey }) {
  const [open, setOpen]       = useState(false)
  const [currData, setCurrData] = useState(null)

  useEffect(() => {
    get('currency', 'profile').then(d => setCurrData(d ?? {}))
  }, [open])

  const cs = currData ? getCurrencyStatus(currData) : null
  const overallStatus = cs?.[statusKey]?.status ?? 'incomplete'
  const okColor = imStatusColor(overallStatus)

  function toggleSafeItem(key) {
    setCurrData(prev => {
      const next = { ...prev, safe: { ...prev.safe, [key]: !(prev.safe?.[key] === true) } }
      put('currency', { ...next, id: 'profile' }).catch(() => {})
      return next
    })
  }

  // ── card content per statusKey ────────────────────────────────
  function renderContent() {
    if (!currData || !cs) {
      return <div style={{ padding: '16px', fontSize: 13, color: 'var(--text-tertiary)', textAlign: 'center' }}>Loading...</div>
    }

    if (statusKey === 'safe') {
      return IMSAFE_ITEMS.map(it => {
        const checked = currData.safe?.[it.key] === true
        return (
          <IMSafeRow
            key={it.key}
            letter={it.letter}
            label={it.label}
            detail={it.detail}
            checked={checked}
            onToggle={() => toggleSafeItem(it.key)}
          />
        )
      })
    }

    if (statusKey === 'current') {
      const c = currData.current ?? {}
      const frExp  = c.flightReviewDate ? calendarMonthExpiry(c.flightReviewDate, 24) : null
      const ipcExp = c.ipcDate          ? calendarMonthExpiry(c.ipcDate, 6)            : null
      const fr  = frExp  ? statusFromExpiry(frExp,  30) : { status: 'incomplete' }
      const day = { status: c.dayCurrent   === true ? 'valid' : 'incomplete' }
      const nig = { status: c.nightCurrent === true ? 'valid' : 'incomplete' }
      const ifr = c.ipcDate
        ? statusFromExpiry(ipcExp, 30)
        : { status: c.ifrCurrent === true ? 'valid' : 'incomplete' }
      return (<>
        <IMStatusRow label="Flight Review" detail="FAR 61.56 · 24 calendar months" status={fr.status}
          extra={frExp ? `Exp ${fmtDate(frExp)} · ${fmtDaysLeft(fr.daysLeft)}` : null} />
        <IMStatusRow label="Day Passenger Currency" detail="FAR 61.57(a) · 90 days" status={day.status} />
        <IMStatusRow label="Night Passenger Currency" detail="FAR 61.57(b) · 90 days" status={nig.status} />
        <IMStatusRow label="IFR Currency" detail="FAR 61.57(c) · 6 months" status={ifr.status}
          extra={ipcExp ? `Exp ${fmtDate(ipcExp)} · ${fmtDaysLeft(ifr.daysLeft)}` : null} />
      </>)
    }

    if (statusKey === 'valid') {
      const m = currData.medical ?? {}
      if (!m.examDate || !m.dob || !m.medClass) {
        return <div style={{ padding: '16px', fontSize: 13, color: 'var(--text-tertiary)', textAlign: 'center' }}>Set up medical info in the Currency section.</div>
      }
      const examLabel = `FAR 61.23(d) · Exam ${fmtDate(new Date(m.examDate))}`
      return cs.valid.tiers.map(t => (
        <IMStatusRow
          key={t.tier}
          label={t.label}
          detail={examLabel}
          status={t.status}
          extra={t.expiresOn ? `Exp ${fmtDate(t.expiresOn)} · ${fmtDaysLeft(t.daysLeft)}` : null}
        />
      ))
    }

    if (statusKey === 'airworthy') {
      const a = currData.airworthy ?? {}
      const annExp = a.annualDate      ? calendarMonthExpiry(a.annualDate, 12)      : null
      const trExp  = a.transponderDate ? calendarMonthExpiry(a.transponderDate, 24) : null
      const ptExp  = a.pitotDate       ? calendarMonthExpiry(a.pitotDate, 24)       : null
      const ann = annExp ? statusFromExpiry(annExp, 30) : { status: 'incomplete' }
      const tr  = trExp  ? statusFromExpiry(trExp,  30) : { status: 'incomplete' }
      const pt  = ptExp  ? statusFromExpiry(ptExp,  30) : { status: 'incomplete' }
      return (<>
        <IMStatusRow label="Annual Inspection" detail="FAR 91.409 · 12 calendar months" status={ann.status}
          extra={annExp ? `Exp ${fmtDate(annExp)} · ${fmtDaysLeft(ann.daysLeft)}` : null} />
        <IMStatusRow label="Transponder" detail="FAR 91.413 · 24 calendar months" status={tr.status}
          extra={trExp ? `Exp ${fmtDate(trExp)} · ${fmtDaysLeft(tr.daysLeft)}` : null} />
        <IMStatusRow label="Pitot-Static" detail="FAR 91.411 · 24 calendar months" status={pt.status}
          extra={ptExp ? `Exp ${fmtDate(ptExp)} · ${fmtDaysLeft(pt.daysLeft)}` : null} />
      </>)
    }
    return null
  }

  return (
    <div style={{ marginBottom: 8 }}>
      {/* Card header */}
      <div style={{
        background: 'var(--bg-card)',
        borderBottom: open ? 'none' : '0.5px solid var(--border)',
        borderRadius: open ? '14px 14px 0 0' : 14,
        overflow: 'hidden',
        boxShadow: 'var(--shadow-sm)',
      }}>
        <button
          onClick={() => setOpen(o => !o)}
          style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '13px 14px', textAlign: 'left' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{
                fontSize: 15, fontWeight: 600, letterSpacing: '-0.2px',
                color: isChecked ? 'var(--text-tertiary)' : 'var(--text)',
              }}>{item.label}</div>
              {item.sub && !isChecked && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 3 }}>{item.sub}</div>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              {/* Live status dot from currency data */}
              <div style={{
                width: 7, height: 7, borderRadius: '50%',
                background: currData ? okColor : 'transparent',
                border: `1.5px solid ${currData ? okColor : 'var(--border-strong)'}`,
                flexShrink: 0,
              }} />
              {/* Checkmark toggle */}
              <div
                onClick={e => { e.stopPropagation(); onToggle(item.id) }}
                style={{
                  width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: isChecked ? 'var(--text)' : 'transparent',
                  border: `1.5px solid ${isChecked ? 'var(--text)' : 'var(--border-strong)'}`,
                  transition: 'all 0.2s', cursor: 'pointer',
                }}
              >
                {isChecked && (
                  <svg width={11} height={11} viewBox="0 0 24 24" fill="none" style={{ color: 'var(--bg-card)' }}>
                    <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
            </div>
          </div>
        </button>
      </div>

      {/* Expanded body */}
      {open && (
        <div style={{
          background: 'var(--bg-card)', borderTop: 'none', borderRadius: '0 0 14px 14px', overflow: 'hidden',
        }}>
          {renderContent()}
          {statusKey === 'safe' ? (
            <DoneButton
              isChecked={isChecked}
              onDone={() => { onToggle(item.id); setOpen(false) }}
              checkedIds={new Set(IMSAFE_ITEMS.filter(it => currData?.safe?.[it.key] === true).map(it => it.key))}
              subIds={IMSAFE_ITEMS.map(it => it.key)}
            />
          ) : (
            /* Source of truth lives in the Currency section. Header
               checkmark auto-fills the moment that data reads as valid. */
            <DoneButton
              isChecked={isChecked}
              onDone={() => { if (!isChecked) onToggle(item.id); setOpen(false) }}
              checkedIds={overallStatus === 'valid' ? new Set(['ok']) : new Set()}
              subIds={['ok']}
              autoCheck
              onAutoComplete={() => onToggle(item.id)}
            />
          )}
        </div>
      )}
    </div>
  )
}

/* ── Overflight checklist ────────────────────────────────────── */
export function OverflightItem({ item, isChecked, onToggle }) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(new Set())

  const TERRAIN = [
    {
      id: 'water', label: 'Water',
      items: ['Life jacket / flotation device aboard', 'Glide range reaches shore or vessel', 'Survival equipment for water temp', 'Filed flight plan with overwater leg'],
    },
    {
      id: 'mountains', label: 'Mountains',
      items: ['Terrain clearance. 1,000 ft above highest within 5 NM', 'Escape route identified for each leg', 'Turbulence / downdraft margins planned', 'Density altitude checked at cruise level', 'No-return point identified'],
    },
    {
      id: 'builtup', label: 'Built-up areas',
      items: ['Min 1,000 ft AGL above highest obstacle within 2,000 ft', 'Emergency landing area identified', 'Noise abatement procedures noted'],
    },
    {
      id: 'aero', label: 'Aerodromes',
      items: ['Cross at min 500 ft above circuit altitude', 'Monitor MF / CTAF frequency', 'Note traffic pattern direction'],
    },
    {
      id: 'oxygen', label: 'Oxygen',
      items: ['Above 10,000 ft MSL > 30 min: supplemental O₂ required (crew)', 'Above 12,500 ft MSL: supplemental O₂ required', 'Passengers: O₂ available above 10,000 ft', 'O₂ equipment inspected and quantity sufficient'],
    },
  ]

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const activeTerrains = TERRAIN.filter(t => selected.has(t.id))

  return (
    <ExpandableCard item={item} isChecked={isChecked} onToggle={onToggle} open={open} setOpen={setOpen}>
          {/* Terrain type selector */}
          <div style={{ padding: '14px 14px 12px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 10 }}>
              What are you flying over?
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {TERRAIN.map(t => {
                const active = selected.has(t.id)
                return (
                  <button key={t.id} onClick={() => toggle(t.id)} style={{
                    padding: '6px 12px', borderRadius: 20,
                    border: `0.5px solid ${active ? 'var(--text)' : 'var(--border)'}`,
                    background: active ? 'var(--text)' : 'var(--bg-card-2)',
                    color: active ? 'var(--bg)' : 'var(--text-secondary)',
                    fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}>{t.label}</button>
                )
              })}
            </div>
          </div>

          {/* Considerations for selected terrain types */}
          {activeTerrains.length > 0 && (
            <div style={{}}>
              {activeTerrains.map((t, ti) => (
                <div key={t.id} style={{ padding: '12px 14px', borderTop: ti > 0 ? '0.5px solid var(--border)' : 'none' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.4px', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 8 }}>
                    {t.label}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {t.items.map((req, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'flex-start', gap: 8,
                        padding: '6px 0',
                        borderTop: i > 0 ? '0.5px solid var(--border)' : 'none',
                      }}>
                        <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--text-tertiary)', flexShrink: 0, marginTop: 5 }} />
                        <span style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.45 }}>{req}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTerrains.length === 0 && (
            <div style={{ padding: '12px 14px 10px' }}>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center' }}>
                Select terrain types above to see considerations
              </div>
            </div>
          )}
          <DoneButton isChecked={isChecked} onDone={() => { onToggle(item.id); setOpen(false) }} />
    </ExpandableCard>
  )
}

/* ── Oxygen requirements reference ──────────────────────────── */
const O2_RULES = [
  { alt: 'Below 12,500 ft MSL', rule: 'No oxygen required', ok: true },
  { alt: '12,500 – 14,000 ft MSL', rule: 'Required if at altitude more than 30 min', warn: true },
  { alt: 'Above 14,000 ft MSL', rule: 'Flight crew must use oxygen at all times', danger: true },
  { alt: 'Above 15,000 ft MSL', rule: 'Must provide oxygen to each occupant', danger: true },
]

export function OxygenItem({ item, isChecked, onToggle }) {
  const [open, setOpen] = useState(false)
  return (
    <ExpandableCard item={item} isChecked={isChecked} onToggle={onToggle} open={open} setOpen={setOpen}>
          <div style={{ padding: '12px 12px 10px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 10 }}>
              14 CFR §91.211. Supplemental Oxygen
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {O2_RULES.map((r, i) => (
                <div key={i} style={{
                  background: 'var(--bg-card-2)', borderRadius: 9, padding: '9px 12px',
                  borderLeft: `3px solid ${r.ok ? 'var(--ok)' : r.warn ? 'var(--warn)' : 'var(--danger)'}`,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>{r.alt}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{r.rule}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ padding: '8px 12px 10px' }}>
            <a href="https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/subpart-B/section-91.211" target="_blank" rel="noreferrer" style={{
              display: 'block', textAlign: 'center', padding: '8px 0',
              borderRadius: 9, background: 'var(--bg-card-2)', textDecoration: 'none',
              fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)',
            }}>14 CFR §91.211</a>
          </div>
          <DoneButton isChecked={isChecked} onDone={() => { onToggle(item.id); setOpen(false) }} />
    </ExpandableCard>
  )
}

/* ── Recap row ────────────────────────────────────────────────── */
function RecapRow({ label, value }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10,
      padding: '7px 0',
    }}>
      <span style={{ fontSize: 12, color: 'var(--text-tertiary)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', textAlign: 'right' }}>{value === '—' ? '' : value}</span>
    </div>
  )
}

function RecapSection({ title }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
      color: 'var(--text-tertiary)', margin: '14px 0 4px',
    }}>{title}</div>
  )
}

/* ── Flight Plan Filed. One-page recap of everything filled in ─ */
const PRIOR_PILOT_IDS = ['pilot-imsafe', 'pilot-imcurrent', 'pilot-imvalid', 'pilot-airworthy']

export function RecapItem({ item, isChecked, onToggle, checked, total }) {
  const [open, setOpen]             = useState(false)
  const [route, setRoute]           = useState(null)
  const [perfdist, setPerfdist]     = useState(null)
  const [cruise, setCruise]         = useState(null)
  const [homeAirport, setHomeAirport] = useState(null)
  const [aircraft, setAircraft]     = useState(null)
  const [currData, setCurrData]     = useState(null)
  const [selectedRwy, setSelectedRwy] = useState(null)

  useEffect(() => {
    if (!open) return
    Promise.all([
      get('settings', 'route'),
      get('settings', 'perfdist'),
      get('settings', 'cruise'),
      get('settings', 'homeAirport'),
      get('aircraft', 'profile'),
      get('currency', 'profile'),
      get('settings', 'selectedRunway'),
    ]).then(([r, pd, cr, ha, ac, cur, sr]) => {
      setRoute(r ?? null); setPerfdist(pd ?? null); setCruise(cr ?? null)
      setHomeAirport(ha ?? null); setAircraft(ac ?? null); setCurrData(cur ?? null)
      setSelectedRwy(sr ?? null)
    })
  }, [open])

  // Auto-complete once every other checklist item is done, still
  // overridable any time via the header checkmark.
  const othersDone = typeof total === 'number' && checked
    ? checked.size >= (isChecked ? total : total - 1)
    : false
  useEffect(() => {
    if (othersDone && !isChecked) onToggle(item.id)
  }, [othersDone])

  // Reveal the recap once the pilot has worked through the rest of step 5. 
  // still tappable open/closed manually at any time via the header.
  const reachedPilotStep = Boolean(checked) && PRIOR_PILOT_IDS.every(id => checked.has(id))
  useEffect(() => {
    if (reachedPilotStep) setOpen(true)
  }, [reachedPilotStep])

  const cs = currData ? getCurrencyStatus(currData) : null
  const pilotTiers = cs
    ? [cs.safe, cs.current, ...(cs.valid?.tiers ?? []), cs.airworthy].filter(Boolean)
    : []
  const worstPilot = pilotTiers.reduce((worst, t) => {
    const rank = { expired: 3, expiring: 2, incomplete: 1, valid: 0 }
    return (rank[t.status] ?? 1) > (rank[worst?.status] ?? -1) ? t : worst
  }, null)

  return (
    <ExpandableCard item={item} isChecked={isChecked} onToggle={onToggle} open={open} setOpen={setOpen} hideCheckmark>
      <div style={{ padding: '4px 14px 12px' }}>

        <RecapSection title="Route" />
        <RecapRow label="Departure → Destination" value={route ? `${route.dep} → ${route.dest}` : '—'} />
        <RecapRow label="True / Mag Course" value={route ? `${route.tc}° / ${route.mc}°` : '—'} />
        <RecapRow label="Distance" value={route ? `${route.distNm} NM` : '—'} />

        <RecapSection title="Performance" />
        <RecapRow label="TAS / Fuel Burn" value={cruise ? `${cruise.tas ?? '—'} kt · ${cruise.burnRate ?? '—'} gph` : '—'} />
        <RecapRow label="Fuel On Board" value={cruise?.fuelOnBoard ? `${cruise.fuelOnBoard} gal` : '—'} />
        <RecapRow label="Takeoff Roll / Over 50ft" value={perfdist ? `${perfdist.toGR ?? '—'} / ${perfdist.toOver ?? '—'} ft` : '—'} />
        <RecapRow label="Landing Roll / Over 50ft" value={perfdist ? `${perfdist.ldgGR ?? '—'} / ${perfdist.ldgOver ?? '—'} ft` : '—'} />

        <RecapSection title="Aircraft" />
        <RecapRow label="Aircraft" value={aircraft?.fullName || aircraft?.registration || '—'} />
        <RecapRow label="Home Base" value={homeAirport?.value || '—'} />
        <RecapRow label="Runway" value={
          selectedRwy && (!route?.dest || selectedRwy.icao === route.dest)
            ? `${selectedRwy.id} (${String(selectedRwy.hdg).padStart(3, '0')}°)`
            : '—'
        } />

        <RecapSection title="Pilot" />
        <RecapRow label="Overall Status" value={worstPilot ? imStatusLabel(worstPilot.status) : '—'} />
      </div>
      <DoneButton isChecked={isChecked} onDone={() => { onToggle(item.id); setOpen(false) }} />
    </ExpandableCard>
  )
}

/* ── Stable wrapper components for expand types that need extra
   fixed props. Defined once at module scope so React preserves
   component identity (and local state like `open`) across renders.
   Redefining these inline on every render would remount the card
   on every unrelated re-render, wiping its open/closed state. ── */
export function IMSafeExpand(props)      { return <IMChecklistItem {...props} statusKey="safe" /> }
export function IMCurrentExpand(props)   { return <IMChecklistItem {...props} statusKey="current" /> }
export function IMValidExpand(props)     { return <IMChecklistItem {...props} statusKey="valid" /> }
export function IMAirworthyExpand(props) { return <IMChecklistItem {...props} statusKey="airworthy" /> }
