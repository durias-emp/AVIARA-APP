import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { HomeButton } from '../../components/Shell'
import { IconPerson, IconChevronRight } from '../../components/Icons'
import { get, put } from '../../lib/db'
import { usePilotProfile } from '../../context/PilotProfile'
import { useLogbook } from '../../context/Logbook'
import { computeTotalHours } from '../../lib/logbookFields'
import {
  FAR,
  calendarMonthExpiry, statusFromExpiry,
  medicalExpiryRows, ageAt,
  fmtDate, fmtDaysLeft,
} from '../../lib/currency'

// ---------------------------------------------------------------------------
// Shared UI primitives
// ---------------------------------------------------------------------------

const WARN_DAYS_DEFAULT = 30

// Single pill used by ALL four cards — fixed 72×28, never auto-sizes
function CardPill({ status }) {
  const map = {
    valid:      { bg: 'var(--ok)',        fg: '#fff',                   label: 'Current'  },
    expiring:   { bg: 'var(--warn)',      fg: '#fff',                   label: 'Expiring' },
    expired:    { bg: 'var(--danger)',    fg: '#fff',                   label: 'Expired'  },
    incomplete: { bg: 'var(--bg-card-2)', fg: 'var(--text-tertiary)',   label: ''         },
    unknown:    { bg: 'var(--bg-card-2)', fg: 'var(--text-tertiary)',   label: ''         },
  }
  const { bg, fg, label } = map[status] ?? map.unknown
  return (
    <div style={{
      width: 72, height: 28, borderRadius: 20, flexShrink: 0,
      background: bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 10, fontWeight: 700, letterSpacing: '0.3px', color: fg,
    }}>{label}</div>
  )
}

// Keep StatusPill as alias (used inside inspection rows only)
function StatusPill({ status }) { return <CardPill status={status} /> }

// Progress fill bar — same 72×28 container, fills left-to-right
function FillBar({ frac }) {
  return (
    <div style={{
      position: 'relative', width: 72, height: 28, borderRadius: 20,
      overflow: 'hidden', background: 'var(--bg-card-2)', flexShrink: 0,
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        width: `${frac * 100}%`,
        background: 'var(--border-strong)',
        borderRadius: 20,
        transition: 'width 0.3s ease',
      }} />
    </div>
  )
}

function FarLink({ far }) {
  if (!far) return null
  return (
    <a href={far.url} target="_blank" rel="noreferrer" style={{
      fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)',
      textDecoration: 'none',
      padding: '3px 8px', borderRadius: 20,
      background: 'var(--bg-card-2)', border: '0.5px solid var(--border)',
      flexShrink: 0,
    }}>{far.label}</a>
  )
}

/* Pill that alternates between the FAR reference and days-left every 5s
   (once a days-left value exists). Always tap-through to the FAR text. */
// Derived from wall-clock time (not a per-instance counter) so every pill on
// screen — regardless of when it mounted — flips on the same 5s boundary.
function wallClockShowDays() {
  return Math.floor(Date.now() / 5000) % 2 === 1
}

function FarCyclePill({ far, daysLeft }) {
  const [showDays, setShowDays] = useState(() => daysLeft != null && wallClockShowDays())

  useEffect(() => {
    if (daysLeft == null) { setShowDays(false); return }
    const tick = () => setShowDays(prev => {
      const next = wallClockShowDays()
      return prev === next ? prev : next
    })
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [daysLeft])

  if (!far) return null
  const label = daysLeft != null && showDays
    ? (daysLeft < 0 ? 'Expired' : `${daysLeft}d left`)
    : far.label

  return (
    <a
      href={far.url} target="_blank" rel="noreferrer"
      onClick={e => e.stopPropagation()}
      style={{
        fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)',
        textDecoration: 'none',
        padding: '3px 8px', borderRadius: 20,
        background: 'var(--bg-card-2)', border: '0.5px solid var(--border)',
        flexShrink: 0, transition: 'opacity 0.2s',
      }}
    >{label}</a>
  )
}

function DateInput({ label, value, onChange, hint }) {
  const inputRef = useRef(null)

  const displayDate = value
    ? new Date(value + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  const openPicker = () => {
    const el = inputRef.current
    if (!el) return
    if (el.showPicker) el.showPicker()
    else el.focus()
  }

  return (
    <div style={{ marginBottom: 12, position: 'relative' }}>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div
        onClick={openPicker}
        style={{
          background: 'var(--bg-card)', borderRadius: 12, padding: '13px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          border: '0.5px solid var(--border)', cursor: 'pointer',
        }}
      >
        <span style={{
          fontSize: 17, fontWeight: 400,
          color: displayDate ? 'var(--text)' : 'var(--text-tertiary)',
          letterSpacing: '-0.2px',
        }}>
          {displayDate || 'Date'}
        </span>
        <img src="/calendario.png" width={18} height={18} alt="" className="icon-themed" />
      </div>
      <input
        ref={inputRef}
        type="date"
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        style={{ position: 'absolute', top: 0, left: 0, width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
      />
      {hint && <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

// Expandable card — same collapse pattern as Checklists
function CurrencyCard({ title, subtitle, status, rightEl, farRefs, children }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{
      background: 'var(--bg-card)', borderRadius: 14,
      border: '0.5px solid var(--border)',
      marginBottom: 10, overflow: 'hidden',
    }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: open && farRefs?.length ? '14px 14px 6px' : '14px 14px', background: 'none', border: 'none', cursor: 'pointer',
        gap: 10,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.2px' }}>
            {title}
          </span>
          {subtitle && (
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 400, textAlign: 'left' }}>
              {subtitle}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {rightEl ?? <StatusPill status={status} />}
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
            stroke="var(--text-tertiary)" strokeWidth="2.5" strokeLinecap="round"
            style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
      </button>
      {open && farRefs?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 14px 12px' }}>
          {farRefs.map(f => <FarLink key={f.ref} far={f} />)}
        </div>
      )}
      {open && (
        <div style={{ borderTop: '0.5px solid var(--border)' }}>
          {children}
        </div>
      )}
    </div>
  )
}

/* Checkbox row for longer acknowledgment text that needs to wrap onto
   multiple lines (unlike CheckRowSimple, which truncates to one line). */
function CheckRowWrap({ checked, onChange, title, detail }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        width: '100%', display: 'flex', alignItems: 'flex-start', gap: 11,
        padding: '10px 14px', background: 'transparent', border: 'none',
        cursor: 'pointer', textAlign: 'left',
      }}
    >
      <div style={{
        width: 16, height: 16, borderRadius: 4, flexShrink: 0, marginTop: 2,
        background: checked ? 'var(--accent)' : 'transparent',
        border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--border-strong)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.18s',
      }}>
        {checked && (
          <svg width={10} height={10} viewBox="0 0 12 12" fill="none">
            <polyline points="2,6 5,9 10,3" stroke="var(--accent-fg)" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.2px' }}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.4 }}>{detail}</div>
      </div>
    </button>
  )
}

function CheckRowSimple({ checked, onChange, label, far, padding = '10px 14px' }) {
  return (
    <button onClick={() => onChange(!checked)} style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 11,
      padding, background: 'transparent', border: 'none', cursor: 'pointer',
      textAlign: 'left',
    }}>
      <div style={{
        width: 16, height: 16, borderRadius: 4, flexShrink: 0,
        background: checked ? 'var(--accent)' : 'transparent',
        border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--border-strong)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.18s',
      }}>
        {checked && (
          <svg width={10} height={10} viewBox="0 0 12 12" fill="none">
            <polyline points="2,6 5,9 10,3" stroke="var(--accent-fg)" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </div>
      <span style={{ flex: 1, display: 'flex', alignItems: 'baseline', gap: 5, minWidth: 0 }}>
        {label.includes(' — ') ? (
          <>
            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.2px', flexShrink: 0 }}>
              {label.split(' — ')[0]}
            </span>
            <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {label.split(' — ')[1]}
            </span>
          </>
        ) : (
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap' }}>{label}</span>
        )}
      </span>
      {far && <FarLink far={far} />}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Card 1 — IM SAFE (defined but not rendered below — kept dormant, matching
// its state before this page existed; not part of this restructuring pass)
// ---------------------------------------------------------------------------
const SAFE_ITEMS = [
  { key: 'illness',    label: 'Illness (no symptoms affecting performance)' },
  { key: 'medication', label: 'Medication (none affecting performance or judgment)' },
  { key: 'stress',     label: 'Stress (psychological pressure manageable)' },
  { key: 'alcohol',    label: 'Alcohol (8 hrs bottle-to-throttle, BAC < 0.04%)' },
  { key: 'fatigue',    label: 'Fatigue (rested and alert)' },
  { key: 'eating',     label: 'Eating (adequately nourished and hydrated)' },
]

function ImSafeCard({ data, onChange }) {
  const checks = data?.safe ?? {}
  const doneCount = SAFE_ITEMS.filter(i => checks[i.key] === true).length
  const total = SAFE_ITEMS.length
  const frac = doneCount / total

  const toggle = key => {
    onChange({ ...data, safe: { ...checks, [key]: !checks[key] } })
  }

  const progressBtn = frac >= 1
    ? <CardPill status="valid" />
    : <FillBar frac={frac} />

  return (
    <CurrencyCard
      title="IM SAFE"
      subtitle="Pre-flight self-assessment"
      rightEl={progressBtn}
    >
      <div style={{ padding: '10px 0 6px' }}>
        {SAFE_ITEMS.map((item) => (
          <CheckRowSimple
            key={item.key}
            checked={!!checks[item.key]}
            onChange={() => toggle(item.key)}
            label={item.label}
          />
        ))}
      </div>
    </CurrencyCard>
  )
}

// ---------------------------------------------------------------------------
// Card 2 — IM CURRENT (flight currency)
// ---------------------------------------------------------------------------
const PROFICIENCY_TYPES = ['PPC', 'PCC', 'IPC', 'Flight Test']

function ImCurrentCard({ data, onChange, warnDays }) {
  const current = data?.current ?? {}

  const patch = (key, val) => onChange({ ...data, current: { ...current, [key]: val } })

  // Proficiency checks — array of { type, date }
  const checks = current.proficiencyChecks ?? []
  const [newCheckType, setNewCheckType] = useState(PROFICIENCY_TYPES[0])
  const [customType, setCustomType] = useState('')
  const [isCustom, setIsCustom] = useState(false)
  const addCheck = () => {
    const label = isCustom ? customType.trim() : newCheckType
    if (!label) return
    patch('proficiencyChecks', [...checks, { type: label, date: '' }])
    setCustomType('')
    setIsCustom(false)
  }
  const updateCheck = (i, field, val) => {
    const updated = checks.map((c, idx) => idx === i ? { ...c, [field]: val } : c)
    patch('proficiencyChecks', updated)
  }
  const removeCheck = i => patch('proficiencyChecks', checks.filter((_, idx) => idx !== i))

  // Flight review — 24 calendar months
  const frExp = current.flightReviewDate
    ? calendarMonthExpiry(current.flightReviewDate, 24) : null
  const frStatus = statusFromExpiry(frExp, warnDays)

  // Day / Night passenger currency — 90 days, self-reported acknowledgment (no date)
  const dayCurrent   = current.dayCurrent === true
  const nightCurrent = current.nightCurrent === true

  // IFR — 6 calendar months via IPC date if present, else self-reported acknowledgment
  const ifrExp = current.ipcDate ? calendarMonthExpiry(current.ipcDate, 6) : null
  const ifrStatus = current.ipcDate
    ? statusFromExpiry(ifrExp, warnDays)
    : { status: current.ifrCurrent === true ? 'valid' : 'unknown', expiresOn: null, daysLeft: null }

  // Progress pill — count filled/confirmed fields (flight review, day, night, IFR)
  const filledFields = [
    current.flightReviewDate,
    dayCurrent,
    nightCurrent,
    current.ipcDate || current.ifrCurrent,
  ].filter(Boolean).length
  const totalFields = 4
  const currentFrac = filledFields / totalFields



  const currentProgressBtn = currentFrac >= 1
    ? <CardPill status="valid" />
    : <FillBar frac={currentFrac} />

  function StatusLine({ s }) {
    if (!s.expiresOn) return null
    const color = s.status === 'expired' ? 'var(--danger)' : s.status === 'expiring' ? 'var(--warn)' : 'var(--ok)'
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
        <div style={{ width: 6, height: 6, borderRadius: 3, background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          {s.status === 'expired' ? 'Expired' : 'Valid'} through {fmtDate(s.expiresOn)}
        </span>
      </div>
    )
  }

  return (
    <CurrencyCard title="PILOT CURRENCY" subtitle="Recency of experience" rightEl={currentProgressBtn} farRefs={[FAR.flightReview, FAR.passenger90]}>
      <div style={{ padding: '14px' }}>

        {/* Flight Review */}
        <div style={{
          background: 'var(--bg-card-2)', borderRadius: 10, padding: '12px',
          marginBottom: 10,
        }}>
          <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Flight Review</span>
            <FarCyclePill far={FAR.flightReview} daysLeft={frStatus.daysLeft ?? null} />
          </div>
          <DateInput
            label="Date of last flight review (or PPC / flight test)"
            value={current.flightReviewDate}
            onChange={v => patch('flightReviewDate', v)}
            hint="Expires end of last day of 24th calendar month after this date"
          />

          {/* Proficiency Checks — inline inside Flight Review */}
          <div style={{ marginTop: 10 }}>
            {checks.map((c, i) => {
              const exp = c.date ? calendarMonthExpiry(c.date, 24) : null
              const s = statusFromExpiry(exp, warnDays)
              const color = s.status === 'expired' ? 'var(--danger)' : s.status === 'expiring' ? 'var(--warn)' : 'var(--ok)'
              return (
                <div key={i} style={{ marginBottom: 8, background: 'var(--bg-card)', borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.2px' }}>{c.type}</span>
                    <button onClick={() => removeCheck(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', color: 'var(--text-tertiary)', fontSize: 16, lineHeight: 1 }}>×</button>
                  </div>
                  <DateInput
                    label="Date of check"
                    value={c.date}
                    onChange={v => updateCheck(i, 'date', v)}
                    hint="Valid for 24 calendar months"
                  />
                  {s.expiresOn && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <div style={{ width: 6, height: 6, borderRadius: 3, background: color, flexShrink: 0 }} />
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                          {s.status === 'expired' ? 'Expired' : 'Valid'} through {fmtDate(s.expiresOn)}
                        </span>
                      </div>
                      <span style={{ fontSize: 10, color }}>{fmtDaysLeft(s.daysLeft)}</span>
                    </div>
                  )}
                </div>
              )
            })}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: checks.length ? 4 : 0 }}>
              {isCustom ? (
                <input
                  autoFocus
                  placeholder="Check name"
                  value={customType}
                  onChange={e => setCustomType(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addCheck()}
                  style={{
                    flex: 1, padding: '9px 12px', borderRadius: 10,
                    background: 'var(--bg-card)', border: '0.5px solid var(--border)',
                    color: 'var(--text)', fontSize: 13, outline: 'none',
                  }}
                />
              ) : (
                <select
                  value={newCheckType}
                  onChange={e => {
                    if (e.target.value === '__custom__') setIsCustom(true)
                    else setNewCheckType(e.target.value)
                  }}
                  style={{
                    flex: 1, padding: '9px 12px', borderRadius: 10,
                    background: 'var(--bg-card)', border: '0.5px solid var(--border)',
                    color: 'var(--text)', fontSize: 13, cursor: 'pointer', appearance: 'none',
                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='12' height='12' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpolyline points='3,6 8,11 13,6' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center', outline: 'none',
                  }}
                >
                  {PROFICIENCY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  <option value="__custom__">Other...</option>
                </select>
              )}
              <button
                onClick={addCheck}
                style={{
                  padding: '9px 16px', borderRadius: 10, border: 'none',
                  background: 'var(--accent)', color: 'var(--accent-fg)',
                  fontSize: 13, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
                }}
              >Add</button>
            </div>
          </div>

          <StatusLine s={frStatus} />
        </div>

        {/* Passenger Currency */}
        <div style={{
          background: 'var(--bg-card-2)', borderRadius: 10, padding: '12px',
          marginBottom: 10,
        }}>
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Passenger Currency</span>
          </div>
          <div style={{ background: 'var(--bg-card)', borderRadius: 9 }}>
            <CheckRowWrap
              checked={dayCurrent}
              onChange={v => patch('dayCurrent', v)}
              title="Day"
              detail="3 takeoffs & landings (same category/class/type) within the preceding 90 days"
            />
          </div>

          <div style={{ height: '0.5px', background: 'var(--border)', margin: '10px 0' }} />

          <div style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Night currency (passengers)</span>
          </div>
          <div style={{ background: 'var(--bg-card)', borderRadius: 9 }}>
            <CheckRowWrap
              checked={nightCurrent}
              onChange={v => patch('nightCurrent', v)}
              title="Night"
              detail="3 full-stop landings at night within the preceding 90 days"
            />
          </div>
        </div>

        {/* IFR Currency */}
        <div style={{
          background: 'var(--bg-card-2)', borderRadius: 10, padding: '12px',
        }}>
          <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>IFR Currency</span>
            <FarCyclePill far={FAR.ifrCurrency} daysLeft={ifrStatus.daysLeft ?? null} />
          </div>
          <div style={{ background: 'var(--bg-card)', borderRadius: 9, marginBottom: 10 }}>
            <CheckRowWrap
              checked={current.ifrCurrent === true}
              onChange={v => patch('ifrCurrent', v)}
              title="IFR Currency"
              detail="6 approaches, holding, and intercepting/tracking courses completed within the preceding 6 calendar months"
            />
          </div>
          <DateInput
            label="IPC date (if applicable)"
            value={current.ipcDate}
            onChange={v => patch('ipcDate', v)}
            hint="Instrument Proficiency Check — resets the 6-month window"
          />
          <StatusLine s={ifrStatus} />
          {ifrStatus.status === 'expired' && (
            <div style={{
              marginTop: 8, padding: '8px 10px', borderRadius: 8,
              background: 'var(--danger-light)',
            }}>
              <span style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 600 }}>
                IPC required before carrying passengers IFR — <FarLink far={FAR.ipc} />
              </span>
            </div>
          )}
        </div>

      </div>
    </CurrencyCard>
  )
}

// ---------------------------------------------------------------------------
// Card 3 — MEDICAL VALIDITY (medical currency)
// ---------------------------------------------------------------------------
function ImValidCard({ data, onChange, warnDays }) {
  const med = data?.medical ?? {}
  const patch = (key, val) => onChange({ ...data, medical: { ...med, [key]: val } })

  const hasAll = med.examDate && med.dob && med.medClass

  // Compute all applicable operation rows — one certificate, multiple expirations
  const resultRows = hasAll
    ? medicalExpiryRows(Number(med.medClass), ageAt(med.dob, med.examDate)).map(row => {
        const exp = calendarMonthExpiry(med.examDate, row.months)
        const s = statusFromExpiry(exp, warnDays)
        return { ...row, ...s }
      })
    : []

  const rank = { expired: 3, expiring: 2, valid: 1, unknown: 0 }
  const overallStatus = resultRows.length
    ? resultRows.reduce((w, r) => (rank[r.status] ?? 0) > (rank[w.status] ?? 0) ? r : w, resultRows[0]).status
    : 'incomplete'

  const statusColor = s =>
    s === 'expired' ? 'var(--danger)' : s === 'expiring' ? 'var(--warn)' : 'var(--ok)'

  return (
    <CurrencyCard title="MEDICAL VALIDITY" subtitle="Medical certificate status" rightEl={<CardPill status={overallStatus} />} farRefs={[FAR.medicalDur]}>
      <div style={{ padding: '14px' }}>

        {/* Inputs — class, DOB, exam date only */}
        <div style={{ background: 'var(--bg-card-2)', borderRadius: 10, padding: '12px', marginBottom: 10 }}>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: 6 }}>Medical Class</div>
            <select
              value={med.medClass ?? ''}
              onChange={e => patch('medClass', e.target.value ? Number(e.target.value) : null)}
              style={{
                width: '100%', padding: '11px 14px', borderRadius: 10,
                background: 'var(--bg-card)', border: '0.5px solid var(--border)',
                color: med.medClass ? 'var(--text)' : 'var(--text-tertiary)',
                fontSize: 14, fontWeight: 500, cursor: 'pointer', appearance: 'none',
                backgroundImage: `url("data:image/svg+xml,%3Csvg width='12' height='12' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpolyline points='3,6 8,11 13,6' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat', backgroundPosition: 'right 14px center',
                outline: 'none',
              }}
            >
              <option value="">Select class</option>
              <option value="1">1st Class</option>
              <option value="2">2nd Class</option>
              <option value="3">3rd Class</option>
            </select>
            {med.medClass && (() => {
              const info = {
                1: {
                  title: '1st Class',
                  who: 'Required for ATP and airline transport operations (Part 121 PIC).',
                  tiers: [
                    { label: 'ATP / 121 PIC', u40: '12 mo', o40: '6 mo' },
                    { label: 'Commercial / CFI', u40: '12 mo', o40: '12 mo' },
                    { label: 'Private / Student', u40: '60 mo', o40: '24 mo' },
                  ],
                },
                2: {
                  title: '2nd Class',
                  who: 'Required for commercial pilot operations (hire or compensation).',
                  tiers: [
                    { label: 'Commercial / CFI', u40: '12 mo', o40: '12 mo' },
                    { label: 'Private / Student', u40: '60 mo', o40: '24 mo' },
                  ],
                },
                3: {
                  title: '3rd Class',
                  who: 'Required for private, recreational, and student pilot operations.',
                  tiers: [
                    { label: 'Private / Student', u40: '60 mo', o40: '24 mo' },
                  ],
                },
              }[Number(med.medClass)]
              return (
                <div style={{ marginTop: 10, background: 'var(--bg-card)', borderRadius: 10, padding: '12px', border: '0.5px solid var(--border)' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>{info.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.4 }}>{info.who}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '4px 10px', alignItems: 'center' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.3px' }}>OPERATION</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textAlign: 'right', letterSpacing: '0.3px' }}>UNDER 40</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textAlign: 'right', letterSpacing: '0.3px' }}>40 +</div>
                    {info.tiers.map(t => (
                      <Fragment key={t.label}>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t.label}</div>
                        <div style={{ fontSize: 12, color: 'var(--text)', textAlign: 'right', fontWeight: 500 }}>{t.u40}</div>
                        <div style={{ fontSize: 12, color: 'var(--text)', textAlign: 'right', fontWeight: 500 }}>{t.o40}</div>
                      </Fragment>
                    ))}
                  </div>
                </div>
              )
            })()}
          </div>
          <DateInput label="Date of birth" value={med.dob} onChange={v => patch('dob', v)} />
          <DateInput
            label="Medical exam date"
            value={med.examDate}
            onChange={v => patch('examDate', v)}
            hint="Day of month is irrelevant — expiry is calendar-month based"
          />
        </div>

        {/* Results — one row per applicable operation tier */}
        {hasAll && (
          <div style={{ background: 'var(--bg-card-2)', borderRadius: 10, overflow: 'hidden' }}>
            {resultRows.map((row, i) => (
              <div key={row.tier} style={{
                padding: '11px 12px',
                borderTop: i > 0 ? '0.5px solid var(--border)' : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
                    {row.label}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    {row.status === 'expired' ? 'Expired ' : 'Valid through '}
                    <span style={{ fontWeight: 700, color: statusColor(row.status) }}>
                      {fmtDate(row.expiresOn)}
                    </span>
                    <span style={{ color: statusColor(row.status), marginLeft: 4 }}>
                      {fmtDaysLeft(row.daysLeft)}
                    </span>
                  </div>
                </div>
                <div style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.2px', flexShrink: 0,
                  color: row.status === 'valid' ? 'var(--ok)' : row.status === 'expiring' ? 'var(--warn)' : 'var(--danger)',
                }}>
                  {row.months} mo
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </CurrencyCard>
  )
}

// ---------------------------------------------------------------------------
// Card 4 — Logbook. Links out to the real Logbook section (src/pages/Pilot/
// LogbookList.jsx and friends) rather than embedding it inline here — same
// reasoning as Profile Setup living on its own page: this card is a summary/
// entry point, not where the actual feature lives.
// ---------------------------------------------------------------------------
function LogbookCard() {
  const { entries } = useLogbook()
  const totalHours = computeTotalHours(entries)
  return (
    <Link to="/logbook" style={{ textDecoration: 'none' }}>
      <div style={{
        background: 'var(--bg-card)', borderRadius: 14,
        border: '0.5px solid var(--border)',
        marginBottom: 10, overflow: 'hidden',
        padding: '14px 14px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.2px' }}>Logbook</span>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            {entries === undefined ? 'Loading…' : entries.length === 0 ? 'No flights logged yet' : `${totalHours.toFixed(1)} hr · ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`}
          </span>
        </div>
        <span style={{ color: 'var(--text-tertiary)', display: 'flex', flexShrink: 0 }}><IconChevronRight size={16} /></span>
      </div>
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Root — Pilot page. Focus: medical currency, flight currency, and (soon)
// a logbook — profile fields (name/certificate/home airport/units/account)
// moved out to their own "Profile Setup" page (src/pages/Profile/Profile.jsx),
// reachable via the icon button below or from Settings.
//
// Note: the "IM AIRWORTHY" card (aircraft documents + inspections) lives on
// the Aircraft page as the "Airworthiness" section — it still reads/writes
// the same currency/profile.airworthy data, so getCurrencyStatus() and the
// Checklists "IM AIRWORTHY" references keep working unchanged.
// ---------------------------------------------------------------------------
export default function Pilot() {
  const { profile: pilotProfile } = usePilotProfile()
  const [data, setData] = useState({})
  const [warnDays] = useState(WARN_DAYS_DEFAULT)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    get('currency', 'profile').then(saved => {
      const base = saved ?? {}
      // Onboarding stores medClass as "1st"/"2nd"/"3rd"; this page expects numeric 1/2/3
      const toNumericClass = v => {
        if (v === 1 || v === 2 || v === 3) return v
        return { '1st': 1, '2nd': 2, '3rd': 3 }[v] ?? null
      }
      // Merge pilot profile fields as defaults — only if not already set locally
      const merged = {
        ...base,
        medical: {
          ...base.medical,
          medClass: toNumericClass(base.medical?.medClass ?? pilotProfile?.medClass),
          dob:      base.medical?.dob      || pilotProfile?.dob      || '',
          examDate: base.medical?.examDate || pilotProfile?.medDate  || '',
        },
        current: {
          ...base.current,
          flightReviewDate: base.current?.flightReviewDate || pilotProfile?.flightReview?.completionDate || '',
        },
      }
      // Clear session-only safe flags
      if (merged.safe) merged.safe = {}
      setData(merged)
      put('currency', { ...merged, id: 'profile' }).catch(() => {})
      setLoaded(true)
    })
  }, [pilotProfile])

  const handleChange = useCallback(newData => {
    setData(newData)
    put('currency', { ...newData, id: 'profile' }).catch(() => {})
    // Sync key fields back to pilot profile
    // (handled by user editing in Currency — pilot profile is the source of truth on first load)
  }, [])

  if (!loaded) return null

  return (
    <div style={{ paddingBottom: 40 }}>
      <div style={{ padding: '20px 20px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <HomeButton />
          <h2 style={{
            fontSize: 28, fontWeight: 700, letterSpacing: '-0.4px', color: 'var(--text)',
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
          }}>Pilot</h2>
        </div>
        <Link to="/profile" aria-label="Profile setup" style={{
          width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
          background: 'var(--bg-card)', boxShadow: 'var(--shadow-sm)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text)', WebkitTapHighlightColor: 'transparent',
        }}>
          <IconPerson size={19} />
        </Link>
      </div>

      <div style={{ padding: '0 16px' }}>
        <ImCurrentCard   data={data} onChange={handleChange} warnDays={warnDays} />
        <ImValidCard     data={data} onChange={handleChange} warnDays={warnDays} />
        <LogbookCard />
      </div>

      <div style={{ padding: '8px 16px 0', textAlign: 'center' }}>
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
          Reference aid only · Always verify current FAR/AIM
        </span>
      </div>
    </div>
  )
}
