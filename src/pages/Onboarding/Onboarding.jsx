import { useState, useRef, useEffect } from 'react'
import { usePilotProfile } from '../../context/PilotProfile'
import { generateAircraftIcon } from '../../lib/generateIcon'
import { medicalExpiryRows, ageAt, fmtDate, calendarMonthExpiry, statusFromExpiry } from '../../lib/currency'
import { TEMPLATES } from '../Aircraft/Aircraft'
import { put } from '../../lib/db'
import { loadWeather } from '../../lib/weather'
import { trackEvent } from '../../lib/analytics'

const TOTAL = 6
const CERTS  = ['Student', 'Private', 'Commercial', 'ATP']
const MED_CLASSES = ['1st', '2nd', '3rd', 'BasicMed', 'None']

const CERT_OPTIONS = {
  Student: [
    { key: 'trainingType', label: 'Type of training', options: ['Single Engine', 'Multi Engine'] },
    { key: 'aircraftClass', label: 'Aircraft class',   options: ['Aeroplane Land', 'Aeroplane Sea', 'Helicopter'] },
  ],
  Private: [
    { key: 'aircraftClass',  label: 'Class',        options: ['SEL', 'SES', 'MEL', 'MES', 'Rotorcraft'] },
    { key: 'ratings',        label: 'Ratings',      options: ['Instrument'] },
    { key: 'endorsements',   label: 'Endorsements', options: ['Aerobatic', 'Tailwheel'] },
  ],
  Commercial: [
    { key: 'aircraftClass',  label: 'Class',        options: ['CASEL', 'CASES', 'CAMEL', 'Commercial Rotorcraft'] },
    { key: 'ratings',        label: 'Ratings',      options: ['Instrument', 'CFI', 'CFII'] },
    { key: 'endorsements',   label: 'Endorsements', options: ['Aerobatic', 'Tailwheel', 'High Performance', 'High Altitude', 'Complex', 'Spin Training'] },
  ],
  ATP: [
    { key: 'endorsements',   label: 'Additional endorsements', options: ['Aerobatic', 'Tailwheel', 'High Performance', 'High Altitude', 'Complex', 'Spin Training'] },
  ],
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

function Label({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 5, letterSpacing: '0.3px', textTransform: 'uppercase' }}>
      {children}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  )
}

const INPUT_BASE = {
  width: '100%', maxWidth: '100%', boxSizing: 'border-box',
  padding: '11px 13px', borderRadius: 'var(--r-sm)',
  border: '0.5px solid var(--border)', background: 'var(--bg-card-2)',
  fontSize: 15, outline: 'none', fontFamily: 'inherit',
  display: 'block',
}

function TextInput({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <Field label={label}>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? ''}
        style={{ ...INPUT_BASE, color: 'var(--text)' }}
      />
    </Field>
  )
}

const TAIL_EXAMPLES = [
  'YS-CNA', 'C-GOPF', 'N34R', 'N172SP', 'C-FXYZ',
  'XB-PNR', 'N8347Q', 'C-GKWB', 'YS-11A', 'N2264U',
  'HP-1820', 'N737TW', 'C-FTCO', 'N4521L', 'YS-AXC',
]

function TailNumberInput({ value, onChange }) {
  const [phIdx, setPhIdx] = useState(0)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    if (value) return
    const id = setInterval(() => {
      setVisible(false)
      setTimeout(() => {
        setPhIdx(i => (i + 1) % TAIL_EXAMPLES.length)
        setVisible(true)
      }, 300)
    }, 3000)
    return () => clearInterval(id)
  }, [value])

  return (
    <Field label="Tail number">
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value.toUpperCase())}
          placeholder=""
          style={{ ...INPUT_BASE, color: 'var(--text)', background: 'transparent', position: 'relative', zIndex: 1 }}
        />
        {!value && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            padding: '11px 13px', fontSize: 15,
            color: 'var(--text-tertiary)',
            pointerEvents: 'none', zIndex: 0,
            opacity: visible ? 1 : 0,
          }}>
            {TAIL_EXAMPLES[phIdx]}
          </div>
        )}
      </div>
    </Field>
  )
}

function DateField({ label, value, onChange }) {
  const display = value
    ? new Date(value + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  return (
    <Field label={label}>
      <div style={{
        display: 'grid',
        width: '100%',
        maxWidth: '100%',
        boxSizing: 'border-box',
        borderRadius: 'var(--r-sm)',
        border: '0.5px solid var(--border)',
        background: 'var(--bg-card-2)',
        overflow: 'hidden',
      }}>
        <div style={{
          gridColumn: 1, gridRow: 1,
          padding: '11px 13px',
          fontSize: 15,
          color: display ? 'var(--text)' : 'var(--text-tertiary)',
          pointerEvents: 'none',
          userSelect: 'none',
          zIndex: 1,
        }}>
          {display || 'Date'}
        </div>
        <input
          type="date"
          value={value}
          onChange={e => onChange(e.target.value)}
          // The input is invisible (opacity 0) with the formatted date shown
          // in the styled div above it. Mobile browsers open their picker on
          // any tap of a date input, but desktop browsers only open the
          // calendar from the (invisible) icon. A plain click just focuses
          // the hidden field and looks completely dead. showPicker() opens
          // the picker explicitly; guarded because it throws off a user
          // gesture or in cross-origin frames, where the tap-to-focus
          // fallback still applies.
          onClick={e => { try { e.currentTarget.showPicker?.() } catch { /* ignore */ } }}
          style={{
            gridColumn: 1, gridRow: 1,
            width: '100%',
            maxWidth: '100%',
            boxSizing: 'border-box',
            opacity: 0,
            cursor: 'pointer',
            fontSize: 16,
            border: 'none',
            background: 'transparent',
            padding: 0, margin: 0,
            WebkitAppearance: 'none',
            appearance: 'none',
          }}
        />
      </div>
    </Field>
  )
}

export function SegControl({ options, value, onChange }) {
  const idx = options.indexOf(value)
  const pct = 100 / options.length
  return (
    <div style={{ display: 'flex', background: 'rgba(120,120,128,0.12)', borderRadius: 'var(--r-sm)', padding: 3, position: 'relative' }}>
      <div style={{
        position: 'absolute', top: 3, bottom: 3,
        left: `calc(${Math.max(0, idx) * pct}% + 3px)`,
        width: `calc(${pct}% - 6px)`,
        background: 'var(--bg-card)',
        borderRadius: 6,
        boxShadow: '0 1px 4px rgba(0,0,0,0.14), 0 0 0 0.5px rgba(0,0,0,0.06)',
        transition: 'left 0.25s cubic-bezier(0.34, 1.2, 0.64, 1)',
        pointerEvents: 'none',
        opacity: idx >= 0 ? 1 : 0,
      }} />
      {options.map(opt => (
        <button key={opt} onClick={() => onChange(opt)} style={{
          flex: 1, padding: '7px 4px', borderRadius: 6, border: 'none', cursor: 'pointer',
          fontWeight: 600, fontSize: 13,
          background: 'transparent',
          color: value === opt ? 'var(--text)' : 'var(--text-secondary)',
          fontFamily: 'inherit', position: 'relative', zIndex: 1,
          transition: 'color 0.18s',
        }}>{opt}</button>
      ))}
    </div>
  )
}

function TagGrid({ options, selected, onToggle }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {options.map(opt => {
        const on = selected.includes(opt)
        return (
          <button key={opt} onClick={() => onToggle(opt)} style={{
            padding: '7px 14px', borderRadius: 20, border: `0.5px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
            background: on ? 'var(--accent-fg)' : 'transparent',
            color: on ? 'var(--accent)' : 'var(--text-secondary)',
            fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>{opt}</button>
        )
      })}
    </div>
  )
}

function NavButtons({ onBack, onNext, onSkip, nextLabel = 'Continue', step }) {
  return (
    <div style={{
      position: 'sticky', bottom: 0,
      paddingTop: 'calc(16px + var(--safe-top))', paddingBottom: 'max(20px, var(--safe-bottom))',
      marginTop: 24,
      background: 'linear-gradient(to bottom, transparent 0%, var(--bg) 28%)',
    }}>
      <div style={{ display: 'flex', gap: 8 }}>
        {step > 1 && (
          <button onClick={onBack} style={{
            padding: '14px 18px', borderRadius: 'var(--r-md)', background: 'var(--bg-card-2)',
            border: '0.5px solid var(--border)', color: 'var(--text-secondary)', fontSize: 20, cursor: 'pointer',
          }}>←</button>
        )}
        <button onClick={onNext} style={{
          flex: 1, padding: 14, borderRadius: 'var(--r-md)', background: 'var(--text)',
          border: 'none', color: 'var(--bg)', fontSize: 16, fontWeight: 700, cursor: 'pointer',
          fontFamily: 'inherit', letterSpacing: '-0.2px',
        }}>{nextLabel}</button>
      </div>
      {onSkip && (
        <div onClick={onSkip} style={{
          textAlign: 'center', marginTop: 14, fontSize: 13,
          color: 'var(--text-tertiary)', cursor: 'pointer',
        }}>Skip for now</div>
      )}
    </div>
  )
}

function ProgressDots({ step }) {
  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 32 }}>
      {Array.from({ length: TOTAL }, (_, i) => {
        const n = i + 1
        const active = n === step
        const done   = n < step
        return (
          <div key={n} style={{
            height: 6, borderRadius: 3, transition: 'all 0.3s',
            width: active ? 20 : 6,
            background: (active || done) ? 'var(--text)' : 'var(--border)',
            opacity: done ? 0.4 : 1,
          }} />
        )
      })}
    </div>
  )
}

function StepHeader({ step, title, sub }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 6 }}>
        Step {step} of {TOTAL}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.4px', marginBottom: 6, lineHeight: 1.2 }}>
        {title}
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{sub}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 1: Pilot profile
// ---------------------------------------------------------------------------

function Step1({ draft, update, onNext }) {
  function toggle(key, val) {
    const list = draft[key] ?? []
    update({ [key]: list.includes(val) ? list.filter(x => x !== val) : [...list, val] })
  }

  const groups = CERT_OPTIONS[draft.certificate] ?? []

  return (
    <div>
      <StepHeader step={1} title="Your pilot profile" sub="Sets up your certificate, ratings, and drives age based currency calculations." />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <TextInput label="First name" value={draft.firstName ?? ''} onChange={v => update({ firstName: v, name: (v + ' ' + (draft.lastName ?? '')).trim() })} placeholder="First" />
          </div>
          <div style={{ flex: 1 }}>
            <TextInput label="Last name" value={draft.lastName ?? ''} onChange={v => update({ lastName: v, name: ((draft.firstName ?? '') + ' ' + v).trim() })} placeholder="Last" />
          </div>
        </div>
        <DateField label="Date of birth" value={draft.dob} onChange={v => update({ dob: v })} />
        <Field label="Certificate">
          <SegControl options={CERTS} value={draft.certificate} onChange={v => update({ certificate: v, aircraftClass: [], ratings: [], endorsements: [], trainingType: [] })} />
        </Field>
        {groups.length > 0 && (
          <div key={draft.certificate} style={{ display: 'flex', flexDirection: 'column', gap: 14, animation: 'slide-in-right 0.22s ease' }}>
            {groups.map(group => (
              <Field key={group.key + group.label} label={group.label}>
                <TagGrid
                  options={group.options}
                  selected={draft[group.key] ?? []}
                  onToggle={val => toggle(group.key, val)}
                />
              </Field>
            ))}
          </div>
        )}
      </div>
      <NavButtons step={1} onNext={onNext} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 2: Medical
// ---------------------------------------------------------------------------

function medClassNum(cls) {
  return cls === '1st' ? 1 : cls === '2nd' ? 2 : cls === '3rd' ? 3 : null
}

function Step2({ draft, update, onNext, onBack }) {
  const classNum = medClassNum(draft.medClass)
  const showPreview = classNum && draft.dob && draft.medDate

  let rows = []
  if (showPreview) {
    const age = ageAt(draft.dob, draft.medDate)
    const today = new Date()
    rows = medicalExpiryRows(classNum, age).map(row => {
      const expiry = calendarMonthExpiry(draft.medDate, row.months)
      return { ...row, expiry, ok: expiry > today }
    })
  }

  return (
    <div>
      <StepHeader step={2} title="Medical certificate" sub="Drives your medical validity card and expiry alerts." />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Medical class">
          <SegControl options={MED_CLASSES} value={draft.medClass} onChange={v => update({ medClass: v })} />
        </Field>
        {draft.medClass && draft.medClass !== 'None' && (
          <>
            <DateField label="Date of last exam" value={draft.medDate} onChange={v => update({ medDate: v })} />
            {showPreview && (
              <div style={{ background: 'var(--bg-card-2)', borderRadius: 'var(--r-md)', padding: '12px 14px', border: '0.5px solid var(--border)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.4px', textTransform: 'uppercase', marginBottom: 10 }}>
                  Expiry preview
                </div>
                {rows.map((row, i) => (
                  <div key={i} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '8px 0',
                    borderTop: 'none',
                  }}>
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{row.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: row.ok ? 'var(--ok)' : 'var(--warn)' }}>
                      {fmtDate(row.expiry)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <NavButtons step={2} onBack={onBack} onNext={onNext} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Flight Review: config-driven (FAR 61.56)
// Add new exceptions here without touching the component below.
// ---------------------------------------------------------------------------

const FLIGHT_REVIEW_OPTIONS = [
  {
    id: 'standard',
    label: 'Standard Flight Review',
    fields: [
      { key: 'completionDate', label: 'Date completed', type: 'date' },
    ],
  },
  {
    id: 'practical_test',
    label: 'Practical Test / Checkride',
    fields: [
      {
        key: 'certificateType', label: 'Certificate or rating', type: 'select',
        options: ['Private Pilot', 'Instrument Rating', 'Commercial Pilot', 'ATP', 'Type Rating', 'Other'],
      },
      { key: 'completionDate', label: 'Date passed', type: 'date' },
    ],
  },
  {
    id: 'wings',
    label: 'FAA WINGS Program',
    fields: [
      {
        key: 'phase', label: 'Phase completed', type: 'select',
        options: ['Basic', 'Advanced', 'Master'],
      },
      { key: 'completionDate', label: 'Completion date', type: 'date' },
    ],
  },
  {
    id: 'cfi',
    label: 'Flight Instructor Renewal',
    fields: [
      {
        key: 'renewalMethod', label: 'Renewal method', type: 'select',
        options: ['§61.197 Renewal', 'FIRC (§61.199)'],
      },
      { key: 'completionDate', label: 'Completion date', type: 'date' },
    ],
  },
]

function SelectField({ label, value, onChange, options }) {
  return (
    <Field label={label}>
      <div style={{ position: 'relative' }}>
        <select
          value={value ?? ''}
          onChange={e => onChange(e.target.value)}
          style={{
            ...INPUT_BASE, padding: '11px 36px 11px 13px',
            color: value ? 'var(--text)' : 'var(--text-tertiary)',
            appearance: 'none', cursor: 'pointer',
          }}
        >
          <option value="" disabled>Select…</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <div style={{
          position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)',
          pointerEvents: 'none', color: 'var(--text-tertiary)', fontSize: 11,
        }}>▼</div>
      </div>
    </Field>
  )
}

export function FlightReviewSection({ value = {}, onChange }) {
  const selectedOption = FLIGHT_REVIEW_OPTIONS.find(o => o.id === value.flightReviewType)

  function setType(id) {
    onChange({ flightReviewType: id, completionDate: '', certificateType: '', phase: '', renewalMethod: '' })
  }

  function setField(key, val) {
    onChange({ ...value, [key]: val })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
          <Label>Flight review basis</Label>
          <a
            href="https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-61/subpart-A/section-61.56"
            target="_blank" rel="noreferrer"
            style={{
              fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)',
              textDecoration: 'none', padding: '3px 8px', borderRadius: 20,
              background: 'var(--bg-card-2)', border: '0.5px solid var(--border)',
            }}
          >FAR 61.56</a>
        </div>
        <div style={{ position: 'relative' }}>
          <select
            value={value.flightReviewType ?? ''}
            onChange={e => setType(e.target.value)}
            style={{
              ...INPUT_BASE, padding: '11px 36px 11px 13px',
              color: value.flightReviewType ? 'var(--text)' : 'var(--text-tertiary)',
              appearance: 'none', cursor: 'pointer',
            }}
          >
            <option value="" disabled>Select…</option>
            {FLIGHT_REVIEW_OPTIONS.map(o => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          <div style={{ position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-tertiary)', fontSize: 11 }}>▼</div>
        </div>
      </div>
      {selectedOption && (
        <div key={selectedOption.id} style={{ display: 'flex', flexDirection: 'column', gap: 14, animation: 'slide-in-right 0.22s ease' }}>
          {selectedOption.fields.map(field => {
            if (field.type === 'select') {
              return (
                <SelectField
                  key={field.key}
                  label={field.label}
                  value={value[field.key] ?? ''}
                  onChange={v => setField(field.key, v)}
                  options={field.options}
                />
              )
            }
            const dateVal = value[field.key] ?? ''
            const expiry = dateVal ? calendarMonthExpiry(dateVal, 24) : null
            const { status } = expiry ? statusFromExpiry(expiry, 30) : { status: null }
            const statusColor = status === 'valid' ? 'var(--ok)' : status === 'expiring' ? 'var(--warn)' : status === 'expired' ? '#ff453a' : null
            const statusLabel = status === 'valid'
              ? `Current, expires ${fmtDate(expiry)}`
              : status === 'expiring'
              ? `Expiring soon, ${fmtDate(expiry)}`
              : status === 'expired'
              ? `Expired ${fmtDate(expiry)}, flight review required`
              : null
            return (
              <div key={field.key}>
                <DateField
                  label={field.label}
                  value={dateVal}
                  onChange={v => setField(field.key, v)}
                />
                {statusLabel && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: statusColor, fontWeight: 600 }}>{statusLabel}</span>
                    <a
                      href="https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-61/subpart-A/section-61.56"
                      target="_blank" rel="noreferrer"
                      style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', textDecoration: 'none', padding: '2px 6px', borderRadius: 20, background: 'var(--bg-card-2)', border: '0.5px solid var(--border)', marginLeft: 'auto', flexShrink: 0 }}
                    >24 mo FAR 61.56</a>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 3: Currency baseline
// ---------------------------------------------------------------------------

function Step3({ draft, update, onNext, onBack, onSkip }) {
  return (
    <div>
      <StepHeader step={3} title="Currency baseline" sub="Seed your currency tracker so it shows real status from day one." />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <FlightReviewSection
          value={draft.flightReview ?? {}}
          onChange={v => update({ flightReview: v })}
        />
      </div>
      <NavButtons step={3} onBack={onBack} onNext={onNext} onSkip={onSkip} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 4: Aircraft
// ---------------------------------------------------------------------------

// Sentinel index for the "not finding yours?" custom slide
const CUSTOM_IDX = TEMPLATES.length

function AircraftHeroPicker({ selectedId, onSelect, onCustomName }) {
  const [slideKey, setSlideKey] = useState(0)
  const [slideDir, setSlideDir] = useState(1)
  const [showArrows, setShowArrows] = useState(false)
  const touchStartX = useRef(null)
  const arrowTimer = useRef(null)

  const currentIdx = selectedId === 'custom'
    ? CUSTOM_IDX
    : Math.max(0, TEMPLATES.findIndex(t => t.id === selectedId))
  const idx = currentIdx
  const isCustomSlide = idx === CUSTOM_IDX
  const tpl = isCustomSlide ? null : TEMPLATES[idx]

  function flashArrows() {
    setShowArrows(true)
    clearTimeout(arrowTimer.current)
    arrowTimer.current = setTimeout(() => setShowArrows(false), 1500)
  }

  function goTo(nextIdx) {
    if (nextIdx < 0 || nextIdx > CUSTOM_IDX) return
    setSlideDir(nextIdx > idx ? 1 : -1)
    setSlideKey(k => k + 1)
    if (nextIdx === CUSTOM_IDX) {
      onSelect(null)
    } else {
      onSelect(TEMPLATES[nextIdx])
    }
  }

  function onTouchStart(e) { touchStartX.current = e.touches[0].clientX; flashArrows() }
  function onTouchEnd(e) {
    if (touchStartX.current === null) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    touchStartX.current = null
    if (Math.abs(dx) < 40) return
    goTo(idx + (dx < 0 ? 1 : -1))
  }

  return (
    <div>
      {/* Dots: templates + one dot for custom */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 5, marginBottom: 8, opacity: showArrows ? 1 : 0.35, transition: 'opacity 0.3s ease' }}>
        {TEMPLATES.map((t, i) => (
          <div key={t.id} onClick={() => goTo(i)} style={{
            width: i === idx ? 16 : 5, height: 5, borderRadius: 3,
            background: i === idx ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.18)',
            transition: 'width 0.2s, background 0.2s', cursor: 'pointer',
          }} />
        ))}
        {/* Custom slide dot */}
        <div onClick={() => goTo(CUSTOM_IDX)} style={{
          width: isCustomSlide ? 16 : 5, height: 5, borderRadius: 3,
          background: isCustomSlide ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.10)',
          transition: 'width 0.2s, background 0.2s', cursor: 'pointer',
          border: isCustomSlide ? 'none' : '0.5px dashed rgba(255,255,255,0.25)',
        }} />
      </div>

      {/* Hero image / custom slide */}
      <div
        onMouseEnter={() => setShowArrows(true)}
        onMouseLeave={() => setShowArrows(false)}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        style={{ position: 'relative', width: '100%', height: 220, marginBottom: 0, overflow: 'hidden' }}
      >
        {isCustomSlide ? (
          <div
            key={slideKey}
            style={{
              width: '100%', height: '100%',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16,
              animation: `slide-in-right 0.3s cubic-bezier(0.25,0.46,0.45,0.94) both`,
            }}
          >
            <div style={{ width: 120, height: 120, color: 'var(--text)', opacity: 0.18 }}>
              <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
                <ellipse cx="100" cy="105" rx="10" ry="52" fill="currentColor" />
                <path d="M100 95 L28 130 L38 134 L100 108 L162 134 L172 130 Z" fill="currentColor" />
                <path d="M100 150 L72 162 L76 165 L100 155 L124 165 L128 162 Z" fill="currentColor" />
                <path d="M100 148 L95 135 L105 135 Z" fill="currentColor" />
                <ellipse cx="100" cy="55" rx="7" ry="10" fill="currentColor" />
              </svg>
            </div>
            <input
              placeholder="Type your aircraft model…"
              maxLength={60}
              autoFocus={false}
              onChange={e => onCustomName && onCustomName(e.target.value)}
              style={{
                padding: '9px 14px', borderRadius: 10,
                border: '0.5px solid rgba(255,255,255,0.2)',
                background: 'rgba(255,255,255,0.07)', color: 'var(--text)',
                fontSize: 15, outline: 'none', fontFamily: 'inherit',
                width: '75%', textAlign: 'center',
              }}
            />
          </div>
        ) : (
          <>
            <img
              key={slideKey}
              src={tpl.image}
              alt=""
              style={{
                width: '100%', height: '100%',
                objectFit: 'contain', objectPosition: 'center bottom',
                display: 'block',
                animation: slideKey > 0 ? `slide-in-${slideDir > 0 ? 'right' : 'left'} 0.3s cubic-bezier(0.25,0.46,0.45,0.94) both` : 'none',
              }}
            />
          </>
        )}

        {/* Arrows */}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 6px', opacity: showArrows ? 1 : 0, transition: 'opacity 0.4s ease', pointerEvents: showArrows ? 'auto' : 'none' }}>
          <button onClick={() => goTo(idx - 1)} style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.08)', border: '0.5px solid rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: idx === 0 ? 0.3 : 1 }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8l4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button onClick={() => goTo(idx + 1)} style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.08)', border: '0.5px solid rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: isCustomSlide ? 0.3 : 1 }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 12l4-4-4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
      </div>

      {/* Name + subtitle */}
      <div key={isCustomSlide ? 'custom' : tpl.id} style={{ textAlign: 'center', marginBottom: 6, animation: slideKey > 0 ? `slide-in-${slideDir > 0 ? 'right' : 'left'} 0.25s ease` : 'none' }}>
        {isCustomSlide ? (
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
            Not seeing yours? Add it above and generate an icon later.
          </div>
        ) : (
          <>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.4px', color: 'var(--text)' }}>{tpl.fullName}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{tpl.fuel?.type ?? tpl.fuel} · {tpl.category}</div>
          </>
        )}
      </div>
    </div>
  )
}

function Step4({ draft, update, onNext, onBack, onSkip }) {
  const selectedId = draft.aircraftTemplateId ?? TEMPLATES[0].id
  const [generating, setGenerating] = useState(false)
  const [genOpen, setGenOpen]       = useState(false)
  const [genName, setGenName]       = useState('')
  const [genError, setGenError]     = useState(null)

  const isCustom = selectedId === 'custom'
  const currentTpl = TEMPLATES.find(t => t.id === selectedId)
  const initialName = draft.aircraftModel ?? currentTpl?.fullName ?? ''

  function onSelect(tpl) {
    if (!tpl) {
      // custom slide
      update({ aircraftTemplateId: 'custom', aircraftModel: draft.aircraftModel ?? '' })
      return
    }
    const rawFuel = tpl.fuel?.type ?? tpl.fuel ?? ''
    const fuelType = rawFuel.toLowerCase().includes('100') ? 'AVGAS 100LL' : 'JET-A'
    const engineType = tpl.category === 'helicopter' || fuelType === 'JET-A' ? 'Turbine' : 'Piston'
    update({ aircraftTemplateId: tpl.id, aircraftModel: tpl.fullName, fuelType, engineType })
    setGenName(tpl.fullName)
  }

  function onCustomName(name) {
    update({ aircraftTemplateId: 'custom', aircraftModel: name })
    setGenName(name)
  }

  async function generate() {
    const name = genName.trim() || initialName
    if (!name) return
    setGenerating(true)
    setGenError(null)
    try {
      const image = await generateAircraftIcon(name)
      update({ aircraftImage: image })
      setGenOpen(false)
    } catch (e) {
      setGenError(e.message)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div>
      <StepHeader step={4} title="Primary aircraft" sub="Pre loads fuel type and engine defaults. V speeds and W&B you can fill in later." />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <AircraftHeroPicker selectedId={selectedId} onSelect={onSelect} onCustomName={onCustomName} />

        {/* Generate custom icon, only show when custom aircraft selected */}
        {isCustom && (!genOpen ? (
          <button
            onClick={() => { setGenOpen(true); setGenName(initialName) }}
            style={{
              alignSelf: 'center', display: 'flex', alignItems: 'center', gap: 6,
              background: 'rgba(255,255,255,0.07)', border: '0.5px solid rgba(255,255,255,0.15)',
              borderRadius: 10, padding: '7px 14px', cursor: 'pointer',
              color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500,
            }}
          >
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none">
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
                stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {draft.aircraftImage ? 'Regenerate icon' : 'Generate custom icon'}
          </button>
        ) : (
          <div style={{
            background: 'var(--bg-card)', border: '0.5px solid var(--border)',
            borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Generate aircraft icon</div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: -4 }}>
              Describe your aircraft. Model name is enough.
            </div>
            <input
              autoFocus
              value={genName}
              onChange={e => setGenName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && generate()}
              placeholder={initialName || 'e.g. Cirrus Vision Jet SF50'}
              maxLength={80}
              style={{
                padding: '9px 12px', borderRadius: 9,
                border: '0.5px solid var(--border-strong)',
                background: 'var(--bg-card-2)', color: 'var(--text)',
                fontSize: 14, outline: 'none', fontFamily: 'inherit',
              }}
            />
            {genError && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{genError}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={generate}
                disabled={generating}
                style={{
                  flex: 1, padding: '9px 0', borderRadius: 9, border: 'none',
                  background: 'var(--accent)', color: 'var(--accent-fg)',
                  fontWeight: 700, fontSize: 14, cursor: generating ? 'default' : 'pointer',
                  opacity: generating ? 0.5 : 1,
                }}
              >{generating ? 'Generating…' : 'Generate'}</button>
              <button
                onClick={() => { setGenOpen(false); setGenError(null) }}
                disabled={generating}
                style={{
                  padding: '9px 14px', borderRadius: 9, border: 'none',
                  background: 'var(--bg-card-2)', color: 'var(--text-secondary)',
                  fontSize: 14, cursor: 'pointer',
                }}
              >Cancel</button>
            </div>
            {generating && (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center' }}>
                This takes about 15 seconds…
              </div>
            )}
          </div>
        ))}

        {isCustom && draft.aircraftImage && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--bg-card)', borderRadius: 10 }}>
            <img src={draft.aircraftImage} alt="" style={{ width: 48, height: 48, objectFit: 'contain' }} />
            <div style={{ fontSize: 13, color: 'var(--ok)' }}>Icon ready</div>
          </div>
        )}

        <TailNumberInput value={draft.tailNumber ?? ''} onChange={v => update({ tailNumber: v })} />
        <Field label="Fuel type">
          <SegControl options={['AVGAS 100LL', 'JET-A']} value={draft.fuelType ?? 'AVGAS 100LL'} onChange={v => update({ fuelType: v })} />
        </Field>
        <Field label="Engine type">
          <SegControl options={['Piston', 'Turbine', 'Electric']} value={draft.engineType ?? 'Piston'} onChange={v => update({ engineType: v })} />
        </Field>
      </div>
      <NavButtons step={4} onBack={onBack} onNext={onNext} onSkip={onSkip} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 5: Home base + preferences
// ---------------------------------------------------------------------------

export const UNIT_ROWS = [
  { key: 'unitDistance',    label: 'Distance',       options: ['NM', 'SM', 'KM'],      default: 'NM' },
  { key: 'unitSpeed',       label: 'Speed',          options: ['KT', 'MPH', 'KM/H'],  default: 'KT' },
  { key: 'unitAltitude',    label: 'Altitude',       options: ['FT', 'M'],             default: 'FT' },
  { key: 'unitWeight',      label: 'Weight',         options: ['LBS', 'KG'],           default: 'LBS' },
  { key: 'unitFuelVolume',  label: 'Fuel volume',    options: ['USG', 'L', 'KG'],      default: 'USG' },
  { key: 'unitTemperature', label: 'Temperature',    options: ['°C', '°F'],            default: '°C' },
  { key: 'unitPressure',    label: 'Pressure',       options: ['inHg', 'hPa'],         default: 'inHg' },
  { key: 'unitFuelBurn',    label: 'Fuel burn rate', options: ['GPH', 'LPH', 'KG/H'], default: 'GPH' },
]

function Step5({ draft, update, onNext, onBack }) {
  const [airportStatus, setAirportStatus] = useState(null) // null | 'checking' | 'valid' | 'invalid'
  const checkedRef = useRef('')

  useEffect(() => {
    const id = (draft.homeAirport ?? '').trim().toUpperCase()
    if (id.length < 3) { setAirportStatus(null); return }
    if (id === checkedRef.current) return

    setAirportStatus('checking')
    const timer = setTimeout(async () => {
      checkedRef.current = id
      try {
        await loadWeather(id) // also caches METAR/TAF so it's ready on the Home page
        setAirportStatus('valid')
      } catch {
        setAirportStatus('invalid')
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [draft.homeAirport])

  const statusColor = airportStatus === 'valid' ? 'var(--ok)' : airportStatus === 'invalid' ? 'var(--danger)' : 'var(--text-tertiary)'
  const statusLabel = airportStatus === 'checking' ? 'Checking airport…'
    : airportStatus === 'valid' ? 'Airport found, weather ready'
    : airportStatus === 'invalid' ? 'No weather data for this airport'
    : null

  return (
    <div>
      <StepHeader step={5} title="Home base" sub="Set your home airport and how you want units displayed across the app." />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <TextInput
            label="Home airport (ICAO)"
            value={draft.homeAirport}
            onChange={v => update({ homeAirport: v.toUpperCase() })}
            placeholder="CYQB"
          />
          {statusLabel && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, paddingLeft: 2 }}>
              {airportStatus === 'checking' ? (
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
              ) : (
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
              )}
              <span style={{ fontSize: 11, color: statusColor, fontWeight: 600 }}>{statusLabel}</span>
            </div>
          )}
        </div>

        <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px 4px' }}>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Units</span>
          </div>
          {UNIT_ROWS.map((row) => (
            <div key={row.key} style={{
              padding: '10px 16px',
              borderBottom: 'none',
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, letterSpacing: '0.01em' }}>{row.label}</div>
              <SegControl
                options={row.options}
                value={draft[row.key] ?? row.default}
                onChange={v => update({ [row.key]: v })}
              />
            </div>
          ))}
        </div>
      </div>
      <NavButtons step={5} onBack={onBack} onNext={onNext} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 6: Summary
// ---------------------------------------------------------------------------

function SummaryRow({ label, value, color }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '10px 14px',
    }}>
      <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 600, color: color ?? 'var(--text)' }}>{value || '—'}</span>
    </div>
  )
}

function SummaryCard({ children }) {
  return (
    <div style={{ background: 'var(--bg-card-2)', borderRadius: 'var(--r-md)', border: '0.5px solid var(--border)', overflow: 'hidden', marginBottom: 12 }}>
      {children}
    </div>
  )
}

function Step6({ draft, onBack, onDone }) {
  const certLine = [draft.certificate, ...(draft.ratings ?? [])].filter(Boolean).join(' · ')

  return (
    <div>
      <StepHeader step={6} title="Ready to fly" sub="Here's what we set up. You can edit any of this in the app at any time." />

      <SummaryCard>
        <SummaryRow label="Name" value={draft.name} />
        <SummaryRow label="Certificate" value={certLine} />
        <SummaryRow label="Home base" value={draft.homeAirport} />
      </SummaryCard>

      <SummaryCard>
        <SummaryRow label="Medical" value={draft.medClass ? `${draft.medClass} Class` : 'Not set'} />
        <SummaryRow label="Flight review" value={draft.flightReview?.completionDate ? fmtDate(draft.flightReview.completionDate) : 'Not set'} />
      </SummaryCard>

      {draft.tailNumber && (
        <SummaryCard>
          <SummaryRow label="Aircraft" value={`${draft.tailNumber}${draft.aircraftModel ? ` · ${draft.aircraftModel}` : ''}`} />
            <SummaryRow label="Fuel" value={draft.fuelType ?? 'AVGAS 100LL'} />
        </SummaryCard>
      )}

      <NavButtons step={6} onBack={onBack} onNext={onDone} nextLabel="Enter the app" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Root: Onboarding
// ---------------------------------------------------------------------------

export default function Onboarding() {
  const { profile, setProfile } = usePilotProfile()
  const [step, setStep] = useState(1)
  const [dir, setDir] = useState('forward')
  const [draft, setDraft] = useState(() => {
    const p = profile ?? {}
    return { ...p, certificate: p.certificate || 'Student', medClass: p.medClass || '1st' }
  })

  function update(patch) {
    setDraft(prev => ({ ...prev, ...patch }))
  }

  function next() { setDir('forward'); setStep(s => s + 1) }
  function back() { setDir('back');    setStep(s => s - 1) }

  async function finish() {
    // Seed home airport so WeatherCard on the Home page finds it immediately
    // (its METAR/TAF were already prefetched into the 'weather' store during Step 5)
    if (draft.homeAirport) {
      await put('settings', { key: 'homeAirport', value: draft.homeAirport.trim().toUpperCase() })
    }

    // Write selected aircraft template to aircraft store so Aircraft page loads it immediately
    const tpl = TEMPLATES.find(t => t.id === draft.aircraftTemplateId)
    await put('aircraft', {
      ...(tpl ?? { category: 'custom', fullName: draft.aircraftModel ?? 'My Aircraft' }),
      id: 'profile',
      registration: draft.tailNumber ?? '',
      pilotName: draft.name ?? '',
      ...(draft.aircraftImage ? { image: draft.aircraftImage } : {}),
    })

    // Seed currency store with onboarding data so Currency page shows correct status on first open
    await put('currency', {
      id: 'profile',
      medClass:     draft.medClass ?? null,
      dob:          draft.dob ?? '',
      examDate:     draft.medDate ?? '',
      flightReview: draft.flightReview?.completionDate ?? '',
    })

    // Flip onboardingComplete LAST: this triggers the route switch to Home,
    // which mounts WeatherCard and reads 'settings'/homeAirport on mount.
    const savedProfile = { ...draft, onboardingComplete: true }
    await setProfile(savedProfile)
    trackEvent('onboarding_complete')
  }

  const anim = dir === 'forward' ? 'slide-in-right 0.28s ease' : 'slide-in-left 0.28s ease'

  return (
    <div style={{
      minHeight: '100%', background: 'var(--bg)',
      display: 'flex', justifyContent: 'center',
      overflowY: 'auto', overflowX: 'hidden',
    }}>
      <div style={{ width: '100%', maxWidth: 480, padding: '48px 20px 0', display: 'flex', flexDirection: 'column' }}>
        <ProgressDots step={step} />

        <div key={step} style={{ animation: anim }}>
          {step === 1 && <Step1 draft={draft} update={update} onNext={next} />}
          {step === 2 && <Step2 draft={draft} update={update} onNext={next} onBack={back} />}
          {step === 3 && <Step3 draft={draft} update={update} onNext={next} onBack={back} onSkip={next} />}
          {step === 4 && <Step4 draft={draft} update={update} onNext={next} onBack={back} onSkip={next} />}
          {step === 5 && <Step5 draft={draft} update={update} onNext={next} onBack={back} />}
          {step === 6 && <Step6 draft={draft} onBack={back} onDone={finish} />}
        </div>
      </div>
    </div>
  )
}
