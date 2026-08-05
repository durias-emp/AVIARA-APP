import { useEffect, useState } from 'react'
import { get, put, del, getAll } from '../../lib/db'
import { submitUapReport, listMySubmittedReports } from '../../lib/uapReports'
import { useAuth } from '../../context/AuthContext'
import { useLogbook } from '../../context/Logbook'
import { computeTotalHours } from '../../lib/logbookFields'
import { IconChevronRight, IconChevronLeft, IconUap } from '../../components/Icons'

// A report is a local IndexedDB draft (client-generated id, editable,
// backed up privately via SYNCED_STORES) until the pilot explicitly submits
// it — submitting inserts a row into the shared uap_reports Supabase table
// (supabase/migrations/0003_uap_reports.sql) and deletes the local draft,
// rather than trying to keep a client-generated id and a DB-generated
// bigint id in sync. The List view below merges both sources: drafts
// (editable) and submitted reports (read-only, fetched back via RLS).
//
// Submitted reports can't be edited or deleted from here — that's
// deliberate (see the migration's header comment): a "gold standard"
// dataset can't have quietly rewritten history. A pilot who wants a
// submission removed contacts support.

function genId() {
  return `uap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

const SHAPES = [
  { value: 'disc', label: 'Disc' },
  { value: 'orb_sphere', label: 'Orb / Sphere' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'cylinder', label: 'Cylinder' },
  { value: 'cigar', label: 'Cigar' },
  { value: 'fireball', label: 'Fireball' },
  { value: 'formation', label: 'Formation (multiple)' },
  { value: 'other', label: 'Other' },
]
const MOTIONS = [
  { value: 'hovering', label: 'Hovering' },
  { value: 'rapid_acceleration', label: 'Rapid acceleration' },
  { value: 'silent_flight', label: 'Silent flight' },
  { value: 'erratic', label: 'Erratic / zig-zag' },
  { value: 'instant_direction_change', label: 'Instant direction change' },
  { value: 'standard_flight_path', label: 'Standard flight path' },
  { value: 'other', label: 'Other' },
]
const ANGULAR_SIZES = [
  { value: 'smaller_than_star', label: 'Smaller than a star' },
  { value: 'fist_at_arm', label: "About a fist at arm's length" },
  { value: 'larger_than_moon', label: 'Larger than the moon' },
  { value: 'larger_than_aircraft', label: 'Larger than a nearby aircraft' },
  { value: 'unsure', label: 'Not sure' },
]
const SOUNDS = [
  { value: 'silent', label: 'Silent' },
  { value: 'low_hum', label: 'Low hum' },
  { value: 'roar', label: 'Roar / loud' },
  { value: 'other', label: 'Other' },
]
const DURATIONS = [
  { value: 'under_10s', label: 'Under 10 seconds' },
  { value: '10_60s', label: '10–60 seconds' },
  { value: '1_5min', label: '1–5 minutes' },
  { value: '5_30min', label: '5–30 minutes' },
  { value: 'over_30min', label: 'Over 30 minutes' },
  { value: 'ongoing', label: 'Still going when I stopped watching' },
]
const AGE_RANGES = [
  { value: 'under_18', label: 'Under 18' },
  { value: '18_24', label: '18–24' },
  { value: '25_34', label: '25–34' },
  { value: '35_44', label: '35–44' },
  { value: '45_54', label: '45–54' },
  { value: '55_64', label: '55–64' },
  { value: '65_plus', label: '65+' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
]
const GENDERS = [
  { value: 'woman', label: 'Woman' },
  { value: 'man', label: 'Man' },
  { value: 'nonbinary', label: 'Nonbinary' },
  { value: 'self_described', label: 'Self-described' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
]

function labelFor(options, value) {
  return options.find(o => o.value === value)?.label ?? value ?? '—'
}

function fmtDateTime(iso) {
  if (!iso) return 'No date'
  const d = new Date(iso)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
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

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  )
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '11px 13px', borderRadius: 10,
  border: 'none', background: 'var(--bg-card-2)', color: 'var(--text)',
  fontSize: 15, outline: 'none', fontFamily: 'inherit',
}

function TextInput({ value, onChange, placeholder, type = 'text' }) {
  return <input type={type} value={value ?? ''} placeholder={placeholder ?? ''} onChange={e => onChange(e.target.value)} style={inputStyle} />
}

function Select({ value, onChange, options }) {
  return (
    <select value={value ?? ''} onChange={e => onChange(e.target.value)} style={{ ...inputStyle, appearance: 'auto' }}>
      <option value="">Select…</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function DetailRow({ label, value }) {
  if (!value) return null
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
      <span style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>{label}</span>
      <span style={{ color: 'var(--text)', textAlign: 'right' }}>{value}</span>
    </div>
  )
}

// Read-only — submitted reports can't be edited (see file header).
function SubmittedDetail({ report, onBack }) {
  return (
    <div style={{ paddingBottom: 40 }}>
      <div style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onBack} aria-label="Back" style={{
          width: 36, height: 36, borderRadius: '50%', border: '0.5px solid var(--border)',
          background: 'var(--bg-card)', boxShadow: 'var(--shadow-sm)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text)',
        }}><IconChevronLeft size={18} /></button>
        <h2 style={{
          fontSize: 22, fontWeight: 700, letterSpacing: '-0.3px', color: 'var(--text)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
        }}>Submitted Report</h2>
      </div>
      <div style={{ padding: '16px 18px 0' }}>
        <Card title="When & Where">
          <DetailRow label="Occurred" value={fmtDateTime(report.occurred_at)} />
          <DetailRow label="Duration" value={labelFor(DURATIONS, report.duration_bucket)} />
          <DetailRow label="Location" value={report.location_text} />
          <DetailRow label="Altitude" value={report.altitude_ft ? `${report.altitude_ft} ft` : null} />
        </Card>
        <Card title="What You Saw">
          <DetailRow label="Shape" value={labelFor(SHAPES, report.shape)} />
          <DetailRow label="Motion" value={labelFor(MOTIONS, report.motion)} />
          <DetailRow label="Angular size" value={labelFor(ANGULAR_SIZES, report.angular_size)} />
          <DetailRow label="Color" value={report.color} />
          <DetailRow label="Sound" value={labelFor(SOUNDS, report.sound)} />
          <DetailRow label="Witnesses" value={report.witness_count} />
          <DetailRow label="Nearby objects" value={report.nearby_objects} />
          <DetailRow label="Weather/visibility" value={report.weather_visibility} />
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: 6 }}>Description</div>
            <div style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.5 }}>{report.description}</div>
          </div>
        </Card>
        <p style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center', padding: '4px 8px 8px', lineHeight: 1.5 }}>
          Submitted {fmtDateTime(report.created_at)}. Submitted reports are locked — contact support if this needs to be corrected or removed.
        </p>
      </div>
    </div>
  )
}

function Checkbox({ checked, onChange, children }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
      <input
        type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ width: 18, height: 18, marginTop: 1, flexShrink: 0, accentColor: 'var(--accent)' }}
      />
      <span style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{children}</span>
    </label>
  )
}

function ReportForm({ initial, onSave, onSubmit, onCancel, onDelete, submitting, canSubmitAuth, loggedHours }) {
  const [report, setReport] = useState(initial)
  const [locating, setLocating] = useState(false)

  function set(patch) { setReport(r => ({ ...r, ...patch })) }

  function useCurrentLocation() {
    if (!navigator.geolocation) return
    setLocating(true)
    // One-shot fix, not a continuous watch — this form just needs a single
    // coordinate stamped on the report, not a live position stream.
    navigator.geolocation.getCurrentPosition(
      pos => { set({ lat: pos.coords.latitude, lon: pos.coords.longitude }); setLocating(false) },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const canSave = report.description.trim().length > 0
  const canSubmit = canSubmitAuth && report.consent
    && report.date && report.locationText.trim().length > 0 && report.description.trim().length > 0
    && !submitting

  return (
    <div style={{ padding: '0 18px' }}>
      <Card title="When">
        <Field label="Date">
          <TextInput type="date" value={report.date} onChange={v => set({ date: v })} />
        </Field>
        <Field label="Approximate time">
          <TextInput type="time" value={report.time} onChange={v => set({ time: v })} />
        </Field>
        <Field label="Duration">
          <Select value={report.durationBucket} onChange={v => set({ durationBucket: v })} options={DURATIONS} />
        </Field>
      </Card>

      <Card title="Where">
        <Field label="Location">
          <TextInput value={report.locationText} onChange={v => set({ locationText: v })} placeholder="Airport, city, or landmark" />
        </Field>
        <button
          onClick={useCurrentLocation}
          disabled={locating}
          style={{
            padding: '9px 14px', borderRadius: 10, border: '0.5px solid var(--border)',
            background: 'var(--bg-card-2)', color: 'var(--text)', fontSize: 13, fontWeight: 600,
            cursor: locating ? 'default' : 'pointer', opacity: locating ? 0.6 : 1, alignSelf: 'flex-start',
          }}
        >
          {report.lat != null ? `Location captured (${report.lat.toFixed(3)}, ${report.lon.toFixed(3)})` : locating ? 'Locating…' : 'Use current location'}
        </button>
        <Field label="Your altitude (ft), if airborne">
          <TextInput type="number" value={report.altitudeFt} onChange={v => set({ altitudeFt: v })} placeholder="Optional" />
        </Field>
      </Card>

      <Card title="What you saw">
        <Field label="Shape">
          <Select value={report.shape} onChange={v => set({ shape: v })} options={SHAPES} />
        </Field>
        <Field label="Motion / behavior">
          <Select value={report.motion} onChange={v => set({ motion: v })} options={MOTIONS} />
        </Field>
        <Field label="Angular size">
          <Select value={report.angularSize} onChange={v => set({ angularSize: v })} options={ANGULAR_SIZES} />
        </Field>
        <Field label="Color">
          <TextInput value={report.color} onChange={v => set({ color: v })} placeholder="Optional" />
        </Field>
        <Field label="Sound">
          <Select value={report.sound} onChange={v => set({ sound: v })} options={SOUNDS} />
        </Field>
        <Field label="Number of witnesses">
          <TextInput type="number" value={report.witnesses} onChange={v => set({ witnesses: v })} placeholder="Optional" />
        </Field>
        <Field label="Nearby aircraft, drones, or lights">
          <TextInput value={report.nearbyObjects} onChange={v => set({ nearbyObjects: v })} placeholder="Anything nearby that might explain it" />
        </Field>
        <Field label="Weather / visibility">
          <TextInput value={report.weatherVisibility} onChange={v => set({ weatherVisibility: v })} placeholder="Optional" />
        </Field>
        <Field label="Description">
          <textarea
            value={report.description}
            onChange={e => set({ description: e.target.value })}
            placeholder="What happened — appearance, movement, sound, anything nearby that might explain it"
            rows={6}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.4 }}
          />
        </Field>
      </Card>

      <Card title="About you (optional)">
        <p style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5, margin: '0 0 4px' }}>
          Never required to submit — skip either field if you'd rather not say.
        </p>
        <Field label="Age range">
          <Select value={report.ageRange} onChange={v => set({ ageRange: v })} options={AGE_RANGES} />
        </Field>
        <Field label="Gender">
          <Select value={report.gender} onChange={v => set({ gender: v })} options={GENDERS} />
        </Field>
        {report.gender === 'self_described' && (
          <Field label="Self-described">
            <TextInput value={report.genderOther} onChange={v => set({ genderOther: v })} />
          </Field>
        )}
        <DetailRow label="Logged flight hours" value={loggedHours != null ? `${loggedHours.toFixed(1)} hr (from your Logbook)` : 'Not available'} />
      </Card>

      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <button
          onClick={onCancel}
          style={{
            flex: 1, padding: '13px', borderRadius: 'var(--r-sm)', border: '0.5px solid var(--border)',
            background: 'var(--bg-card-2)', color: 'var(--text)', fontSize: 15, fontWeight: 600, cursor: 'pointer',
          }}
        >Cancel</button>
        <button
          onClick={() => canSave && onSave(report)}
          disabled={!canSave}
          style={{
            flex: 1, padding: '13px', borderRadius: 'var(--r-sm)', border: '0.5px solid var(--border)',
            background: 'var(--bg-card-2)', color: 'var(--text)', fontSize: 15, fontWeight: 700,
            cursor: canSave ? 'pointer' : 'default', opacity: canSave ? 1 : 0.5,
          }}
        >Save Draft</button>
      </div>
      {onDelete && (
        <button
          onClick={onDelete}
          style={{
            width: '100%', marginTop: 10, padding: '11px', borderRadius: 'var(--r-sm)', border: 'none',
            background: 'transparent', color: 'var(--danger)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}
        >Delete draft</button>
      )}

      <div style={{ marginTop: 18, padding: '14px 16px', background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)' }}>
        <Checkbox checked={!!report.consent} onChange={v => set({ consent: v })}>
          I agree this report — including the sighting details and any age/gender I provide above, but never my name, email, or account identity — may be included in an anonymized dataset AVIARA shares or licenses for UAP research. Submitted reports can't be edited or deleted from the app afterward.
        </Checkbox>
        <button
          onClick={() => canSubmit && onSubmit(report)}
          disabled={!canSubmit}
          style={{
            width: '100%', marginTop: 14, padding: '13px', borderRadius: 'var(--r-sm)', border: 'none',
            background: 'var(--accent)', color: 'var(--accent-fg)', fontSize: 15, fontWeight: 700,
            cursor: canSubmit ? 'pointer' : 'default', opacity: canSubmit ? 1 : 0.5,
          }}
        >
          {!canSubmitAuth ? 'Sign in to submit' : submitting ? 'Submitting…' : 'Submit to AVIARA Database'}
        </button>
      </div>
    </div>
  )
}

function emptyReport(defaults) {
  const now = new Date()
  return {
    id: genId(),
    createdAt: now.toISOString(),
    date: now.toISOString().slice(0, 10),
    time: now.toTimeString().slice(0, 5),
    durationBucket: '', locationText: '', lat: null, lon: null, altitudeFt: '',
    shape: '', motion: '', angularSize: '', color: '', sound: '',
    witnesses: '', nearbyObjects: '', weatherVisibility: '', description: '',
    ageRange: defaults?.ageRange ?? '', gender: defaults?.gender ?? '', genderOther: defaults?.genderOther ?? '',
    consent: false,
  }
}

function ReportRow({ report, submitted, onOpen }) {
  const when = submitted ? report.created_at : report.createdAt
  const subtitle = submitted
    ? [labelFor(SHAPES, report.shape), report.location_text].filter(Boolean).join(' · ')
    : [report.shape && labelFor(SHAPES, report.shape), report.locationText].filter(Boolean).join(' · ') || report.description.slice(0, 40)
  return (
    <div
      onClick={() => onOpen(report)}
      role="button" tabIndex={0}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '13px 16px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
      }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{fmtDateTime(when)}</span>
          {submitted && (
            <span style={{
              fontSize: 10, fontWeight: 700, color: 'var(--ok)', background: 'var(--bg-card-2)',
              borderRadius: 6, padding: '2px 6px', textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>Submitted</span>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {subtitle}
        </div>
      </div>
      <span style={{ color: 'var(--text-tertiary)', display: 'flex', flexShrink: 0 }}><IconChevronRight size={14} /></span>
    </div>
  )
}

// Reached from the Tools menu — self-contained, no routes (matches
// Calculators/Reference, ToolsMenu's other sub-tools).
export default function UAPReport({ onBack }) {
  const { user } = useAuth()
  const { entries } = useLogbook()
  const loggedHours = entries === undefined ? null : computeTotalHours(entries)

  const [drafts, setDrafts] = useState(undefined)
  const [submitted, setSubmitted] = useState([])
  const [editing, setEditing] = useState(null) // null | draft object
  const [viewingSubmitted, setViewingSubmitted] = useState(null) // null | submitted row
  const [submitting, setSubmitting] = useState(false)

  async function refreshDrafts() {
    const rows = await getAll('uapReports')
    setDrafts(rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
  }

  async function refreshSubmitted() {
    if (!user) { setSubmitted([]); return }
    const { data } = await listMySubmittedReports(user.id)
    setSubmitted(data)
  }

  useEffect(() => { refreshDrafts() }, [])
  useEffect(() => { refreshSubmitted() }, [user])

  async function startNewReport() {
    const defaults = await get('settings', 'uapDemographicsDefault')
    setEditing(emptyReport(defaults?.value))
  }

  async function handleSave(report) {
    await put('uapReports', report)
    setEditing(null)
    refreshDrafts()
  }

  async function handleDelete() {
    await del('uapReports', editing.id)
    setEditing(null)
    refreshDrafts()
  }

  async function handleSubmit(report) {
    setSubmitting(true)
    const occurredAt = new Date(`${report.date}T${report.time || '00:00'}`).toISOString()
    const payload = {
      reporter_id: user.id,
      occurred_at: occurredAt,
      duration_bucket: report.durationBucket || null,
      location_text: report.locationText.trim(),
      lat: report.lat, lon: report.lon,
      altitude_ft: report.altitudeFt ? Number(report.altitudeFt) : null,
      shape: report.shape || null,
      motion: report.motion || null,
      angular_size: report.angularSize || null,
      color: report.color || null,
      sound: report.sound || null,
      witness_count: report.witnesses ? Number(report.witnesses) : null,
      nearby_objects: report.nearbyObjects || null,
      weather_visibility: report.weatherVisibility || null,
      description: report.description.trim(),
      reporter_age_range: report.ageRange || null,
      reporter_gender: report.gender || null,
      reporter_gender_other: report.gender === 'self_described' ? report.genderOther || null : null,
      reporter_is_pilot: (loggedHours ?? 0) > 0,
      reporter_logged_hours: loggedHours,
      data_share_consent: true,
    }
    const { error } = await submitUapReport(payload)
    setSubmitting(false)
    if (error) return // report stays open/editable as a draft; a transient failure shouldn't lose the pilot's writing

    await put('settings', { key: 'uapDemographicsDefault', value: { ageRange: report.ageRange, gender: report.gender, genderOther: report.genderOther } })
    await del('uapReports', report.id)
    setEditing(null)
    refreshDrafts()
    refreshSubmitted()
  }

  if (viewingSubmitted) {
    return <SubmittedDetail report={viewingSubmitted} onBack={() => setViewingSubmitted(null)} />
  }

  if (editing) {
    return (
      <div style={{ paddingBottom: 40 }}>
        <div style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => setEditing(null)} aria-label="Back" style={{
            width: 36, height: 36, borderRadius: '50%', border: '0.5px solid var(--border)',
            background: 'var(--bg-card)', boxShadow: 'var(--shadow-sm)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text)',
          }}><IconChevronLeft size={18} /></button>
          <h2 style={{
            fontSize: 22, fontWeight: 700, letterSpacing: '-0.3px', color: 'var(--text)',
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
          }}>{drafts?.some(r => r.id === editing.id) ? 'Edit Draft' : 'New Report'}</h2>
        </div>
        <div style={{ paddingTop: 16 }}>
          <ReportForm
            initial={editing}
            onSave={handleSave}
            onSubmit={handleSubmit}
            onCancel={() => setEditing(null)}
            onDelete={drafts?.some(r => r.id === editing.id) ? handleDelete : null}
            submitting={submitting}
            canSubmitAuth={!!user}
            loggedHours={loggedHours}
          />
        </div>
      </div>
    )
  }

  const combined = [
    ...(drafts ?? []).map(r => ({ submitted: false, data: r, sortKey: r.createdAt })),
    ...submitted.map(r => ({ submitted: true, data: r, sortKey: r.created_at })),
  ].sort((a, b) => b.sortKey.localeCompare(a.sortKey))

  return (
    <div style={{ paddingBottom: 40 }}>
      <div style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onBack} aria-label="Back" style={{
          width: 36, height: 36, borderRadius: '50%', border: '0.5px solid var(--border)',
          background: 'var(--bg-card)', boxShadow: 'var(--shadow-sm)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text)',
        }}><IconChevronLeft size={18} /></button>
        <h2 style={{
          fontSize: 28, fontWeight: 700, letterSpacing: '-0.4px', color: 'var(--text)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
        }}>UAP Report</h2>
      </div>

      <div style={{ padding: '16px 18px 0' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg-card)', borderRadius: 16,
          boxShadow: 'var(--shadow-sm)', padding: '14px 16px', marginBottom: 16,
        }}>
          <span style={{ color: 'var(--text-secondary)', display: 'flex' }}><IconUap size={22} /></span>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
            Log an unidentified aerial phenomenon sighting — same idea as a PIREP, focused on the UAP/UFO community. Draft privately, then submit when ready to include it in AVIARA's shared report database.
          </p>
        </div>

        <button
          onClick={startNewReport}
          style={{
            width: '100%', boxSizing: 'border-box', padding: '13px', borderRadius: 'var(--r-sm)',
            background: 'var(--accent)', color: 'var(--accent-fg)',
            fontSize: 15, fontWeight: 700, textAlign: 'center', cursor: 'pointer', marginBottom: 16, border: 'none',
          }}>+ New Report</button>

        {drafts === undefined ? null : combined.length === 0 ? (
          <div style={{
            background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)',
            padding: '24px 16px', textAlign: 'center', fontSize: 13, color: 'var(--text-tertiary)',
          }}>
            No reports logged yet
          </div>
        ) : (
          <div style={{ background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
            {combined.map(({ submitted: isSubmitted, data }, i) => (
              <div key={isSubmitted ? `s-${data.id}` : data.id} style={{ borderTop: i === 0 ? 'none' : '0.5px solid var(--border)' }}>
                <ReportRow report={data} submitted={isSubmitted} onOpen={isSubmitted ? setViewingSubmitted : setEditing} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
