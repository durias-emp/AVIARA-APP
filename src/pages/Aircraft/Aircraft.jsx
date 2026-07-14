import { useState, useEffect, useCallback, useRef } from 'react'
import { get, put } from '../../lib/db'
import { BackButton } from '../../components/Shell'
import { generateAircraftIcon } from '../../lib/generateIcon'
import { normalizeUserWBConfig, validateWBConfig } from '../../lib/aircraftWB'
import { FAR, calendarMonthExpiry, statusFromExpiry, statusFromHours, fmtDate, fmtDaysLeft } from '../../lib/currency'

function AircraftPlaceholder() {
  return (
    <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg"
      style={{ width: '100%', height: '100%', opacity: 0.18 }}>
      {/* Fuselage */}
      <ellipse cx="100" cy="105" rx="10" ry="52" fill="currentColor" />
      {/* Wings */}
      <path d="M100 95 L28 130 L38 134 L100 108 L162 134 L172 130 Z" fill="currentColor" />
      {/* Horizontal stabilizer */}
      <path d="M100 150 L72 162 L76 165 L100 155 L124 165 L128 162 Z" fill="currentColor" />
      {/* Vertical stabilizer */}
      <path d="M100 148 L95 135 L105 135 Z" fill="currentColor" />
      {/* Nose */}
      <ellipse cx="100" cy="55" rx="7" ry="10" fill="currentColor" />
    </svg>
  )
}

function GenerateIconButton({ aircraftName, onGenerated }) {
  const [open, setOpen]         = useState(false)
  const [name, setName]         = useState(aircraftName ?? '')
  const [generating, setGenerating] = useState(false)
  const [error, setError]       = useState(null)

  useEffect(() => { setName(aircraftName ?? '') }, [aircraftName])

  async function generate() {
    if (!name.trim()) return
    setGenerating(true)
    setError(null)
    try {
      const image = await generateAircraftIcon(name.trim())
      onGenerated(image)
      setOpen(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setGenerating(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'rgba(255,255,255,0.07)', border: '0.5px solid rgba(255,255,255,0.15)',
          borderRadius: 10, padding: '7px 14px', cursor: 'pointer',
          color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500,
        }}
      >
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none">
          <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
            stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Generate icon
      </button>
    )
  }

  return (
    <div style={{
      background: 'var(--bg-card)', border: '0.5px solid var(--border)',
      borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Generate aircraft icon</div>
      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: -4 }}>
        Describe your aircraft — model name is enough, add details if you want.
      </div>
      <input
        autoFocus
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && generate()}
        placeholder="e.g. Cirrus Vision Jet SF50"
        maxLength={80}
        style={{
          padding: '9px 12px', borderRadius: 9,
          border: '0.5px solid var(--border-strong)',
          background: 'var(--bg-card-2)', color: 'var(--text)',
          fontSize: 14, outline: 'none', fontFamily: 'inherit',
        }}
      />
      {error && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={generate}
          disabled={!name.trim() || generating}
          style={{
            flex: 1, padding: '9px 0', borderRadius: 9, border: 'none',
            background: 'var(--accent)', color: 'var(--accent-fg)',
            fontWeight: 700, fontSize: 14, cursor: generating ? 'default' : 'pointer',
            opacity: !name.trim() || generating ? 0.5 : 1,
          }}
        >
          {generating ? 'Generating…' : 'Generate'}
        </button>
        <button
          onClick={() => { setOpen(false); setError(null) }}
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
  )
}

/* ── Hobbs time entry — cumulative aircraft hours, odometer-style ──
   Single digit buffer, right-aligned: typing pushes older digits left,
   same feel as a price/odometer input rather than 6 separately-tabbed boxes. ── */
function HobbsTimeModal({ onCancel, onConfirm, initialValue }) {
  const initRaw = () => {
    if (initialValue == null) return ''
    const rounded = Math.round(initialValue * 10) / 10
    const whole = Math.floor(rounded)
    const tenths = Math.round((rounded - whole) * 10)
    return `${whole}${tenths}`.slice(-6)
  }

  const [raw, setRaw] = useState(initRaw)
  const inputRef = useRef(null)

  function handleChange(e) {
    setRaw(e.target.value.replace(/[^0-9]/g, '').slice(-6))
  }

  const padded = raw.padStart(6, '0')
  const digits = padded.split('')
  const whole = parseInt(padded.slice(0, 5), 10)
  const tenths = parseInt(padded.slice(5), 10)
  const value = whole + tenths / 10
  const isValid = raw.length > 0 && value > 0

  const digitBoxStyle = {
    width: 32, height: 42, borderRadius: 8, fontSize: 16, fontWeight: 700,
    color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontVariantNumeric: 'tabular-nums',
    background: 'var(--bg-card-2)', border: '0.5px solid var(--border)',
    boxSizing: 'border-box',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 600,
      background: 'rgba(0,0,0,0.55)',
      backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px',
    }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 320,
        background: 'var(--bg-card)', borderRadius: 16,
        padding: '16px 14px 14px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginTop: 0, marginBottom: 12, textAlign: 'center' }}>
          Hobbs Time
        </h3>

        <div
          style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginBottom: 16 }}
          onClick={() => inputRef.current?.focus()}
        >
          {digits.map((d, i) => (
            <div key={i} style={digitBoxStyle}>{d}</div>
          ))}
          <input
            ref={inputRef}
            type="text" inputMode="numeric" value={raw} onChange={handleChange}
            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
            autoFocus
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              opacity: 0, border: 'none', outline: 'none', padding: 0, cursor: 'pointer',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCancel} style={{
            flex: 1, padding: 10, borderRadius: 'var(--r-md)', border: '0.5px solid var(--border)',
            background: 'var(--bg-card-2)', color: 'var(--text-secondary)',
            fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
          }}>Cancel</button>
          <button disabled={!isValid} onClick={() => onConfirm(value)} style={{
            flex: 1, padding: 10, borderRadius: 'var(--r-md)', border: 'none',
            background: isValid ? 'var(--accent)' : 'var(--bg-card-2)',
            color: isValid ? 'var(--accent-fg)' : 'var(--text-tertiary)',
            fontSize: 14, fontWeight: 700, cursor: isValid ? 'pointer' : 'default',
            fontFamily: 'inherit',
          }}>Confirm</button>
        </div>
      </div>
    </div>
  )
}

/* ── Aircraft library ────────────────────────────────────── */
export const TEMPLATES = [
  // ── Fixed-wing ──────────────────────────────────────────
  {
    id: 'c152',
    label: 'C-152',
    fullName: 'Cessna 152',
    image: '/CESNA 152.png',
    category: 'trainer',
    weights: { bew: '1,081 lb', mtow: '1,670 lb', usefulLoad: '589 lb', baggage: '120 lb' },
    vspeeds: { vs: '43', vs0: '35', vx: '55', vy: '67', vg: '60', va: '90', vfe: '85', vno: '107', vne: '149', vref: '54', cruise: '107' },
    fuel: { total: '26 USG', usable: '24.5 USG', type: '100LL' },
    burnRate: { climb: '6.1 GPH', cruise: '6.1 GPH' },
    perf: { toRoll: '735 ft', to50ft: '1,340 ft', ldgRoll: '475 ft', ldg50ft: '1,200 ft' },
    notes: 'VA at MTOW (1,670 lb). VFE applies all flap settings. Standard avgas trainer.',
  },
  {
    id: 'c172s',
    label: 'C-172S',
    fullName: 'Cessna 172S Skyhawk',
    image: '/CENSA 172S.png',
    category: 'trainer',
    weights: { bew: '1,663 lb', mtow: '2,550 lb', usefulLoad: '887 lb', baggage: '120 lb' },
    vspeeds: { vs: '48', vs0: '40', vx: '62', vy: '74', vg: '68', va: '105', vfe: '85', vno: '129', vne: '163', vref: '62', cruise: '122' },
    fuel: { total: '56 USG', usable: '53 USG', type: '100LL' },
    burnRate: { climb: '11.5 GPH', cruise: '8.5 GPH' },
    perf: { toRoll: '960 ft', to50ft: '1,630 ft', ldgRoll: '575 ft', ldg50ft: '1,335 ft' },
    notes: '180 hp IO-360. VFE 110 kt (first 10° flap), 85 kt (10–30°). VA reduces with weight.',
  },
  {
    id: 'pa28181',
    label: 'PA-28-181',
    fullName: 'Piper PA-28-181 Archer III',
    image: '/Piper PA-28 Archer.png',
    category: 'trainer',
    weights: { bew: '1,690 lb', mtow: '2,550 lb', usefulLoad: '880 lb', baggage: '200 lb' },
    vspeeds: { vs: '50', vs0: '45', vx: '64', vy: '76', vg: '76', va: '113', vfe: '102', vno: '125', vne: '154', vref: '66', cruise: '128' },
    fuel: { total: '50 USG', usable: '48 USG', type: '100LL' },
    burnRate: { climb: '11.5 GPH', cruise: '10 GPH' },
    perf: { toRoll: '870 ft', to50ft: '1,600 ft', ldgRoll: '600 ft', ldg50ft: '1,390 ft' },
    notes: 'Low wing, 180 hp O-360. Electric fuel pump ON for T/O & landing. VY = VG (76 kt). Differential braking for steering.',
  },
  {
    id: 'c182t',
    label: 'C-182T',
    fullName: 'Cessna 182T Skylane',
    image: '/Cessna 182 Skylane.png',
    category: 'touring',
    weights: { bew: '1,970 lb', mtow: '3,100 lb', usefulLoad: '1,130 lb', baggage: '200 lb' },
    vspeeds: { vs: '50', vs0: '41', vx: '60', vy: '84', vg: '70', va: '110', vfe: '100', vno: '140', vne: '175', vref: '62', cruise: '145' },
    fuel: { total: '92 USG', usable: '87 USG', type: '100LL' },
    burnRate: { climb: '17 GPH', cruise: '14 GPH' },
    perf: { toRoll: '795 ft', to50ft: '1,514 ft', ldgRoll: '590 ft', ldg50ft: '1,350 ft' },
    notes: '230 hp IO-540, constant-speed prop, cowl flaps. VFE 140 (10°) / 120 (20°) / 100 (30°). Turbo T182T differs at altitude.',
  },
  {
    id: 'sr22',
    label: 'SR22',
    fullName: 'Cirrus SR22 G6',
    image: '/Cirrus SR22.png',
    category: 'touring',
    weights: { bew: '2,400 lb', mtow: '3,600 lb', usefulLoad: '1,150 lb', baggage: '130 lb' },
    vspeeds: { vs: '73', vs0: '60', vx: '88', vy: '102', vg: '88', va: '133', vfe: '110', vno: '176', vne: '205', vref: '79', cruise: '183' },
    fuel: { total: '94.5 USG', usable: '92 USG', type: '100LL' },
    burnRate: { climb: '19 GPH', cruise: '16.5 GPH' },
    perf: { toRoll: '1,082 ft', to50ft: '1,628 ft', ldgRoll: '693 ft', ldg50ft: '1,178 ft' },
    notes: '310 hp IO-550-N, composite. CAPS parachute deploy ≤ 140 KIAS. Single power lever. VFE 150 kt (50% flap), 110 kt (full).',
  },
  {
    id: 'c208',
    label: 'C-208B',
    fullName: 'Cessna 208B Grand Caravan EX',
    image: '/Cessna 208B Grand Caravan EX.png',
    category: 'turboprop',
    weights: { bew: '4,900 lb', mtow: '8,807 lb', usefulLoad: '3,800 lb', baggage: '1,090 lb' },
    vspeeds: { vs: '78', vs0: '61', vx: '72', vy: '104', vg: '95', va: '149', vfe: '95', vno: '175', vne: '175', vref: '82', cruise: '185' },
    fuel: { total: '335.6 USG', usable: '332 USG', type: 'Jet-A' },
    burnRate: { climb: '80 GPH', cruise: '62 GPH' },
    perf: { toRoll: '1,365 ft', to50ft: '2,055 ft', ldgRoll: '950 ft', ldg50ft: '1,795 ft' },
    notes: 'PT6A-140, 867 SHP. VMO replaces Vno/Vne. Inertial separator reduces perf. Rotate ~65–70 kt. Cargo pod ~1,090 lb.',
  },
  {
    id: 'pc12',
    label: 'PC-12',
    fullName: 'Pilatus PC-12 NGX',
    image: '/Pilatus PC-12 NGX.png',
    category: 'turboprop',
    weights: { bew: '6,173 lb', mtow: '10,450 lb', usefulLoad: '4,277 lb', baggage: '400 lb' },
    vspeeds: { vs: '67', vs0: '67', vx: '120', vy: '130', vg: '120', va: '166', vfe: '130', vno: '240', vne: '240', vref: '88', cruise: '290' },
    fuel: { total: '406.8 USG', usable: '402 USG', type: 'Jet-A' },
    burnRate: { climb: '75 GPH', cruise: '58 GPH' },
    perf: { toRoll: '1,180 ft', to50ft: '2,485 ft', ldgRoll: '1,800 ft', ldg50ft: '2,170 ft' },
    notes: 'PT6E-67XP, 1,200 SHP. EPECS (FADEC + autothrottle), single-lever. Pressurized to 30,000 ft. VMO 240 KCAS / M0.49. VFE by flap setting — verify AFM.',
  },
  {
    id: 'ka350',
    label: 'King Air 350',
    fullName: 'Beechcraft King Air 350i',
    image: '/Beechcraft King Air 350i.png',
    category: 'turboprop',
    weights: { bew: '9,955 lb', mtow: '15,000 lb', usefulLoad: '5,100 lb', baggage: '1,400 lb' },
    vspeeds: { vs: '78', vs0: '81', vx: '125', vy: '140', vg: '135', va: '184', vfe: '158', vno: '260', vne: '260', vref: '109', cruise: '312' },
    fuel: { total: '544 USG', usable: '539 USG', type: 'Jet-A' },
    burnRate: { climb: '130 GPH', cruise: '96 GPH' },
    perf: { toRoll: '1,940 ft', to50ft: '3,300 ft', ldgRoll: '2,100 ft', ldg50ft: '2,550 ft' },
    notes: '2× PT6A-60A (1,050 SHP). Pressurized, winglets. VMO 260 KIAS / M0.58. V1 ≈ 99, Vr ≈ 104, V2 ≈ 109, Vmca 93 — compute per weight/condition. VFE 202 kt approach, 158 kt full. Burn at LRC FL350.',
  },
  // ── Helicopters ─────────────────────────────────────────
  {
    id: 'r66',
    label: 'R66',
    fullName: 'Robinson R66 Turbine',
    image: '/Robinson R66 Turbine.png',
    category: 'helicopter',
    weights: { bew: '1,280 lb', mtow: '2,700 lb', usefulLoad: '1,350 lb', baggage: '300 lb' },
    vspeeds: { vne: '140', vy: '60', vx: '', auto: '65', cruise: '115' },
    fuel: { total: '73.6 USG', usable: '73.6 USG', type: 'Jet-A' },
    burnRate: { climb: '23 GPH', cruise: '23 GPH' },
    perf: { roc: '1,000 fpm', ceiling: '14,000 ft DA', hoverIGE: '>10,000 ft DA', hoverOGE: '>10,000 ft DA' },
    notes: 'RR300 (270 SHP T/O). 2-blade main rotor, crashworthy tanks. Vne decreases with DA and weight. Use HIGE/HOGE hover ceiling charts for performance planning.',
  },
  {
    id: 'b206',
    label: 'Bell 206B',
    fullName: 'Bell 206B-3 JetRanger III',
    image: '/Bell 206B-3 JetRanger III.png',
    category: 'helicopter',
    weights: { bew: '1,635 lb', mtow: '3,200 lb', usefulLoad: '1,400 lb', baggage: '250 lb' },
    vspeeds: { vne: '130', vy: '56', vx: '', auto: '69', cruise: '117' },
    fuel: { total: '91 USG', usable: '91 USG', type: 'Jet-A' },
    burnRate: { climb: '30 GPH', cruise: '29 GPH' },
    perf: { roc: '1,280 fpm', ceiling: '13,500 ft DA', hoverIGE: '9,400 ft DA', hoverOGE: '6,000 ft DA' },
    notes: 'Allison/RR 250-C20B/J, 420 SHP derated (~317 SHP at transmission limit). 2-blade semi-rigid rotor. Vne reduces with altitude/temp/weight. Range ~385 nm.',
  },
  {
    id: 'h125',
    label: 'H125',
    fullName: 'Airbus H125',
    image: '/Airbus H125.png',
    category: 'helicopter',
    weights: { bew: '2,580 lb', mtow: '4,961 lb', usefulLoad: '2,380 lb', baggage: '200 lb' },
    vspeeds: { vne: '155', vy: '62', vx: '', auto: '65', cruise: '135' },
    fuel: { total: '143 USG', usable: '143 USG', type: 'Jet-A' },
    burnRate: { climb: '50 GPH', cruise: '36 GPH' },
    perf: { roc: '1,670 fpm', ceiling: '23,000 ft DA', hoverIGE: '>22,960 ft DA', hoverOGE: '21,390 ft DA' },
    notes: 'Safran Arriel 2D, 952 SHP, dual-channel FADEC. 3-blade Starflex rotor. External MTOW 6,173 lb (sling load 3,086 lb). Vne decreases with alt/temp.',
  },
]

const CUSTOM_BLANK = {
  id: 'custom',
  label: 'Custom',
  fullName: '',
  registration: '',
  pilotName: '',
  category: 'custom',
  weights: { bew: '', mtow: '', usefulLoad: '', baggage: '' },
  vspeeds: { vs: '', vs0: '', vx: '', vy: '', vg: '', va: '', vfe: '', vno: '', vne: '', vref: '', cruise: '' },
  fuel: { total: '', usable: '', type: '100LL' },
  burnRate: { climb: '', cruise: '' },
  perf: { toRoll: '', to50ft: '', ldgRoll: '', ldg50ft: '', roc: '', ceiling: '', hoverIGE: '', hoverOGE: '' },
  notes: '',
}

/* ── Helpers ─────────────────────────────────────────────── */
function deepMerge(base, overrides) {
  const out = { ...base }
  for (const k of Object.keys(overrides ?? {})) {
    if (overrides[k] && typeof overrides[k] === 'object' && !Array.isArray(overrides[k])) {
      out[k] = { ...(base[k] ?? {}), ...overrides[k] }
    } else {
      out[k] = overrides[k]
    }
  }
  return out
}


/* ── Airworthiness — documents + inspections, moved here from Currency so
   it lives alongside the aircraft it describes. Still reads/writes the same
   currency/profile.airworthy data other parts of the app depend on
   (getCurrencyStatus, the Checklists "IM AIRWORTHY" item). ── */
const WARN_DAYS_DEFAULT = 30
const WARN_HOURS_DEFAULT = 10 // hrs before an hour-based inspection is "expiring"

const ARROW_DOCS = [
  { key: 'crew',      label: 'C — Crew documents (license · photo ID · medical)', far: FAR.crewDocs },
  { key: 'airworth',  label: 'A — Certificate of Airworthiness',                  far: FAR.airworthCert },
  { key: 'reg',       label: 'R — Certificate of Registration',                   far: FAR.registration },
  { key: 'radio',     label: 'R — Radio License (FCC / international)',            far: null },
  { key: 'oplim',     label: 'O — Operating Limitations (AFM / POH)',             far: FAR.opLimitations },
  { key: 'wb',        label: 'W — Weight &amp; Balance data',                     far: FAR.weightBalance },
  { key: 'insurance', label: 'Insurance current',                                  far: null },
]

// Inspections with calendar-month expiry
const INSPECTIONS = [
  { key: 'annualDate',      label: 'Annual Inspection',        months: 12, far: FAR.annual,      unit: 'date',  hint: '12 calendar months' },
  { key: 'transponderDate', label: 'Transponder (24-mo)',       months: 24, far: FAR.transponder, unit: 'date',  hint: '24 calendar months — FAR 91.413' },
  { key: 'pitotDate',       label: 'Pitot-Static / Altimeter', months: 24, far: FAR.pitotStatic, unit: 'date',  hint: '24 calendar months — IFR required — FAR 91.411' },
  { key: 'eltDate',         label: 'ELT Battery',              months: null, far: FAR.elt,         unit: 'date',  hint: 'Per manufacturer / FAR 91.207 — enter expiry date' },
  { key: 'oilDate',         label: 'Oil Change',               months: null, far: null,            unit: 'hours', hint: null },
  { key: 'hundredHrHours',  label: '100-hr Inspection',        months: null, far: FAR.hundredHour, unit: 'hours', hint: null },
]

function FarLink({ far }) {
  if (!far) return null
  return (
    <a href={far.url} target="_blank" rel="noreferrer" style={{
      fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)',
      textDecoration: 'none',
      padding: '3px 8px', borderRadius: 20,
      background: 'var(--bg-card)', border: '0.5px solid var(--border)',
      flexShrink: 0,
    }}>{far.label}</a>
  )
}

function AirworthinessBadge({ status }) {
  const map = {
    valid:      { bg: 'var(--ok-light)',      fg: 'var(--ok)',      label: 'Current'  },
    expiring:   { bg: 'rgba(234,179,8,0.15)', fg: 'var(--warn)',    label: 'Expiring' },
    expired:    { bg: 'var(--danger-light)',  fg: 'var(--danger)',  label: 'Expired'  },
    incomplete: { bg: 'var(--bg-card-2)',     fg: 'var(--text-tertiary)', label: 'Incomplete' },
  }
  const { bg, fg, label } = map[status] ?? map.incomplete
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 20,
      background: bg, color: fg,
      border: status === 'incomplete' ? '0.5px solid var(--border)' : 'none',
    }}>{label}</span>
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

// Read-only digit boxes showing the current Hobbs reading — placed above
// the next-due field so the user has it in view while entering a value.
function CurrentHobbsBoxes({ value }) {
  if (value == null) return null
  const rounded = Math.round(value * 10) / 10
  const whole = Math.floor(rounded)
  const tenths = Math.round((rounded - whole) * 10)
  const digits = `${whole}${tenths}`.slice(-6).padStart(6, '0').split('')

  const boxStyle = {
    flex: 1, height: 34, borderRadius: 8, fontSize: 13, fontWeight: 700,
    color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontVariantNumeric: 'tabular-nums',
    background: 'var(--bg-card)', border: '0.5px solid var(--border)',
    boxSizing: 'border-box',
  }

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 4 }}>
        Current Hobbs
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {digits.map((d, i) => <div key={i} style={boxStyle}>{d}</div>)}
      </div>
    </div>
  )
}

function InspectionRow({ insp, value, onDateChange, warnDays, currentHobbs }) {
  const inputRef = useRef(null)
  const [shown, setShown] = useState(false)
  let s = { status: 'unknown', expiresOn: null, daysLeft: null, hoursLeft: null }
  if (insp.unit === 'hours') {
    s = { ...s, ...statusFromHours(value, currentHobbs, WARN_HOURS_DEFAULT) }
  } else if (value && insp.months != null) {
    s = { ...s, ...statusFromExpiry(calendarMonthExpiry(value, insp.months), warnDays) }
  }
  const color = s.status === 'expired' ? 'var(--danger)' : s.status === 'expiring' ? 'var(--warn)' : s.status === 'valid' ? 'var(--ok)' : 'var(--text-tertiary)'

  const isDate = insp.unit === 'date'
  const hasHoursValue = insp.unit === 'hours' && value != null && value !== ''
  const displayDate = isDate && value
    ? new Date(value + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  const openPicker = () => {
    const el = inputRef.current
    if (!el) return
    if (el.showPicker) el.showPicker()
    else el.focus()
  }

  return (
    <div style={{ padding: '10px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{insp.label}</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {insp.far && <FarLink far={insp.far} />}
        </div>
      </div>

      {insp.unit === 'hours' && <CurrentHobbsBoxes value={currentHobbs} />}

      {isDate ? (
        <>
          <div
            onClick={openPicker}
            style={{
              background: 'var(--bg-card)', borderRadius: 12, padding: '13px 16px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              border: '0.5px solid var(--border)', cursor: 'pointer',
            }}
          >
            <span style={{
              fontSize: 17, fontWeight: 400, letterSpacing: '-0.2px',
              color: displayDate ? 'var(--text)' : 'var(--text-tertiary)',
            }}>
              {displayDate || 'Date'}
            </span>
            <img src="/calendario.png" width={18} height={18} alt="" className="icon-themed" />
          </div>
          <input
            ref={inputRef}
            type="date"
            value={value || ''}
            onChange={e => onDateChange(e.target.value)}
            style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
          />
        </>
      ) : shown || hasHoursValue ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 4 }}>
              Due At
            </div>
            <div style={{
              padding: '10px 12px', borderRadius: 10,
              background: 'var(--bg-card)', border: '0.5px solid var(--border)',
            }}>
              <input
                type="number" step="0.1" inputMode="decimal" value={value ?? ''}
                onChange={e => onDateChange(e.target.value)}
                placeholder={currentHobbs != null ? currentHobbs.toFixed(1) : '0.0'}
                autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
                style={{
                  width: '100%', fontSize: 15, fontWeight: 700, color: 'var(--text)',
                  fontVariantNumeric: 'tabular-nums', background: 'transparent',
                  border: 'none', outline: 'none', padding: 0, fontFamily: 'inherit',
                }}
              />
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 4 }}>
              Remaining
            </div>
            <div style={{
              padding: '10px 12px', borderRadius: 10,
              background: 'var(--bg-card)', border: '0.5px solid var(--border)',
            }}>
              <div style={{ fontSize: 15, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
                {s.hoursLeft != null
                  ? `${s.status === 'expired' ? `-${Math.abs(s.hoursLeft).toFixed(1)}` : s.hoursLeft.toFixed(1)} h`
                  : ' '}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <button onClick={() => setShown(true)} style={{
          width: '100%', padding: '11px 0', borderRadius: 10,
          border: '0.5px solid var(--border-strong)', background: 'var(--bg-card)',
          color: 'var(--text)', fontSize: 13, fontWeight: 700,
          cursor: 'pointer', fontFamily: 'inherit',
        }}>+ Set Next Due</button>
      )}

      {insp.unit === 'hours' && currentHobbs == null && (
        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4 }}>
          Set Hobbs Time above to track this
        </div>
      )}
      {insp.hint && <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4 }}>{insp.hint}</div>}
      {s.expiresOn && (
        <div style={{ fontSize: 10, color, marginTop: 4, fontWeight: 600 }}>
          {s.status === 'expired' ? 'Expired' : 'Due'} {fmtDate(s.expiresOn)} · {fmtDaysLeft(s.daysLeft)}
        </div>
      )}
    </div>
  )
}

// Strips units/commas from a spec string like "2,580 lb" down to "2580",
// so it can be shown as a numeric placeholder in the W&B Setup fields.
function weightNum(str) {
  return str ? str.replace(/[^0-9.]/g, '') : ''
}

/* ── Main component ──────────────────────────────────────── */
export default function Aircraft() {
  const [profile, setProfile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [showCustomModal, setShowCustomModal] = useState(false)
  const [customName, setCustomName] = useState('')
  const [hobbsModalOpen, setHobbsModalOpen] = useState(false)
  const [currencyData, setCurrencyData] = useState(null)
  const touchStartX = useRef(null)
  const [showArrows, setShowArrows] = useState(false)
  const arrowTimer = useRef(null)
  const [slideDir, setSlideDir] = useState(0) // -1 = left, 1 = right
  const [slideKey, setSlideKey] = useState(0)

  function showNavHints() { setShowArrows(true) }
  function hideNavHints() { setShowArrows(false) }
  function flashArrows() {
    setShowArrows(true)
    clearTimeout(arrowTimer.current)
    arrowTimer.current = setTimeout(() => setShowArrows(false), 1500)
  }

  useEffect(() => {
    get('aircraft', 'profile').then(saved => {
      if (saved) {
        setProfile(deepMerge(CUSTOM_BLANK, saved))
      } else {
        setProfile({ ...TEMPLATES[1], id: 'profile', registration: '', pilotName: '' })
      }
    })
    get('currency', 'profile').then(saved => setCurrencyData(saved ?? {}))
  }, [])

  // Airworthiness — patches only the `airworthy` key of the shared currency
  // record, leaving `safe`/`current`/`medical` (owned by the Currency page)
  // untouched.
  function patchAirworthyDocs(key, val) {
    setCurrencyData(prev => {
      const base = prev ?? {}
      const airworthy = base.airworthy ?? {}
      const docs = airworthy.docs ?? {}
      const next = { ...base, airworthy: { ...airworthy, docs: { ...docs, [key]: val } } }
      put('currency', { ...next, id: 'profile' })
      return next
    })
  }

  function patchAirworthyInsp(key, val) {
    setCurrencyData(prev => {
      const base = prev ?? {}
      const airworthy = base.airworthy ?? {}
      const next = { ...base, airworthy: { ...airworthy, [key]: val } }
      put('currency', { ...next, id: 'profile' })
      return next
    })
  }

  const save = useCallback(async (updated) => {
    setSaving(true)
    await put('aircraft', { ...updated, id: 'profile' })
    setTimeout(() => setSaving(false), 600)
  }, [])

  function applyTemplate(tpl) {
    const next = { ...CUSTOM_BLANK, ...tpl, id: 'profile', image: tpl.image ?? null, registration: profile?.registration ?? '', pilotName: profile?.pilotName ?? '' }
    setProfile(next)
    save(next)
  }

  function confirmCustom() {
    if (!customName.trim()) return
    const next = { ...CUSTOM_BLANK, fullName: customName.trim(), label: customName.trim(), id: 'profile', registration: profile?.registration ?? '', pilotName: profile?.pilotName ?? '' }
    setProfile(next)
    save(next)
    setShowCustomModal(false)
    setCustomName('')
  }

  function swipeToAdjacent(direction) {
    const allOptions = [...TEMPLATES, { ...CUSTOM_BLANK, id: 'custom' }]
    const currentIdx = allOptions.findIndex(t => t.id === activeTemplateId)
    const nextIdx = currentIdx + direction
    if (nextIdx < 0 || nextIdx >= allOptions.length) return
    const next = allOptions[nextIdx]
    setSlideDir(direction)
    setSlideKey(k => k + 1)
    if (next.id === 'custom') { setCustomName(''); setShowCustomModal(true) }
    else applyTemplate(next)
  }

  function patch(section, key, value) {
    setProfile(prev => {
      const next = section
        ? { ...prev, [section]: { ...prev[section], [key]: value } }
        : { ...prev, [key]: value }
      save(next)
      return next
    })
  }

  function patchHobbs(value) {
    const val = value === '' ? null : parseFloat(value)
    setProfile(prev => {
      const next = { ...prev, hobbsTime: Number.isNaN(val) ? null : val, hobbsUpdatedAt: Date.now() }
      save(next)
      return next
    })
  }

  // ── Weight & Balance setup — belongs to this aircraft's profile, never a
  // generic per-model default. `path` is ['bew','weight'] / ['maxTOW'] / etc. ──
  function patchWB(path, value) {
    setProfile(prev => {
      const wb = { ...(prev.wbConfig ?? {}) }
      if (path.length === 1) wb[path[0]] = value
      else wb[path[0]] = { ...(wb[path[0]] ?? {}), [path[1]]: value }
      const next = { ...prev, wbConfig: wb }
      save(next)
      return next
    })
  }

  function addWBStation(label = '') {
    setProfile(prev => {
      const wb = { ...(prev.wbConfig ?? {}) }
      const stations = [...(wb.stations ?? []), { id: `station-${Date.now()}`, label, sub: '', longArm: '', latArm: '', maxWeight: '' }]
      const next = { ...prev, wbConfig: { ...wb, stations } }
      save(next)
      return next
    })
  }

  function updateWBStation(id, key, value) {
    setProfile(prev => {
      const wb = { ...(prev.wbConfig ?? {}) }
      const stations = (wb.stations ?? []).map(s => s.id === id ? { ...s, [key]: value } : s)
      const next = { ...prev, wbConfig: { ...wb, stations } }
      save(next)
      return next
    })
  }

  function removeWBStation(id) {
    setProfile(prev => {
      const wb = { ...(prev.wbConfig ?? {}) }
      const stations = (wb.stations ?? []).filter(s => s.id !== id)
      const next = { ...prev, wbConfig: { ...wb, stations } }
      save(next)
      return next
    })
  }

  // Generic add/update/remove for the two envelope point lists
  function addWBPoint(listKey, blank) {
    setProfile(prev => {
      const wb = { ...(prev.wbConfig ?? {}) }
      const list = [...(wb[listKey] ?? []), blank]
      const next = { ...prev, wbConfig: { ...wb, [listKey]: list } }
      save(next)
      return next
    })
  }

  function updateWBPoint(listKey, idx, key, value) {
    setProfile(prev => {
      const wb = { ...(prev.wbConfig ?? {}) }
      const list = (wb[listKey] ?? []).map((p, i) => i === idx ? { ...p, [key]: value } : p)
      const next = { ...prev, wbConfig: { ...wb, [listKey]: list } }
      save(next)
      return next
    })
  }

  function removeWBPoint(listKey, idx) {
    setProfile(prev => {
      const wb = { ...(prev.wbConfig ?? {}) }
      const list = (wb[listKey] ?? []).filter((_, i) => i !== idx)
      const next = { ...prev, wbConfig: { ...wb, [listKey]: list } }
      save(next)
      return next
    })
  }

  if (!profile) return null

  const activeTemplate = TEMPLATES.find(t => t.fullName === profile.fullName)
  const activeTemplateId = activeTemplate?.id ?? (profile.category === 'custom' ? 'custom' : null)
  const heroImage = profile.image ?? activeTemplate?.image ?? null
  const reg = profile.registration?.trim()
  const displayName = profile.fullName || profile.label || '—'
  const isHelicopter = profile.category === 'helicopter'
  const wbNormalized = normalizeUserWBConfig(profile.wbConfig, profile)
  const wbConfigured = validateWBConfig(wbNormalized)
  const wbStations = profile.wbConfig?.stations ?? []
  const wbLongPoints = profile.wbConfig?.longEnvelopePoints ?? []
  const wbLatPoints  = profile.wbConfig?.latEnvelopePoints ?? []
  const wbStationSuggestions = isHelicopter
    ? ['Pilot', 'Front Pax', 'Rear Pax', 'Baggage']
    : ['Pilot & Front Pax', 'Rear Pax', 'Baggage']

  // Airworthiness — worst status across docs + inspections
  const airworthy = currencyData?.airworthy ?? {}
  const airworthyDocs = airworthy.docs ?? {}
  const docsComplete = ARROW_DOCS.filter(d => !d.key.includes('insurance')).every(d => airworthyDocs[d.key])
  const inspStatuses = INSPECTIONS
    .map(i => {
      if (i.unit === 'hours') return statusFromHours(airworthy[i.key], profile.hobbsTime, WARN_HOURS_DEFAULT)
      if (i.months != null && airworthy[i.key]) return statusFromExpiry(calendarMonthExpiry(airworthy[i.key], i.months), WARN_DAYS_DEFAULT)
      return null
    })
    .filter(s => s && s.status !== 'unknown')
  const worstInsp = inspStatuses.reduce((worst, s) => {
    const rank = { expired: 3, expiring: 2, unknown: 1, valid: 0 }
    return (rank[s.status] ?? 0) > (rank[worst.status] ?? 0) ? s : worst
  }, { status: inspStatuses.length === 0 ? 'incomplete' : 'valid' })
  const airworthyStatus = !docsComplete ? 'incomplete'
    : worstInsp.status === 'expired' ? 'expired'
    : worstInsp.status === 'expiring' ? 'expiring'
    : worstInsp.status === 'incomplete' ? 'incomplete'
    : 'valid'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>

      {/* ── Header ── */}
      <div style={{ padding: '20px 18px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <BackButton />
          <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.5px', color: 'var(--text)', lineHeight: 1 }}>
            Aircraft
          </span>
          {saving && (
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 'auto', letterSpacing: '0.2px' }}>Saving…</span>
          )}
        </div>

        {/* Aircraft hero */}
        <div style={{ position: 'relative' }}>

          {/* Hover/swipe zone — wraps dots + image */}
          <div
            onMouseEnter={showNavHints}
            onMouseLeave={hideNavHints}
            onTouchStart={e => { touchStartX.current = e.touches[0].clientX; flashArrows() }}
            onTouchEnd={e => {
              if (touchStartX.current === null) return
              const dx = e.changedTouches[0].clientX - touchStartX.current
              touchStartX.current = null
              if (Math.abs(dx) < 40) return
              swipeToAdjacent(dx < 0 ? 1 : -1)
            }}
          >
          {/* Swipe dots */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 5, marginBottom: 8,
            opacity: showArrows ? 1 : 0, transition: 'opacity 0.3s ease' }}>
            {TEMPLATES.map(tpl => (
              <div key={tpl.id} onClick={() => applyTemplate(tpl)} style={{
                width: activeTemplateId === tpl.id ? 16 : 5,
                height: 5, borderRadius: 3,
                background: activeTemplateId === tpl.id ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.15)',
                transition: 'width 0.2s, background 0.2s',
                cursor: 'pointer',
              }} />
            ))}
          </div>

          {/* Aircraft image */}
          <div style={{ position: 'relative', width: '100%', height: 280, marginBottom: -20, overflow: 'hidden' }}>
            {heroImage ? (
              <img
                key={slideKey}
                src={heroImage}
                alt=""
                style={{
                  width: '100%', height: '100%',
                  objectFit: 'contain',
                  objectPosition: 'center bottom',
                  display: 'block',
                  animation: slideKey > 0 ? `slide-in-${slideDir > 0 ? 'right' : 'left'} 0.35s cubic-bezier(0.25,0.46,0.45,0.94) both` : 'none',
                }}
              />
            ) : (
              <div style={{
                width: '100%', height: '100%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--text)',
              }}>
                <AircraftPlaceholder />
              </div>
            )}
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0, height: '40%',
              background: 'linear-gradient(to bottom, transparent 0%, var(--bg) 100%)',
              pointerEvents: 'none',
            }} />
            {/* Swipe arrows */}
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0 6px',
              opacity: showArrows ? 1 : 0,
              transition: 'opacity 0.6s ease',
              pointerEvents: showArrows ? 'auto' : 'none',
            }}>
              {[['M15 18l-6-6 6-6', -1], ['M9 18l6-6-6-6', 1]].map(([d, dir]) => (
                <button key={dir} onClick={() => swipeToAdjacent(dir)} style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: 'rgba(255,255,255,0.12)',
                  backdropFilter: 'blur(6px)',
                  border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                    stroke="rgba(255,255,255,0.85)" strokeWidth="2.5"
                    strokeLinecap="round" strokeLinejoin="round">
                    <path d={d} />
                  </svg>
                </button>
              ))}
            </div>
          </div>
          </div>{/* end hover/swipe zone */}

          {/* Generate icon button — only when no built-in template image exists */}
          {!activeTemplate?.image && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10, marginBottom: 4 }}>
              <GenerateIconButton
                aircraftName={profile.fullName || profile.label || ''}
                onGenerated={dataUrl => {
                  patch(null, 'image', dataUrl)
                }}
              />
            </div>
          )}

          {/* Name + reg — centered */}
          <div key={slideKey} style={{ position: 'relative', zIndex: 1, textAlign: 'center', marginBottom: 14, animation: slideKey > 0 ? `slide-in-${slideDir > 0 ? 'right' : 'left'} 0.35s cubic-bezier(0.25,0.46,0.45,0.94) both` : 'none' }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.5px', lineHeight: 1.1 }}>
              {displayName}
            </div>
            {reg && (
              <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'monospace', color: 'var(--text-secondary)', letterSpacing: '1.5px', marginTop: 4 }}>
                {reg}
              </div>
            )}
          </div>

          {/* Stats badges */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginBottom: 20 }}>
            {profile.vspeeds?.cruise && <HeroBadge label="TAS" value={`${profile.vspeeds.cruise} kt`} />}
            {profile.burnRate?.cruise && <HeroBadge label="Burn" value={profile.burnRate.cruise} />}
            {profile.fuel?.usable && <HeroBadge label="Fuel" value={profile.fuel.usable} />}
            {profile.weights?.mtow && <HeroBadge label="MTOW" value={profile.weights.mtow} />}
          </div>
        </div>
      </div>


      {/* ── Editable fields ── */}
      <div style={{ padding: '0 16px 40px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Maintenance / Hobbs Time */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button style={{
            flex: 1, padding: '9px 12px', borderRadius: 10,
            background: 'var(--bg-card)', border: '0.5px solid var(--border)',
            boxShadow: 'var(--shadow-sm)', cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 14, fontWeight: 700, color: 'var(--text)',
          }}>
            Maintenance
          </button>
          <button onClick={() => setHobbsModalOpen(true)} style={{
            flex: 1, padding: '9px 12px', borderRadius: 10,
            background: 'var(--bg-card)', border: '0.5px solid var(--border)',
            boxShadow: 'var(--shadow-sm)', cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 14, fontWeight: 700, color: 'var(--text)',
          }}>
            Hobbs Time
          </button>
        </div>

        {/* Identity */}
        <Section title="Identity">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Pilot name" value={profile.pilotName ?? ''}
              onChange={v => patch(null, 'pilotName', v)} placeholder="e.g. Diego" colSpan />
            <Field label="Registration" value={profile.registration ?? ''}
              onChange={v => patch(null, 'registration', v.toUpperCase())} placeholder="e.g. N4723A" />
            <Field label="Aircraft type" value={profile.fullName ?? ''}
              onChange={v => patch(null, 'fullName', v)} placeholder="e.g. Cessna 172S" />
            <Field label="Color" value={profile.color ?? ''}
              onChange={v => patch(null, 'color', v)} placeholder="e.g. White/Blue" />
          </div>
        </Section>

        {/* Airworthiness */}
        <Section title="Airworthiness">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: -6 }}>
            <AirworthinessBadge status={airworthyStatus} />
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
              Documents: CARROW
            </div>
            <div style={{ background: 'var(--bg-card-2)', borderRadius: 10, overflow: 'hidden' }}>
              {ARROW_DOCS.map(doc => (
                <CheckRowSimple key={doc.key} checked={!!airworthyDocs[doc.key]}
                  onChange={v => patchAirworthyDocs(doc.key, v)} label={doc.label} far={doc.far} />
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 2 }}>
              Inspections
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8 }}>
              Enter the date the inspection was last completed.
            </div>
            <div style={{ background: 'var(--bg-card-2)', borderRadius: 10, padding: '0 12px 4px' }}>
              {INSPECTIONS.map(insp => (
                <InspectionRow key={insp.key} insp={insp} value={airworthy[insp.key]}
                  onDateChange={v => patchAirworthyInsp(insp.key, v)}
                  warnDays={WARN_DAYS_DEFAULT} currentHobbs={profile.hobbsTime} />
              ))}
              <div style={{ paddingBottom: 6 }}>
                <CheckRowSimple checked={!!airworthyDocs.ads} onChange={v => patchAirworthyDocs('ads', v)}
                  label="Airworthiness Directives" far={FAR.ads} padding="10px 0" />
              </div>
            </div>
          </div>
        </Section>

        {/* Weight & Balance Setup */}
        <Section title="Weight & Balance Setup">
          {({ close }) => (<>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: -6 }}>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 20,
              background: wbConfigured ? 'var(--ok-light)' : 'var(--bg-card-2)',
              color: wbConfigured ? 'var(--ok)' : 'var(--text-tertiary)',
              border: wbConfigured ? 'none' : '0.5px solid var(--border)',
            }}>
              {wbConfigured ? 'Configured' : 'Setup incomplete'}
            </span>
          </div>

          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5, marginTop: -4 }}>
            Use <em>this aircraft's</em> actual POH and AFM values, not generic model numbers.
          </div>

          {!wbConfigured && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', background: 'var(--bg-card-2)', borderRadius: 10, padding: '9px 11px', lineHeight: 1.5 }}>
              Not configured yet — the Weight & Balance checklist item won't compute results until you fill in
              this aircraft's actual numbers below.
            </div>
          )}

          {/* Basic Empty Weight + Max Weight */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Basic Empty Weight (lb)" type="number" value={profile.wbConfig?.bew?.weight ?? ''}
              onChange={v => patchWB(['bew', 'weight'], v)} placeholder={weightNum(profile.weights?.bew) || '1663'} />
            <Field label="Empty CG and Long Arm (in)" type="number" value={profile.wbConfig?.bew?.longArm ?? ''}
              onChange={v => patchWB(['bew', 'longArm'], v)} placeholder="39.3" />
            <Field label="Empty Lateral Arm (in), optional" type="number" value={profile.wbConfig?.bew?.latArm ?? ''}
              onChange={v => patchWB(['bew', 'latArm'], v)} placeholder="0.0" />
            <Field label="Max Takeoff and Gross Weight (lb)" type="number" value={profile.wbConfig?.maxTOW ?? ''}
              onChange={v => patchWB(['maxTOW'], v)} placeholder={weightNum(profile.weights?.mtow) || '2550'} />
          </div>

          {/* Fuel */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>Fuel</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <Field label="Fuel Capacity (gal)" type="number" value={profile.wbConfig?.fuel?.maxGal ?? ''}
                onChange={v => patchWB(['fuel', 'maxGal'], v)} placeholder="53" />
              <Field label="Fuel Arm (in)" type="number" value={profile.wbConfig?.fuel?.longArm ?? ''}
                onChange={v => patchWB(['fuel', 'longArm'], v)} placeholder="48.0" />
            </div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 500 }}>
              Fuel Density (lb per gal)
            </label>
            <div style={{ position: 'relative' }}>
              <input type="number" step="0.1" inputMode="decimal"
                value={profile.wbConfig?.fuel?.lbPerGal ?? ''}
                onChange={e => patchWB(['fuel', 'lbPerGal'], e.target.value)}
                placeholder="6.0"
                style={{
                  width: '100%', padding: '10px 128px 10px 12px', borderRadius: 'var(--r-sm)',
                  border: '0.5px solid var(--border)', background: 'var(--bg-card-2)',
                  color: 'var(--text)', fontSize: 15, outline: 'none', boxSizing: 'border-box',
                  fontVariantNumeric: 'tabular-nums',
                }}
              />
              <div style={{
                position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                display: 'flex', gap: 4,
              }}>
                <FuelDensityTag label="Avgas" active={profile.wbConfig?.fuel?.lbPerGal === '6.0'}
                  onClick={() => patchWB(['fuel', 'lbPerGal'], '6.0')} />
                <FuelDensityTag label="Jet A" active={profile.wbConfig?.fuel?.lbPerGal === '6.7'}
                  onClick={() => patchWB(['fuel', 'lbPerGal'], '6.7')} />
              </div>
            </div>
          </div>

          {/* Loading stations */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
              Loading Stations
            </div>
            {wbStations.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 8 }}>
                Add one for each seat or compartment.
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
              {wbStations.map(s => (
                <WBStationRow key={s.id} station={s}
                  onChange={(key, v) => updateWBStation(s.id, key, v)}
                  onRemove={() => removeWBStation(s.id)} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {wbStationSuggestions.map(label => (
                <Chip key={label} label={`+ ${label}`} onClick={() => addWBStation(label)} />
              ))}
              <Chip label="+ Add Station" onClick={() => addWBStation('')} accent />
            </div>
          </div>

          {/* Longitudinal envelope */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 2 }}>
              Longitudinal CG Envelope
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8 }}>
              From the POH CG envelope chart, at least 3 points.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
              {wbLongPoints.map((p, i) => (
                <WBPointRow key={i} point={p} fieldA="cg" fieldB="weight" labelA="CG (in)" labelB="Weight (lb)"
                  onChange={(key, v) => updateWBPoint('longEnvelopePoints', i, key, v)}
                  onRemove={() => removeWBPoint('longEnvelopePoints', i)} />
              ))}
            </div>
            <Chip label="+ Add Point" onClick={() => addWBPoint('longEnvelopePoints', { cg: '', weight: '' })} accent />
          </div>

          {/* Lateral envelope — optional */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 2 }}>
              Lateral CG Limits (optional, mainly helicopters)
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8 }}>
              Leave empty if this aircraft doesn't track lateral CG.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
              {wbLatPoints.map((p, i) => (
                <WBPointRow key={i} point={p} fieldA="lat" fieldB="longCG" labelA="Lat CG (in)" labelB="Long CG (in)"
                  onChange={(key, v) => updateWBPoint('latEnvelopePoints', i, key, v)}
                  onRemove={() => removeWBPoint('latEnvelopePoints', i)} />
              ))}
            </div>
            <Chip label="+ Add Point" onClick={() => addWBPoint('latEnvelopePoints', { lat: '', longCG: '' })} accent />
          </div>

          {/* Source */}
          <Field label="Source and W&B Report Date" value={profile.wbConfig?.source ?? ''}
            onChange={v => patchWB(['source'], v)} placeholder="POH Rev 3, dated May 1 2024" />

          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', lineHeight: 1.6, textAlign: 'center', paddingTop: 4 }}>
            For planning purposes only. PIC is responsible for verifying W&amp;B against the aircraft's POH, AFM,
            and latest W&amp;B report. Use actual aircraft values, not generic model values.
          </div>

          <button onClick={close} style={{
            width: '100%', padding: '13px 0', borderRadius: 'var(--r-sm)', border: 'none',
            background: 'var(--accent)', color: 'var(--accent-fg)',
            fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            Done
          </button>
          </>)}
        </Section>

        {/* V-Speeds */}
        {isHelicopter ? (
          <Section title="Speeds (knots)">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <VSpeed label="Vne  Never exceed" value={profile.vspeeds?.vne ?? ''} onChange={v => patch('vspeeds', 'vne', v)} />
              <VSpeed label="Vy   Best climb" value={profile.vspeeds?.vy ?? ''} onChange={v => patch('vspeeds', 'vy', v)} />
              <VSpeed label="Vx   Best angle" value={profile.vspeeds?.vx ?? ''} onChange={v => patch('vspeeds', 'vx', v)} />
              <VSpeed label="Autorotation" value={profile.vspeeds?.auto ?? ''} onChange={v => patch('vspeeds', 'auto', v)} />
              <VSpeed label="Cruise TAS" value={profile.vspeeds?.cruise ?? ''} onChange={v => patch('vspeeds', 'cruise', v)} />
            </div>
          </Section>
        ) : (
          <Section title="V-Speeds (knots)">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <VSpeed label="Vs  Stall clean" value={profile.vspeeds?.vs ?? ''} onChange={v => patch('vspeeds', 'vs', v)} />
              <VSpeed label="Vso Stall flaps" value={profile.vspeeds?.vs0 ?? ''} onChange={v => patch('vspeeds', 'vs0', v)} />
              <VSpeed label="Vx  Best angle" value={profile.vspeeds?.vx ?? ''} onChange={v => patch('vspeeds', 'vx', v)} />
              <VSpeed label="Vy  Best rate" value={profile.vspeeds?.vy ?? ''} onChange={v => patch('vspeeds', 'vy', v)} />
              <VSpeed label="Vg  Best glide" value={profile.vspeeds?.vg ?? ''} onChange={v => patch('vspeeds', 'vg', v)} />
              <VSpeed label="Va  Manoeuvring" value={profile.vspeeds?.va ?? ''} onChange={v => patch('vspeeds', 'va', v)} />
              <VSpeed label="Vfe Flap extend" value={profile.vspeeds?.vfe ?? ''} onChange={v => patch('vspeeds', 'vfe', v)} />
              <VSpeed label="Vno Max struct." value={profile.vspeeds?.vno ?? ''} onChange={v => patch('vspeeds', 'vno', v)} />
              <VSpeed label="Vne Never exceed" value={profile.vspeeds?.vne ?? ''} onChange={v => patch('vspeeds', 'vne', v)} />
              <VSpeed label="Vref Approach" value={profile.vspeeds?.vref ?? ''} onChange={v => patch('vspeeds', 'vref', v)} />
              <VSpeed label="Cruise TAS" value={profile.vspeeds?.cruise ?? ''} onChange={v => patch('vspeeds', 'cruise', v)} />
            </div>
          </Section>
        )}

        {/* Performance */}
        {isHelicopter ? (
          <Section title="Performance">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Rate of climb" value={profile.perf?.roc ?? ''}
                onChange={v => patch('perf', 'roc', v)} placeholder="e.g. 1,080 fpm" />
              <Field label="Service ceiling" value={profile.perf?.ceiling ?? ''}
                onChange={v => patch('perf', 'ceiling', v)} placeholder="e.g. 14,000 ft DA" />
              <Field label="Hover IGE (DA)" value={profile.perf?.hoverIGE ?? ''}
                onChange={v => patch('perf', 'hoverIGE', v)} placeholder="e.g. 9,000 ft DA" />
              <Field label="Hover OGE (DA)" value={profile.perf?.hoverOGE ?? ''}
                onChange={v => patch('perf', 'hoverOGE', v)} placeholder="e.g. 6,800 ft DA" />
            </div>
          </Section>
        ) : (
          <Section title="Performance (sea level / std day)">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="T/O ground roll" value={profile.perf?.toRoll ?? ''}
                onChange={v => patch('perf', 'toRoll', v)} placeholder="e.g. 960 ft" />
              <Field label="T/O over 50 ft" value={profile.perf?.to50ft ?? ''}
                onChange={v => patch('perf', 'to50ft', v)} placeholder="e.g. 1,630 ft" />
              <Field label="Ldg ground roll" value={profile.perf?.ldgRoll ?? ''}
                onChange={v => patch('perf', 'ldgRoll', v)} placeholder="e.g. 575 ft" />
              <Field label="Ldg over 50 ft" value={profile.perf?.ldg50ft ?? ''}
                onChange={v => patch('perf', 'ldg50ft', v)} placeholder="e.g. 1,335 ft" />
            </div>
          </Section>
        )}

        {/* Fuel */}
        <Section title="Fuel">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Total" value={profile.fuel?.total ?? ''}
              onChange={v => patch('fuel', 'total', v)} placeholder="e.g. 56 USG" />
            <Field label="Usable" value={profile.fuel?.usable ?? ''}
              onChange={v => patch('fuel', 'usable', v)} placeholder="e.g. 53 USG" />
            <Field label="Type" value={profile.fuel?.type ?? ''}
              onChange={v => patch('fuel', 'type', v)} placeholder="100LL / Jet-A" />
            <Field label="Climb burn" value={profile.burnRate?.climb ?? ''}
              onChange={v => patch('burnRate', 'climb', v)} placeholder="e.g. 10 GPH" />
            <Field label="Cruise burn" value={profile.burnRate?.cruise ?? ''}
              onChange={v => patch('burnRate', 'cruise', v)} placeholder="e.g. 8.5 GPH" />
          </div>
        </Section>

        {/* Notes */}
        <Section title="Notes">
          <textarea
            value={profile.notes ?? ''}
            onChange={e => patch(null, 'notes', e.target.value)}
            placeholder="Any additional notes about this aircraft…"
            rows={3}
            style={{
              width: '100%', resize: 'none',
              padding: '11px 13px', borderRadius: 'var(--r-sm)',
              border: '0.5px solid var(--border)',
              background: 'var(--bg-card-2)',
              color: 'var(--text)', fontSize: 15,
              fontFamily: 'inherit', lineHeight: 1.5,
              outline: 'none',
            }}
            onFocus={e => e.target.style.borderColor = 'var(--accent)'}
            onBlur={e => e.target.style.borderColor = 'var(--border)'}
          />
        </Section>

      </div>

      {/* Custom aircraft modal */}
      {showCustomModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 500,
          background: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 24px',
        }} onClick={() => setShowCustomModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            width: '100%', maxWidth: 360,
            background: 'var(--bg-card)',
            borderRadius: 20, padding: '24px 20px 20px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}>
            <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', marginBottom: 4, textAlign: 'center' }}>
              Custom Aircraft
            </h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 18, textAlign: 'center' }}>
              Enter the type or registration to start a blank profile.
            </p>
            <input
              autoFocus
              type="text"
              placeholder="e.g. Piper PA-44 Seminole"
              value={customName}
              onChange={e => setCustomName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && confirmCustom()}
              style={{
                width: '100%', padding: '12px 14px', borderRadius: 'var(--r-md)',
                border: '1px solid var(--accent)', background: 'var(--bg-card-2)',
                color: 'var(--text)', fontSize: 15, outline: 'none', marginBottom: 12, fontFamily: 'inherit',
              }}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowCustomModal(false)} style={{
                flex: 1, padding: '12px', borderRadius: 'var(--r-md)',
                border: '0.5px solid var(--border)', background: 'var(--bg-card-2)',
                color: 'var(--text-secondary)', fontSize: 15, fontWeight: 500, cursor: 'pointer',
              }}>Cancel</button>
              <button onClick={confirmCustom} disabled={!customName.trim()} style={{
                flex: 1, padding: '12px', borderRadius: 'var(--r-md)', border: 'none',
                background: customName.trim() ? 'var(--accent)' : 'var(--bg-card-2)',
                color: customName.trim() ? 'var(--accent-fg)' : 'var(--text-tertiary)',
                fontSize: 15, fontWeight: 700, cursor: customName.trim() ? 'pointer' : 'default',
              }}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Hobbs time modal */}
      {hobbsModalOpen && (
        <HobbsTimeModal
          initialValue={profile.hobbsTime}
          onCancel={() => setHobbsModalOpen(false)}
          onConfirm={value => { patchHobbs(value); setHobbsModalOpen(false) }}
        />
      )}

    </div>
  )
}

/* ── Sub-components ──────────────────────────────────────── */
function HeroBadge({ label, value }) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      borderRadius: 8, padding: '5px 6px',
      boxShadow: 'var(--shadow-sm)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
      whiteSpace: 'nowrap', overflow: 'hidden',
    }}>
      <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace' }}>{value}</span>
    </div>
  )
}

function Section({ title, children }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '0.5px solid var(--border)',
      borderRadius: 'var(--r-lg)',
      boxShadow: 'var(--shadow-sm)',
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', background: 'none', border: 'none',
          cursor: 'pointer', padding: '15px 16px', textAlign: 'left',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.2px', color: 'var(--text)' }}>
          {title}
        </span>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" style={{
          flexShrink: 0, color: 'var(--text-tertiary)',
          transition: 'transform 0.2s ease',
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        }}>
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div style={{
          padding: '2px 16px 16px',
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          {typeof children === 'function' ? children({ close: () => setOpen(false) }) : children}
        </div>
      )}
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      <label style={{
        display: 'flex', alignItems: 'flex-end', minHeight: 30, lineHeight: 1.35,
        fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 500,
      }}>
        {label}
      </label>
      <input
        type={type}
        inputMode={type === 'number' ? 'decimal' : undefined}
        step={type === 'number' ? '0.1' : undefined}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%', padding: '10px 12px', borderRadius: 'var(--r-sm)',
          border: '0.5px solid var(--border)', background: 'var(--bg-card-2)',
          color: 'var(--text)', fontSize: 15, outline: 'none',
          fontVariantNumeric: 'tabular-nums',
        }}
        onFocus={e => e.target.style.borderColor = 'var(--accent)'}
        onBlur={e => e.target.style.borderColor = 'var(--border)'}
      />
    </div>
  )
}

function VSpeed({ label, value, onChange }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 500 }}>
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          type="number"
          inputMode="numeric"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="—"
          style={{
            width: '100%', padding: '10px 36px 10px 12px', borderRadius: 'var(--r-sm)',
            border: '0.5px solid var(--border)', background: 'var(--bg-card-2)',
            color: 'var(--text)', fontSize: 15, outline: 'none',
            fontVariantNumeric: 'tabular-nums',
          }}
          onFocus={e => e.target.style.borderColor = 'var(--accent)'}
          onBlur={e => e.target.style.borderColor = 'var(--border)'}
        />
        <span style={{
          position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
          fontSize: 11, color: 'var(--text-tertiary)', pointerEvents: 'none',
        }}>kt</span>
      </div>
    </div>
  )
}

/* ── Weight & Balance setup helpers ──────────────────────── */
function Chip({ label, onClick, accent }) {
  return (
    <button onClick={onClick} style={{
      padding: '9px 12px', borderRadius: 9, cursor: 'pointer', whiteSpace: 'nowrap',
      fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
      border: accent ? 'none' : '0.5px solid var(--border)',
      background: accent ? 'var(--accent)' : 'var(--bg-card-2)',
      color: accent ? 'var(--accent-fg)' : 'var(--text-secondary)',
    }}>
      {label}
    </button>
  )
}

function FuelDensityTag({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '5px 9px', borderRadius: 7, cursor: 'pointer', whiteSpace: 'nowrap',
      fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
      border: active ? 'none' : '0.5px solid var(--border-strong)',
      background: active ? 'var(--accent)' : 'var(--bg-card)',
      color: active ? 'var(--accent-fg)' : 'var(--text-secondary)',
    }}>
      {label}
    </button>
  )
}

function MiniInput({ value, onChange, placeholder }) {
  return (
    <input
      type="number" inputMode="decimal" value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: '100%', padding: '8px 10px', borderRadius: 8,
        border: '0.5px solid var(--border)', background: 'var(--bg-card)',
        color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
        fontVariantNumeric: 'tabular-nums',
      }}
    />
  )
}

function RemoveButton({ onClick }) {
  return (
    <button onClick={onClick} style={{
      width: 26, height: 26, borderRadius: 7, flexShrink: 0,
      border: 'none', background: 'transparent', cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--text-tertiary)',
    }}>
      <svg width={13} height={13} viewBox="0 0 24 24" fill="none">
        <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    </button>
  )
}

function WBStationRow({ station, onChange, onRemove }) {
  return (
    <div style={{ background: 'var(--bg-card-2)', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          value={station.label} onChange={e => onChange('label', e.target.value)}
          placeholder="Label (Pilot)"
          style={{
            flex: 1, padding: '8px 10px', borderRadius: 8, border: '0.5px solid var(--border)',
            background: 'var(--bg-card)', color: 'var(--text)', fontSize: 13, outline: 'none',
            fontFamily: 'inherit', boxSizing: 'border-box',
          }}
        />
        <RemoveButton onClick={onRemove} />
      </div>
      <input
        value={station.sub} onChange={e => onChange('sub', e.target.value)}
        placeholder="Description (Front Right, optional)"
        style={{
          padding: '8px 10px', borderRadius: 8, border: '0.5px solid var(--border)',
          background: 'var(--bg-card)', color: 'var(--text)', fontSize: 12, outline: 'none',
          fontFamily: 'inherit', boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
        <div>
          <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginBottom: 3 }}>Long Arm (in)</div>
          <MiniInput value={station.longArm} onChange={v => onChange('longArm', v)} placeholder="37.0" />
        </div>
        <div>
          <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginBottom: 3 }}>Lat Arm (in)</div>
          <MiniInput value={station.latArm} onChange={v => onChange('latArm', v)} placeholder="optional" />
        </div>
        <div>
          <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginBottom: 3 }}>Max Wt (lb)</div>
          <MiniInput value={station.maxWeight} onChange={v => onChange('maxWeight', v)} placeholder="optional" />
        </div>
      </div>
    </div>
  )
}

function WBPointRow({ point, fieldA, fieldB, labelA, labelB, onChange, onRemove }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginBottom: 3 }}>{labelA}</div>
        <MiniInput value={point[fieldA]} onChange={v => onChange(fieldA, v)} placeholder="0.0" />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginBottom: 3 }}>{labelB}</div>
        <MiniInput value={point[fieldB]} onChange={v => onChange(fieldB, v)} placeholder="0" />
      </div>
      <div style={{ paddingTop: 14 }}>
        <RemoveButton onClick={onRemove} />
      </div>
    </div>
  )
}
