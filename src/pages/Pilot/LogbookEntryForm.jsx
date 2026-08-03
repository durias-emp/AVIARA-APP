import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { BackButton } from '../../components/Shell'
import { get } from '../../lib/db'
import { useLogbook } from '../../context/Logbook'
import { useActiveAircraft } from '../../context/ActiveAircraft'
import { FIELD_SECTIONS, defaultFieldConfig } from '../../lib/logbookFields'

// Same date-picker-styled-as-a-button pattern as Pilot.jsx's own DateInput —
// duplicated rather than imported, matching this codebase's established
// convention of small per-page UI primitives (see AirportInfo/
// WeatherDetailOverlay each keeping their own RawTextRow).
function DateInput({ label, value, onChange }) {
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
    <div style={{ position: 'relative' }}>
      {label && <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: 6 }}>{label}</div>}
      <div onClick={openPicker} style={{
        background: 'var(--bg-card-2)', borderRadius: 10, padding: '11px 13px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer',
      }}>
        <span style={{ fontSize: 15, color: displayDate ? 'var(--text)' : 'var(--text-tertiary)' }}>
          {displayDate || 'Select date'}
        </span>
      </div>
      <input
        ref={inputRef} type="date" value={value || ''}
        onChange={e => onChange(e.target.value)}
        style={{ position: 'absolute', top: 0, left: 0, width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
      />
    </div>
  )
}

function Card({ title, children }) {
  return (
    <div style={{ background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)', overflow: 'hidden', marginBottom: 14 }}>
      <div style={{ padding: '14px 16px 4px' }}>
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>{title}</span>
      </div>
      <div style={{ padding: '8px 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {children}
      </div>
    </div>
  )
}

function TextField({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <input
        type={type} value={value ?? ''} placeholder={placeholder ?? ''}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '11px 13px', borderRadius: 10,
          border: 'none', background: 'var(--bg-card-2)', color: 'var(--text)',
          fontSize: 15, outline: 'none', fontFamily: 'inherit',
        }}
      />
    </div>
  )
}

// Decimal-hours field with a "USE {total}" quick-fill — the dominant pattern
// across ForeFlight's own Times/Instrument/Training sections, copying
// whatever Total Time already is so the pilot isn't retyping the same number
// for a flight that was e.g. entirely dual received.
function HoursField({ label, sublabel, value, onChange, totalTime }) {
  const total = parseFloat(totalTime)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{label}</span>
          {sublabel && <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{sublabel}</div>}
        </div>
        {Number.isFinite(total) && total > 0 && (
          <button
            onClick={() => onChange(String(total))}
            style={{
              fontSize: 11, fontWeight: 600, color: 'var(--accent)', background: 'var(--bg-card-2)',
              border: '0.5px solid var(--border)', borderRadius: 20, padding: '4px 10px', cursor: 'pointer', flexShrink: 0,
            }}
          >USE {total}</button>
        )}
      </div>
      <input
        type="number" inputMode="decimal" step="0.1" value={value ?? ''} placeholder="0.0"
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '11px 13px', borderRadius: 10,
          border: 'none', background: 'var(--bg-card-2)', color: 'var(--text)',
          fontSize: 15, outline: 'none', fontFamily: 'inherit',
        }}
      />
    </div>
  )
}

function CounterField({ label, value, onChange }) {
  const n = Number(value) || 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => onChange(Math.max(0, n - 1))} style={{
          width: 30, height: 30, borderRadius: 8, border: '0.5px solid var(--border)',
          background: 'var(--bg-card-2)', color: 'var(--text)', fontSize: 16, cursor: 'pointer',
        }}>−</button>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', minWidth: 20, textAlign: 'center' }}>{n}</span>
        <button onClick={() => onChange(n + 1)} style={{
          width: 30, height: 30, borderRadius: 8, border: '0.5px solid var(--border)',
          background: 'var(--bg-card-2)', color: 'var(--text)', fontSize: 16, cursor: 'pointer',
        }}>+</button>
      </div>
    </div>
  )
}

const EMPTY_FORM = {
  aircraftId: '', date: '', from: '', to: '', route: '',
  totalTime: '', pic: '', night: '',
  dayTakeoffs: 0, nightTakeoffs: 0, dayLandings: 0, nightLandings: 0,
  comments: '',
}

export default function LogbookEntryForm() {
  const navigate = useNavigate()
  const { id } = useParams()
  const isNew = id === 'new'
  const { entries, addEntry, updateEntry, deleteEntry } = useLogbook()
  const { aircraftList } = useActiveAircraft()
  const [config, setConfig] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    get('settings', 'logbookFieldConfig').then(row => {
      setConfig({ ...defaultFieldConfig(), ...(row?.value ?? {}) })
    })
  }, [])

  useEffect(() => {
    if (isNew || !entries) return
    const existing = entries.find(e => e.id === id)
    if (existing) setForm({ ...EMPTY_FORM, ...existing })
  }, [isNew, id, entries])

  function set(key, value) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function handleSave() {
    if (isNew) {
      const saved = await addEntry(form)
      navigate(`/logbook/${saved.id}`, { replace: true })
    } else {
      // Opening and saving an auto-detected entry (Hangar's Flight History)
      // is what confirms it — clears the "needs review" flag so it drops out
      // of the pending list there.
      await updateEntry(id, { ...form, pendingReview: false })
    }
    navigate(-1)
  }

  async function handleDelete() {
    await deleteEntry(id)
    navigate(-1)
  }

  if (!config) return null

  const enabledByKey = Object.fromEntries(
    FIELD_SECTIONS.flatMap(s => s.fields).map(f => [f.key, !!config[f.key]])
  )
  const startEndFields = FIELD_SECTIONS.find(s => s.section === 'Start & End').fields.filter(f => enabledByKey[f.key])
  const timesFields = FIELD_SECTIONS.find(s => s.section === 'Times').fields.filter(f => enabledByKey[f.key])
  const instrumentFields = FIELD_SECTIONS.find(s => s.section === 'Instrument').fields.filter(f => enabledByKey[f.key])
  const trainingFields = FIELD_SECTIONS.find(s => s.section === 'Training').fields.filter(f => enabledByKey[f.key])

  return (
    <div style={{ paddingBottom: 40 }}>
      <div style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <BackButton onBack={() => navigate(-1)} />
          <h2 style={{
            fontSize: 24, fontWeight: 700, letterSpacing: '-0.4px', color: 'var(--text)',
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
          }}>{isNew ? 'New Entry' : 'Edit Entry'}</h2>
        </div>
        <button onClick={handleSave} style={{
          padding: '9px 18px', borderRadius: 20, border: 'none',
          background: 'var(--accent)', color: 'var(--accent-fg)',
          fontSize: 14, fontWeight: 700, cursor: 'pointer',
        }}>Save</button>
      </div>

      <div style={{ padding: '16px 18px 0' }}>
        <Card title="General">
          <DateInput label="Date" value={form.date} onChange={v => set('date', v)} />
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: 6 }}>Aircraft</div>
            <select
              value={form.aircraftId ?? ''} onChange={e => set('aircraftId', e.target.value)}
              style={{
                width: '100%', boxSizing: 'border-box', padding: '11px 13px', borderRadius: 10,
                border: 'none', background: 'var(--bg-card-2)', color: form.aircraftId ? 'var(--text)' : 'var(--text-tertiary)',
                fontSize: 15, outline: 'none', fontFamily: 'inherit', appearance: 'none',
              }}
            >
              <option value="">Select aircraft</option>
              {(aircraftList ?? []).map(a => (
                <option key={a.id} value={a.id}>{a.registration || a.id}</option>
              ))}
            </select>
          </div>
          <TextField label="From" value={form.from} onChange={v => set('from', v.toUpperCase())} placeholder="KJFK" />
          <TextField label="To" value={form.to} onChange={v => set('to', v.toUpperCase())} placeholder="KBOS" />
          {enabledByKey.route && (
            <TextField label="Route" value={form.route} onChange={v => set('route', v)} placeholder="Direct, or waypoints" />
          )}
        </Card>

        {startEndFields.length > 0 && (
          <Card title="Start & End">
            {startEndFields.map(f => (
              <div key={f.key}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>{f.label}</div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${f.inputs.length}, 1fr)`, gap: 8 }}>
                  {f.inputs.map(inp => (
                    <TextField key={inp.key} label={inp.label} value={form[inp.key]} onChange={v => set(inp.key, v)} />
                  ))}
                </div>
              </div>
            ))}
          </Card>
        )}

        <Card title="Times">
          <HoursField label="Total Time" value={form.totalTime} onChange={v => set('totalTime', v)} />
          <HoursField label="PIC" value={form.pic} onChange={v => set('pic', v)} totalTime={form.totalTime} />
          <HoursField label="Night" value={form.night} onChange={v => set('night', v)} totalTime={form.totalTime} />
          {timesFields.map(f => (
            <HoursField key={f.key} label={f.label} sublabel={f.sublabel} value={form[f.key]} onChange={v => set(f.key, v)} totalTime={form.totalTime} />
          ))}
        </Card>

        {enabledByKey.crossCountry && (
          <Card title="Cross Country">
            <TextField label="Distance" type="number" value={form.crossCountry} onChange={v => set('crossCountry', v)} placeholder="0" />
          </Card>
        )}

        <Card title="Total Takeoffs">
          <CounterField label="Day Takeoff" value={form.dayTakeoffs} onChange={v => set('dayTakeoffs', v)} />
          <CounterField label="Night Takeoff" value={form.nightTakeoffs} onChange={v => set('nightTakeoffs', v)} />
        </Card>

        <Card title="Total Landings">
          <CounterField label="Day Full Stop" value={form.dayLandings} onChange={v => set('dayLandings', v)} />
          <CounterField label="Night Full Stop" value={form.nightLandings} onChange={v => set('nightLandings', v)} />
          {enabledByKey.allLandings && (
            <CounterField label="All Landings" value={form.allLandings} onChange={v => set('allLandings', v)} />
          )}
        </Card>

        {instrumentFields.length > 0 && (
          <Card title="Instrument">
            {instrumentFields.map(f => (
              f.type === 'counter'
                ? <CounterField key={f.key} label={f.label} value={form[f.key]} onChange={v => set(f.key, v)} />
                : <HoursField key={f.key} label={f.label} sublabel={f.sublabel} value={form[f.key]} onChange={v => set(f.key, v)} totalTime={form.totalTime} />
            ))}
          </Card>
        )}

        {trainingFields.length > 0 && (
          <Card title="Training">
            {trainingFields.map(f => (
              <HoursField key={f.key} label={f.label} sublabel={f.sublabel} value={form[f.key]} onChange={v => set(f.key, v)} totalTime={form.totalTime} />
            ))}
          </Card>
        )}

        {enabledByKey.nightVisionGoggles && (
          <Card title="Night Vision Goggles">
            <HoursField label="Night Vision Goggles" value={form.nightVisionGoggles} onChange={v => set('nightVisionGoggles', v)} totalTime={form.totalTime} />
          </Card>
        )}

        {/* Tags/Crew/Photos aren't functional yet — placeholder rows only,
            matching the reference screenshots' structure so the layout is
            already right once these are built for real. */}
        <Card title="Flight Tags">
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Tags aren't built yet</div>
        </Card>
        <Card title="Crew & Passengers">
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Crew & passengers aren't built yet</div>
        </Card>
        <Card title="Flight Photos">
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Photos aren't built yet</div>
        </Card>

        <Card title="My Comments">
          <textarea
            value={form.comments ?? ''} onChange={e => set('comments', e.target.value)}
            rows={3} placeholder="Notes about this flight"
            style={{
              width: '100%', boxSizing: 'border-box', padding: '11px 13px', borderRadius: 10,
              border: 'none', background: 'var(--bg-card-2)', color: 'var(--text)',
              fontSize: 14, outline: 'none', fontFamily: 'inherit', resize: 'vertical',
            }}
          />
        </Card>

        {!isNew && (
          <button
            onClick={() => setConfirmDelete(true)}
            style={{
              width: '100%', padding: '13px', borderRadius: 'var(--r-sm)', border: 'none',
              background: 'var(--danger-light)', color: 'var(--danger)',
              fontSize: 15, fontWeight: 600, cursor: 'pointer', marginTop: 4,
            }}
          >Delete Entry</button>
        )}
      </div>

      {confirmDelete && (
        <div
          onClick={() => setConfirmDelete(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 600,
            background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px',
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{
            width: '100%', maxWidth: 340, background: 'var(--bg-card)', borderRadius: 16,
            padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Delete this entry?</div>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 18 }}>
              This can't be undone.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setConfirmDelete(false)}
                style={{
                  flex: 1, padding: '12px', borderRadius: 'var(--r-sm)', border: 'none',
                  background: 'var(--bg-card-2)', color: 'var(--text)', fontSize: 15, fontWeight: 600, cursor: 'pointer',
                }}
              >Cancel</button>
              <button
                onClick={handleDelete}
                style={{
                  flex: 1, padding: '12px', borderRadius: 'var(--r-sm)', border: 'none',
                  background: 'var(--danger)', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer',
                }}
              >Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
