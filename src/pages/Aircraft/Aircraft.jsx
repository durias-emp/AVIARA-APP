import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { get, put } from '../../lib/db'
import { useLogbook } from '../../context/Logbook'
import { BackButton } from '../../components/Shell'
import { generateAircraftIcon, generateIconFromPhoto } from '../../lib/generateIcon'
import { extractPohChart } from '../../lib/extractPohChart'
import { FAR, calendarMonthExpiry, statusFromExpiry, statusFromHours, fmtDate, fmtDaysLeft } from '../../lib/currency'
import { SegControl } from '../../components/SegControl'
import ConfirmModal from '../../components/ConfirmModal'
import { deleteAircraft } from '../../lib/aircraft'
import { buildAircraftExport, exportFileName } from '../../lib/aircraftShare'
import { CHART_TYPES, createEmptyChart, normalizeUserPerfChart, validatePerfChart, pickRandomVerificationCells, getPerfChart, interpolateChart } from '../../lib/aircraftPerf'
import WBSetupSection from './WBSetupSection'
import PerfChartEditor from './PerfChartEditor'

export const FILING_CATEGORIES = ['Airplane', 'Rotorcraft', 'Other']

export function AircraftPlaceholder() {
  return (
    // A side profile rather than a plan view. Seen from above, a light single
    // is a cross — a fat body with four stubs — which reads as a quadcopter
    // long before it reads as an aeroplane. From the side the parts that say
    // "aircraft" are all visible at once: the nose, the prop, the tail fin,
    // the gear.
    <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg"
      style={{ width: '100%', height: '100%', opacity: 0.18 }}>
      <g fill="currentColor">
        {/* Fuselage, nose to the left, tapering into the tailcone */}
        <path d="M42 106
                 Q42 94 62 90
                 L118 87
                 Q148 89 172 100
                 Q176 103 172 106
                 L118 116
                 Q68 120 52 117
                 Q42 114 42 106 Z" />
        {/* Cabin glazing, sunk into the top line so it reads as windows */}
        <path d="M66 91 L96 88 L112 88 L110 96 L68 98 Z" opacity="0.4" />
        {/* High wing, sitting on the cabin roof, with its lift strut */}
        <rect x="58" y="76" width="84" height="7" rx="3.5" />
        <path d="M70 83 L88 112 L93 112 L75 83 Z" />
        {/* Swept fin off the tailcone */}
        <path d="M143 92 L166 50 L174 50 L176 98 Z" />
        {/* Tailplane */}
        <rect x="152" y="93" width="40" height="6" rx="3" />
        {/* Propeller disc, touching the nose */}
        <ellipse cx="39" cy="104" rx="3.5" ry="31" />
        {/* Tricycle gear */}
        <rect x="56" y="116" width="4.5" height="14" rx="2.2" />
        <circle cx="58" cy="135" r="6.5" />
        <rect x="96" y="115" width="5" height="17" rx="2.5" />
        <circle cx="98" cy="138" r="7.5" />
      </g>
    </svg>
  )
}

/* A phone camera writes 4000px JPEGs. That is far more than either a 280px
   hero or a vision model needs, and the profile is stored in IndexedDB as a
   base64 string, so shipping the original would bloat every read of the
   record. Longest edge 1400px keeps a tail number readable and cuts the
   payload by roughly an order of magnitude. */
function fileToScaledDataUrl(file, maxEdge = 1400) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read that file'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('That file is not an image'))
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        canvas.getContext('2d').drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

/* ── Where the aircraft's picture comes from. Three ways in: the photo
   itself, a cartoon drawn from the photo, or a cartoon drawn from the
   model name alone for a pilot who hasn't got a photo to hand. ── */
function AircraftImageControls({ aircraftName, registration, hasImage, onImage, onClear }) {
  const [mode, setMode] = useState(null)        // null | 'photo' | 'cartoon' | 'name'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [name, setName] = useState(aircraftName ?? '')
  const [note, setNote] = useState(null)
  const fileRef = useRef(null)
  const pending = useRef(null)                   // 'photo' | 'cartoon'

  useEffect(() => { setName(aircraftName ?? '') }, [aircraftName])

  function pick(kind) {
    pending.current = kind
    setError(null)
    fileRef.current?.click()
  }

  async function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''                          // so the same file can be re-picked
    if (!file) return
    const kind = pending.current
    pending.current = null
    // No pending choice means this change event did not come from one of the
    // two buttons. Falling through would silently pick the paid path.
    if (kind !== 'photo' && kind !== 'cartoon') return
    setBusy(true); setError(null); setNote(null); setMode(kind)
    try {
      const dataUrl = await fileToScaledDataUrl(file)
      if (kind === 'photo') {
        onImage(dataUrl)
        setMode(null)
      } else {
        const { image, description } = await generateIconFromPhoto({
          imageDataUrl: dataUrl,
          registration,
          hint: aircraftName,
        })
        onImage(image)
        setNote(description ?? null)
        setMode(null)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function fromName() {
    if (!name.trim()) return
    setBusy(true); setError(null)
    try {
      onImage(await generateAircraftIcon(name.trim()))
      setMode(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const chip = {
    display: 'flex', alignItems: 'center', gap: 6,
    background: 'rgba(255,255,255,0.07)', border: '0.5px solid rgba(255,255,255,0.15)',
    borderRadius: 10, padding: '7px 13px', cursor: busy ? 'default' : 'pointer',
    color: 'var(--text-secondary)', fontSize: 12.5, fontWeight: 500,
    fontFamily: 'inherit', opacity: busy ? 0.5 : 1,
  }

  if (busy) {
    return (
      <div style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--text-tertiary)', padding: '8px 0' }}>
        {mode === 'cartoon' ? 'Reading the photo and drawing it… about 30 seconds'
          : mode === 'name' ? 'Drawing… about 15 seconds'
          : 'Loading the photo…'}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{ display: 'none' }} />

      {mode === 'name' ? (
        <div style={{
          background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 14,
          padding: 14, display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 340,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Draw from the model name</div>
          <input
            autoFocus value={name} maxLength={80}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && fromName()}
            placeholder="e.g. Cessna 172S"
            style={{
              padding: '9px 12px', borderRadius: 9, border: '0.5px solid var(--border-strong)',
              background: 'var(--bg-card-2)', color: 'var(--text)', fontSize: 14,
              outline: 'none', fontFamily: 'inherit',
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={fromName} disabled={!name.trim()} style={{
              flex: 1, padding: '9px 0', borderRadius: 9, border: 'none',
              background: 'var(--accent)', color: 'var(--accent-fg)', fontFamily: 'inherit',
              fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: name.trim() ? 1 : 0.5,
            }}>Draw it</button>
            <button onClick={() => { setMode(null); setError(null) }} style={{
              padding: '9px 14px', borderRadius: 9, border: 'none', fontFamily: 'inherit',
              background: 'var(--bg-card-2)', color: 'var(--text-secondary)', fontSize: 14, cursor: 'pointer',
            }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button style={chip} onClick={() => pick('photo')}>
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9a2 2 0 0 1 2-2h1.5l1-2h7l1 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
              <circle cx="12" cy="13" r="3.2" />
            </svg>
            Use a photo
          </button>
          <button style={chip} onClick={() => pick('cartoon')}>
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
            </svg>
            Cartoon from photo
          </button>
          <button style={chip} onClick={() => { setMode('name'); setError(null) }}>
            Draw from name
          </button>
          {hasImage && (
            <button style={chip} onClick={() => { onClear(); setNote(null) }}>Remove</button>
          )}
        </div>
      )}

      {error && (
        <div style={{ fontSize: 12, color: 'var(--danger)', textAlign: 'center', maxWidth: 340 }}>{error}</div>
      )}
      {note && (
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center', maxWidth: 340, lineHeight: 1.5 }}>
          Drawn from your photo. Check the tail number — image models letter
          badly, so treat it as decoration, not as a record.
        </div>
      )}
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
    perf: { toRoll: '735 ft', to50ft: '1,340 ft', ldgRoll: '475 ft', ldg50ft: '1,200 ft', roc: '715 fpm', ceiling: '14,700 ft' },
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
    perf: { toRoll: '960 ft', to50ft: '1,630 ft', ldgRoll: '575 ft', ldg50ft: '1,335 ft', roc: '730 fpm', ceiling: '14,000 ft' },
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
    perf: { toRoll: '870 ft', to50ft: '1,600 ft', ldgRoll: '600 ft', ldg50ft: '1,390 ft', roc: '667 fpm', ceiling: '13,240 ft' },
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
    perf: { toRoll: '795 ft', to50ft: '1,514 ft', ldgRoll: '590 ft', ldg50ft: '1,350 ft', roc: '924 fpm', ceiling: '18,100 ft' },
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
    perf: { toRoll: '1,082 ft', to50ft: '1,628 ft', ldgRoll: '693 ft', ldg50ft: '1,178 ft', roc: '1,270 fpm', ceiling: '17,500 ft' },
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
    perf: { toRoll: '1,365 ft', to50ft: '2,055 ft', ldgRoll: '950 ft', ldg50ft: '1,795 ft', roc: '1,275 fpm', ceiling: '25,000 ft' },
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
    perf: { toRoll: '1,180 ft', to50ft: '2,485 ft', ldgRoll: '1,800 ft', ldg50ft: '2,170 ft', roc: '1,920 fpm', ceiling: '30,000 ft' },
    notes: 'PT6E-67XP, 1,200 SHP. EPECS (FADEC + autothrottle), single-lever. Pressurized to 30,000 ft. VMO 240 KCAS / M0.49. VFE by flap setting. Verify AFM.',
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
    perf: { toRoll: '1,940 ft', to50ft: '3,300 ft', ldgRoll: '2,100 ft', ldg50ft: '2,550 ft', roc: '2,731 fpm', ceiling: '35,000 ft' },
    notes: '2× PT6A-60A (1,050 SHP). Pressurized, winglets. VMO 260 KIAS / M0.58. V1 ≈ 99, Vr ≈ 104, V2 ≈ 109, Vmca 93. Compute per weight/condition. VFE 202 kt approach, 158 kt full. Burn at LRC FL350.',
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

export const CUSTOM_BLANK = {
  id: 'custom',
  label: 'Custom',
  fullName: '',
  registration: '',
  pilotName: '',
  category: 'custom',
  // Flight-plan-filing category — a simple 3-way Airplane/Rotorcraft/Other
  // classification, separate from `category` above (which is a template
  // descriptor — trainer/touring/turboprop/helicopter/custom — already
  // load-bearing elsewhere as a helicopter/not-helicopter switch).
  filingCategory: 'Airplane',
  color: '',
  dimensions: { length: '', height: '', span: '', rotorDiameter: '', cabinWidth: '', extra: [] },
  weights: { bew: '', mtow: '', usefulLoad: '', baggage: '' },
  vspeeds: { vs: '', vs0: '', vr: '', vx: '', vy: '', vg: '', va: '', vfe: '', vno: '', vne: '', vref: '', cruise: '' },
  fuel: { total: '', usable: '', type: '100LL' },
  burnRate: { climb: '', cruise: '' },
  perf: { toRoll: '', to50ft: '', ldgRoll: '', ldg50ft: '', roc: '', ceiling: '', hoverIGE: '', hoverOGE: '' },
  notes: '',
}

/* ── Helpers ─────────────────────────────────────────────── */
export function deepMerge(base, overrides) {
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


/* ── Airworthiness: documents + inspections, moved here from Currency so
   it lives alongside the aircraft it describes. Still reads/writes the same
   currency/profile.airworthy data other parts of the app depend on
   (getCurrencyStatus, the Checklists "IM AIRWORTHY" item). ── */
const WARN_DAYS_DEFAULT = 30
const WARN_HOURS_DEFAULT = 10 // hrs before an hour-based inspection is "expiring"


// Inspections with calendar-month expiry
const INSPECTIONS = [
  { key: 'annualDate',      label: 'Annual Inspection',        months: 12, far: FAR.annual,      unit: 'date',  hint: '12 calendar months' },
  { key: 'transponderDate', label: 'Transponder (24-mo)',       months: 24, far: FAR.transponder, unit: 'date',  hint: '24 calendar months. FAR 91.413' },
  { key: 'pitotDate',       label: 'Pitot-Static / Altimeter', months: 24, far: FAR.pitotStatic, unit: 'date',  hint: '24 calendar months. IFR required. FAR 91.411' },
  { key: 'eltDate',         label: 'ELT Battery',              months: null, far: FAR.elt,         unit: 'date',  hint: 'Per manufacturer / FAR 91.207. Enter expiry date' },
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

// Manufacturer -> Service Bulletin portal search. There's no centralized SB
// database (SBs are manufacturer-proprietary, unlike ADs), so this points to
// a search rather than guessing at a specific vendor portal URL that could
// go stale or be wrong.
// FAA Dynamic Regulatory System — the authoritative AD library. A search
// URL rather than an inline result list on purpose: applicability turns on
// serial number and configuration, which a title keyword match cannot
// decide, and an answer that looks authoritative while being a guess is
// worse than a link to the registry that actually knows.
function adSearchUrl(make, model) {
  const q = encodeURIComponent([make, model].filter(Boolean).join(' ').trim() || 'airworthiness directive')
  return `https://drs.faa.gov/browse/ADFRAWD/doctypeDetails?modalDetails=true&searchQuery=${q}`
}

function sbSearchUrl(make) {
  const q = encodeURIComponent(`${make} aircraft service bulletins`)
  return `https://www.google.com/search?q=${q}`
}

// AD lookup: queries the Federal Register's public API (the only official,
// free, CORS-open source for AD text; FAA's own DRS/registry have no public
// API) for Final Rule documents mentioning this make/model. This is a
// keyword match on document titles, not a serial-number eligibility check. 
// always shown with a disclaimer to verify via FAA DRS / an A&P.
// AD titles never include a model's trailing letter suffix as a literal
// token (e.g. "King Air 350i" is filed under "350", "172S" under "172"). 
// searching with the suffix attached reliably returns zero results. Strips
// a letter (or letter+digit, e.g. "G6") tail off the last numeric token.

async function fetchAdDocuments(term, signal) {
  const params = new URLSearchParams({
    'conditions[term]': term,
    'conditions[agencies][]': 'federal-aviation-administration',
    'conditions[type][]': 'RULE',
    per_page: '8',
    order: 'relevance',
  })
  const res = await fetch(`https://www.federalregister.gov/api/v1/documents.json?${params}`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data.results ?? []
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

// Compliance status for one AD entry, same status vocabulary as the
// inspection rows (valid/expiring/expired/incomplete) via the shared
// currency helpers, so the AirworthinessBadge renders consistently.
function adStatus(ad, currentHobbs) {
  if (ad.recurrence === 'onetime') return { status: ad.complied ? 'valid' : 'incomplete' }
  if (ad.recurrence === 'months') {
    const months = parseInt(ad.intervalMonths, 10)
    if (ad.lastDate && months > 0) return statusFromExpiry(calendarMonthExpiry(ad.lastDate, months))
    return { status: 'incomplete' }
  }
  if (ad.recurrence === 'hours') {
    const iv = parseFloat(ad.intervalHours)
    const last = parseFloat(ad.lastHobbs)
    if (!isNaN(iv) && !isNaN(last) && currentHobbs != null) return statusFromHours(last + iv, currentHobbs)
    return { status: 'incomplete' }
  }
  return { status: 'incomplete' }
}

const AD_RECURRENCE = [
  { key: 'onetime', label: 'One-time' },
  { key: 'months',  label: 'Every N months' },
  { key: 'hours',   label: 'Every N hours' },
]

function ADRow({ ad, onChange, onRemove, currentHobbs }) {
  const dateRef = useRef(null)
  const s = adStatus(ad, currentHobbs)
  const openPicker = () => {
    const el = dateRef.current
    if (!el) return
    if (el.showPicker) el.showPicker(); else el.focus()
  }
  const displayDate = ad.lastDate
    ? new Date(ad.lastDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null
  const nextHobbs = ad.recurrence === 'hours' && ad.lastHobbs !== '' && ad.intervalHours !== ''
    ? (parseFloat(ad.lastHobbs) + parseFloat(ad.intervalHours))
    : null

  const inputStyle = {
    padding: '8px 10px', borderRadius: 8, border: '0.5px solid var(--border)',
    background: 'var(--bg-card)', color: 'var(--text)', fontSize: 13, outline: 'none',
    fontFamily: 'inherit', boxSizing: 'border-box',
  }

  return (
    <div style={{ background: 'var(--bg-card-2)', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          value={ad.adNumber} onChange={e => onChange('adNumber', e.target.value)}
          placeholder="AD number (2019-12-04)"
          style={{ ...inputStyle, flex: 1 }}
        />
        <AirworthinessBadge status={s.status} />
        <RemoveButton onClick={onRemove} />
      </div>

      <input
        value={ad.title} onChange={e => onChange('title', e.target.value)}
        placeholder="Description (optional)"
        style={{ ...inputStyle, fontSize: 12 }}
      />

      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {AD_RECURRENCE.map(r => (
          <button key={r.key} onClick={() => onChange('recurrence', r.key)} style={{
            padding: '5px 9px', borderRadius: 7, cursor: 'pointer', whiteSpace: 'nowrap',
            fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
            border: ad.recurrence === r.key ? 'none' : '0.5px solid var(--border-strong)',
            background: ad.recurrence === r.key ? 'var(--accent)' : 'var(--bg-card)',
            color: ad.recurrence === r.key ? 'var(--accent-fg)' : 'var(--text-secondary)',
          }}>{r.label}</button>
        ))}
      </div>

      {ad.recurrence === 'onetime' && (
        <button onClick={() => onChange('complied', !ad.complied)} style={{
          display: 'flex', alignItems: 'center', gap: 9, padding: '4px 2px',
          background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
        }}>
          <div style={{
            width: 16, height: 16, borderRadius: 4, flexShrink: 0,
            background: ad.complied ? 'var(--accent)' : 'transparent',
            border: `1.5px solid ${ad.complied ? 'var(--accent)' : 'var(--border-strong)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {ad.complied && (
              <svg width={10} height={10} viewBox="0 0 12 12" fill="none">
                <polyline points="2,6 5,9 10,3" stroke="var(--accent-fg)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </div>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Complied with</span>
        </button>
      )}

      {ad.recurrence === 'months' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 6 }}>
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginBottom: 3 }}>Interval (months)</div>
            <MiniInput value={ad.intervalMonths} onChange={v => onChange('intervalMonths', v)} placeholder="12" />
          </div>
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginBottom: 3 }}>Last complied</div>
            <div onClick={openPicker} style={{ ...inputStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
              <span style={{ fontSize: 13, color: displayDate ? 'var(--text)' : 'var(--text-tertiary)' }}>{displayDate || 'Date'}</span>
              <img src="/calendario.png" width={15} height={15} alt="" className="icon-themed" />
            </div>
            <input ref={dateRef} type="date" value={ad.lastDate || ''} onChange={e => onChange('lastDate', e.target.value)}
              style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }} />
          </div>
        </div>
      )}

      {ad.recurrence === 'hours' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginBottom: 3 }}>Interval (hours)</div>
            <MiniInput value={ad.intervalHours} onChange={v => onChange('intervalHours', v)} placeholder="100" />
          </div>
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginBottom: 3 }}>Last Hobbs</div>
            <MiniInput value={ad.lastHobbs} onChange={v => onChange('lastHobbs', v)} placeholder={currentHobbs != null ? currentHobbs.toFixed(1) : '0.0'} />
          </div>
        </div>
      )}

      {ad.recurrence === 'months' && s.expiresOn && (
        <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
          Due {fmtDate(s.expiresOn)} · {fmtDaysLeft(s.daysLeft)}
        </div>
      )}
      {ad.recurrence === 'hours' && nextHobbs != null && (
        <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
          Due at {nextHobbs.toFixed(1)} Hobbs{s.hoursLeft != null ? ` · ${s.hoursLeft.toFixed(1)}h ${s.hoursLeft < 0 ? 'over' : 'left'}` : ''}
        </div>
      )}
    </div>
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
        {label.includes(': ') ? (
          <>
            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.2px', flexShrink: 0 }}>
              {label.split(': ')[0]}
            </span>
            <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {label.split(': ')[1]}
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

// Read-only digit boxes showing the current Hobbs reading. Placed above
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
        Total Time
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
          Set Total Airframe Time above to track this
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
export function weightNum(str) {
  return str ? str.replace(/[^0-9.]/g, '') : ''
}

function num(v) {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : null
}

// Chart-type picker + the editor for whichever one is selected — one row of
// chips (Takeoff/Landing/Climb/Cruise) rather than four separately-expanded
// editors, since only one chart's worth of grid fits comfortably on screen
// at a time.
//
// Photo extraction lands in local `draftChart` state, never straight into
// IndexedDB — PerfChartEditor renders the draft (in verifyMode, with 3
// random cells highlighted) exactly the same way it renders a committed
// chart, so all its edit/add-value/remove-value machinery works unchanged
// on the draft too. The pilot reviews, optionally confirms the 3 spot-check
// cells (a nudge, never a save-blocker), then explicitly Saves or Discards.
// Flights the GPS auto-detector (src/hooks/useFlightDetector.js, gated by
// Settings.jsx's Flight Detection toggle) captured for this aircraft.
// `pendingReview` entries need the pilot's confirmation before they're a
// real logbook record — tapping one opens the same LogbookEntryForm used
// for manual entries, pre-filled from the captured track, never auto-saved
// silently. Confirmed (source:'auto', pendingReview cleared) entries stay
// listed below for reference.
function FlightHistorySection({ aircraftId }) {
  const { entries } = useLogbook()
  const autoEntries = (entries ?? []).filter(e => e.source === 'auto' && e.aircraftId === aircraftId)
  const pending = autoEntries.filter(e => e.pendingReview)
  const confirmed = autoEntries.filter(e => !e.pendingReview)

  function Row({ entry, first }) {
    return (
      <Link to={`/logbook/${entry.id}`} style={{ textDecoration: 'none' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '11px 14px', borderTop: first ? 'none' : '0.5px solid var(--border)',
          cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{entry.date || 'Undated flight'}</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>{entry.totalTime ? `${entry.totalTime} hr` : '—'}</div>
          </div>
          {entry.pendingReview && (
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.2px', color: 'var(--warn)',
              background: 'var(--warn-light)', padding: '3px 9px', borderRadius: 10,
            }}>Review</span>
          )}
        </div>
      </Link>
    )
  }

  if (!autoEntries.length) {
    return (
      <div style={{ fontSize: 13, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
        No auto-detected flights yet. Turn on Auto-detect flights in Settings, then leave the map open during a flight — this can't track in the background, so the app needs to stay on screen.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {pending.length > 0 && (
        <div style={{ background: 'var(--bg-card-2)', borderRadius: 12, overflow: 'hidden' }}>
          {pending.map((e, i) => <Row key={e.id} entry={e} first={i === 0} />)}
        </div>
      )}
      {confirmed.length > 0 && (
        <div style={{ background: 'var(--bg-card-2)', borderRadius: 12, overflow: 'hidden' }}>
          {confirmed.map((e, i) => <Row key={e.id} entry={e} first={i === 0} />)}
        </div>
      )}
    </div>
  )
}

function PerformanceChartsSection({ profile, onAddAxisValue, onUpdateAxisValue, onRemoveAxisValue, onSetCell, onSetMeta, onSetChart }) {
  const [activeType, setActiveType] = useState('takeoff')
  const [draftChart, setDraftChart] = useState(null)
  const [highlightCells, setHighlightCells] = useState([])
  const [confirmedCells, setConfirmedCells] = useState(() => new Set())
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState(null)
  const fileInputRef = useRef(null)

  // A draft only makes sense for the chart type it was extracted from —
  // switching tabs abandons any pending review rather than showing it under
  // the wrong type.
  useEffect(() => {
    setDraftChart(null)
    setHighlightCells([])
    setConfirmedCells(new Set())
    setExtractError(null)
  }, [activeType])

  const committedChart = profile.perfConfig?.[activeType] ?? createEmptyChart(activeType)
  // `outputs` (label/short/unit per figure) is fixed schema metadata owned
  // by CHART_TYPES, not a per-chart user value — but a chart's own outputs
  // array gets snapshotted into IndexedDB the moment it's first created, so
  // a chart saved before this metadata changes (e.g. a new short label
  // added) would otherwise be stuck showing the old shape forever. Always
  // display the current canonical definition instead of whatever happened
  // to be stored; the actual axis/cell data underneath is untouched.
  const chart = { ...(draftChart ?? committedChart), outputs: CHART_TYPES[activeType].outputs }

  async function handleFile(file) {
    setExtracting(true)
    setExtractError(null)
    try {
      const candidate = await extractPohChart(file, activeType)
      const meta = CHART_TYPES[activeType]
      const axis1Values = (candidate.axis1?.values ?? []).map(num).filter(v => v != null)
      const axis2Values = (candidate.axis2?.values ?? []).map(num).filter(v => v != null)
      const rawCells = candidate.cells ?? []
      // Pad/truncate every row to a clean axis1.length × axis2.length
      // rectangle so the grid renders fully editable from the start, and so
      // pickRandomVerificationCells' {i,j} indices line up with what's
      // actually rendered.
      const cells = axis1Values.map((_, i) => {
        const row = rawCells[i] ?? []
        return axis2Values.map((_, j) => row[j] ?? null)
      })
      const next = {
        axis1: { ...meta.axis1, values: axis1Values },
        axis2: { ...meta.axis2, values: axis2Values },
        outputs: meta.outputs,
        cells,
        baselineWeight: null,
        notes: candidate.notes ?? '',
        source: '',
      }
      setDraftChart(next)
      setHighlightCells(pickRandomVerificationCells(next, 3))
      setConfirmedCells(new Set())
    } catch (e) {
      setExtractError(e.message)
    } finally {
      setExtracting(false)
    }
  }

  function draftAddAxisValue(axis) {
    setDraftChart(prev => {
      const next = { ...prev, [axis]: { ...prev[axis], values: [...prev[axis].values, ''] } }
      const cells = prev.cells.map(row => [...row])
      if (axis === 'axis1') cells.push(new Array(prev.axis2.values.length).fill(null))
      else cells.forEach(row => row.push(null))
      next.cells = cells
      return next
    })
  }
  function draftUpdateAxisValue(axis, idx, value) {
    setDraftChart(prev => {
      const values = [...prev[axis].values]
      values[idx] = value
      return { ...prev, [axis]: { ...prev[axis], values } }
    })
  }
  function draftRemoveAxisValue(axis, idx) {
    setDraftChart(prev => ({
      ...prev,
      [axis]: { ...prev[axis], values: prev[axis].values.filter((_, i) => i !== idx) },
      cells: axis === 'axis1'
        ? prev.cells.filter((_, i) => i !== idx)
        : prev.cells.map(row => row.filter((_, j) => j !== idx)),
    }))
  }
  function draftSetCell(i, j, outputKey, value) {
    setDraftChart(prev => {
      const cells = prev.cells.map(row => [...row])
      if (!cells[i]) cells[i] = new Array(prev.axis2.values.length).fill(null)
      if (outputKey) {
        const existing = cells[i][j]
        cells[i][j] = { ...(typeof existing === 'object' && existing ? existing : {}), [outputKey]: value }
      } else {
        cells[i][j] = value
      }
      return { ...prev, cells }
    })
  }
  function draftSetMeta(key, value) {
    setDraftChart(prev => ({ ...prev, [key]: value }))
  }

  function saveDraft() {
    onSetChart(activeType, draftChart)
    setDraftChart(null)
    setHighlightCells([])
    setConfirmedCells(new Set())
  }
  function discardDraft() {
    setDraftChart(null)
    setHighlightCells([])
    setConfirmedCells(new Set())
    setExtractError(null)
  }

  return (<>
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {Object.keys(CHART_TYPES).map(type => {
        const configured = validatePerfChart(normalizeUserPerfChart(profile.perfConfig?.[type]))
        const active = activeType === type
        return (
          <button key={type} onClick={() => setActiveType(type)} style={{
            padding: '8px 12px', borderRadius: 9, border: 'none', cursor: 'pointer',
            fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
            background: active ? 'var(--accent)' : 'var(--bg-card-2)',
            color: active ? 'var(--accent-fg)' : 'var(--text-secondary)',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            {CHART_TYPES[type].label}
            {configured && (
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: active ? 'var(--accent-fg)' : 'var(--ok)', flexShrink: 0 }} />
            )}
          </button>
        )
      })}
    </div>

    {!draftChart && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) handleFile(file)
            e.target.value = ''
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={extracting}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'rgba(255,255,255,0.07)', border: '0.5px solid rgba(255,255,255,0.15)',
            borderRadius: 10, padding: '7px 14px', cursor: extracting ? 'default' : 'pointer',
            color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500,
            opacity: extracting ? 0.6 : 1, fontFamily: 'inherit',
          }}
        >
          {extracting ? 'Reading chart…' : 'Extract from Photo'}
        </button>
        {extracting && (
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>This takes about 10–15 seconds…</span>
        )}
      </div>
    )}
    {extractError && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{extractError}</div>}

    <PerfChartEditor
      chart={chart}
      verifyMode={!!draftChart}
      highlightCells={highlightCells}
      onAddAxisValue={axis => draftChart ? draftAddAxisValue(axis) : onAddAxisValue(activeType, axis)}
      onUpdateAxisValue={(axis, i, v) => draftChart ? draftUpdateAxisValue(axis, i, v) : onUpdateAxisValue(activeType, axis, i, v)}
      onRemoveAxisValue={(axis, i) => draftChart ? draftRemoveAxisValue(axis, i) : onRemoveAxisValue(activeType, axis, i)}
      onSetCell={(i, j, key, v) => draftChart ? draftSetCell(i, j, key, v) : onSetCell(activeType, i, j, key, v)}
      onSetMeta={(key, v) => draftChart ? draftSetMeta(key, v) : onSetMeta(activeType, key, v)}
      onConfirmCell={(i, j) => setConfirmedCells(prev => new Set(prev).add(`${i},${j}`))}
    />

    {draftChart && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {highlightCells.length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            {confirmedCells.size} of {highlightCells.length} spot-checks confirmed against your POH
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={saveDraft} style={{
            flex: 1, padding: '9px 0', borderRadius: 9, border: 'none',
            background: 'var(--accent)', color: 'var(--accent-fg)',
            fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            Save Chart
          </button>
          <button onClick={discardDraft} style={{
            padding: '9px 14px', borderRadius: 9, border: 'none',
            background: 'var(--bg-card-2)', color: 'var(--text-secondary)',
            fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            Discard
          </button>
        </div>
      </div>
    )}
  </>)
}

/* ── Main component ──────────────────────────────────────── */
export default function Aircraft({ aircraftId, onBack, onDeleted }) {
  const [profile, setProfile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [showCustomModal, setShowCustomModal] = useState(false)
  const [customName, setCustomName] = useState('')
  const [topTab, setTopTab] = useState('details')
  // The airframe total is typed rather than picked, so it is held as a draft
  // string and written on blur. Saving per keystroke would push a half-typed
  // "12" into every inspection's hours-remaining sum on the way to "1250".
  const [airframeDraft, setAirframeDraft] = useState('')
  const [currencyData, setCurrencyData] = useState(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [shareError, setShareError] = useState(null)
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
    setProfile(null)
    if (!aircraftId) return
    // Aircraft is only ever mounted (post-Phase-1) with an id that already
    // has a row — created by the add-aircraft wizard. No saved row for a
    // given id is unexpected, not "first run" (that's Hangar's empty
    // state), so there's no default-template fallback here anymore.
    get('aircraft', aircraftId).then(saved => {
      if (saved) setProfile(deepMerge(CUSTOM_BLANK, saved))
    })
    get('currency', 'profile').then(saved => setCurrencyData(saved ?? {}))
  }, [aircraftId])

  // Airworthiness: patches only the `airworthy` key of the shared currency
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

  // AD compliance log: a manual list under airworthy.ads, filled from the
  // aircraft's logbook AD-compliance record. Each entry tracks its own
  // recurring/one-time status; mirrors patchAirworthyInsp's write path.
  function writeAds(mapper) {
    setCurrencyData(prev => {
      const base = prev ?? {}
      const airworthy = base.airworthy ?? {}
      const ads = mapper(airworthy.ads ?? [])
      const next = { ...base, airworthy: { ...airworthy, ads } }
      put('currency', { ...next, id: 'profile' })
      return next
    })
  }
  function addAD() {
    writeAds(ads => [...ads, {
      id: 'ad-' + Date.now(), adNumber: '', title: '', recurrence: 'onetime',
      intervalMonths: '', intervalHours: '', lastDate: '', lastHobbs: '', complied: false,
    }])
  }
  function updateAD(id, key, value) {
    writeAds(ads => ads.map(a => a.id === id ? { ...a, [key]: value } : a))
  }
  function removeAD(id) {
    writeAds(ads => ads.filter(a => a.id !== id))
  }

  const save = useCallback(async (updated) => {
    setSaving(true)
    await put('aircraft', { ...updated, id: aircraftId })
    setTimeout(() => setSaving(false), 600)
  }, [aircraftId])

  function applyTemplate(tpl) {
    const next = { ...CUSTOM_BLANK, ...tpl, id: aircraftId, image: tpl.image ?? null, registration: profile?.registration ?? '', pilotName: profile?.pilotName ?? '' }
    setProfile(next)
    save(next)
  }

  function confirmCustom() {
    if (!customName.trim()) return
    const next = { ...CUSTOM_BLANK, fullName: customName.trim(), label: customName.trim(), id: aircraftId, registration: profile?.registration ?? '', pilotName: profile?.pilotName ?? '' }
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

  // Exports the profile as a small JSON file and hands it to the OS Share
  // sheet (Messages/AirDrop/email/...) when available, so it can travel to
  // another pilot with no account linking or backend involved. Browsers
  // without file-sharing support (most desktop browsers) fall back to a
  // plain download the user can send however they like.
  async function shareProfile() {
    setSharing(true)
    setShareError(null)
    try {
      const json = JSON.stringify(buildAircraftExport(profile), null, 2)
      const filename = exportFileName(profile)
      const file = new File([json], filename, { type: 'application/json' })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: displayName, text: `${displayName} — aircraft profile` })
      } else {
        const url = URL.createObjectURL(file)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
      }
    } catch (e) {
      if (e?.name !== 'AbortError') setShareError(e.message || 'Could not share this aircraft.')
    } finally {
      setSharing(false)
    }
  }

  async function confirmDelete() {
    setDeleting(true)
    await deleteAircraft(aircraftId)
    setDeleting(false)
    setDeleteConfirmOpen(false)
    onDeleted?.(aircraftId)
  }

  function patchHobbs(value) {
    const val = value === '' ? null : parseFloat(value)
    setProfile(prev => {
      const next = { ...prev, hobbsTime: Number.isNaN(val) ? null : val, hobbsUpdatedAt: Date.now() }
      save(next)
      return next
    })
  }

  // The stored figure is the source of truth; the draft only exists while a
  // field is being typed into. Re-seeding it when the aircraft changes is what
  // stops one aeroplane's hours appearing on the next one after a swipe.
  // Optional chaining is load-bearing: hooks run before the `if (!profile)`
  // guard further down, so on the first render — profile still null while the
  // record loads — a plain `profile.hobbsTime` in the dependency array throws
  // during render and takes the whole page white.
  useEffect(() => {
    setAirframeDraft(profile?.hobbsTime == null ? '' : String(profile.hobbsTime))
  }, [profile?.hobbsTime, aircraftId])

  function commitAirframeTime() {
    const trimmed = airframeDraft.trim()
    const current = profile.hobbsTime == null ? '' : String(profile.hobbsTime)
    if (trimmed === current) return              // nothing typed, no write
    if (trimmed !== '' && Number.isNaN(parseFloat(trimmed))) {
      setAirframeDraft(current)                  // gibberish: put the old value back
      return
    }
    patchHobbs(trimmed)
  }

  // ── Weight & Balance setup. Belongs to this aircraft's profile, never a
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

  // ── Performance chart setup — same "belongs to this aircraft's profile"
  // rule as W&B above. `ensurePerfChart` returns a fresh perfConfig object
  // plus that chart type's current-or-blank chart, so every patcher below
  // can mutate the chart in place without repeating the get-or-create logic. ──
  function ensurePerfChart(prev, chartType) {
    const perfConfig = { ...(prev.perfConfig ?? {}) }
    // Re-stamp `outputs` with the current canonical CHART_TYPES metadata on
    // every save, not just on display (see the matching comment in
    // PerformanceChartsSection) — a chart edited after this metadata last
    // changed self-heals instead of staying stuck on whatever was stored
    // when it was first created.
    const chart = perfConfig[chartType]
      ? { ...perfConfig[chartType], outputs: CHART_TYPES[chartType].outputs }
      : createEmptyChart(chartType)
    return { perfConfig, chart }
  }

  function addPerfAxisValue(chartType, axis) {
    setProfile(prev => {
      const { perfConfig, chart } = ensurePerfChart(prev, chartType)
      chart[axis] = { ...chart[axis], values: [...chart[axis].values, ''] }
      const cells = chart.cells.map(row => [...row])
      if (axis === 'axis1') cells.push(new Array(chart.axis2.values.length).fill(null))
      else cells.forEach(row => row.push(null))
      chart.cells = cells
      perfConfig[chartType] = chart
      const next = { ...prev, perfConfig }
      save(next)
      return next
    })
  }

  function updatePerfAxisValue(chartType, axis, idx, value) {
    setProfile(prev => {
      const { perfConfig, chart } = ensurePerfChart(prev, chartType)
      const values = [...chart[axis].values]
      values[idx] = value
      chart[axis] = { ...chart[axis], values }
      perfConfig[chartType] = chart
      const next = { ...prev, perfConfig }
      save(next)
      return next
    })
  }

  function removePerfAxisValue(chartType, axis, idx) {
    setProfile(prev => {
      const { perfConfig, chart } = ensurePerfChart(prev, chartType)
      chart[axis] = { ...chart[axis], values: chart[axis].values.filter((_, i) => i !== idx) }
      chart.cells = axis === 'axis1'
        ? chart.cells.filter((_, i) => i !== idx)
        : chart.cells.map(row => row.filter((_, j) => j !== idx))
      perfConfig[chartType] = chart
      const next = { ...prev, perfConfig }
      save(next)
      return next
    })
  }

  function setPerfCell(chartType, i, j, outputKey, value) {
    setProfile(prev => {
      const { perfConfig, chart } = ensurePerfChart(prev, chartType)
      const cells = chart.cells.map(row => [...row])
      if (!cells[i]) cells[i] = new Array(chart.axis2.values.length).fill(null)
      if (outputKey) {
        const existing = cells[i][j]
        cells[i][j] = { ...(typeof existing === 'object' && existing ? existing : {}), [outputKey]: value }
      } else {
        cells[i][j] = value
      }
      chart.cells = cells
      perfConfig[chartType] = chart
      const next = { ...prev, perfConfig }
      save(next)
      return next
    })
  }

  function setPerfMeta(chartType, key, value) {
    setProfile(prev => {
      const { perfConfig, chart } = ensurePerfChart(prev, chartType)
      chart[key] = value
      perfConfig[chartType] = chart
      const next = { ...prev, perfConfig }
      save(next)
      return next
    })
  }

  // Commits a whole chart in one shot — used by the AI-photo-extraction
  // review flow, which already builds a complete chart shape locally and
  // just needs it written through, unlike the per-axis-value/per-cell
  // patchers above which build one up incrementally from manual entry.
  function setPerfChart(chartType, chart) {
    setProfile(prev => {
      const perfConfig = { ...(prev.perfConfig ?? {}), [chartType]: chart }
      const next = { ...prev, perfConfig }
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

  // Airworthiness: worst status across docs + inspections
  const airworthy = currencyData?.airworthy ?? {}
  const airworthyDocs = airworthy.docs ?? {}
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
  // Inspections alone decide this now. The CARROW documents used to gate it
  // too, but that list moved to the flight plan — whether the papers are in
  // the aeroplane today is a question about today's flight, not about the
  // aeroplane's maintenance state.
  const airworthyStatus = worstInsp.status === 'expired' ? 'expired'
    : worstInsp.status === 'expiring' ? 'expiring'
    : worstInsp.status === 'incomplete' ? 'incomplete'
    : 'valid'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>

      {/* ── Header ── */}
      <div style={{ padding: '20px 18px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <BackButton onBack={onBack} />
          <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.5px', color: 'var(--text)', lineHeight: 1 }}>
            Aircraft
          </span>
          {saving && (
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 'auto', letterSpacing: '0.2px' }}>Saving…</span>
          )}
        </div>

        {/* Aircraft hero */}
        <div style={{ position: 'relative' }}>

          {/* Hover/swipe zone: wraps dots + image */}
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

          {/* Picture controls, only when no built-in template image exists */}
          {!activeTemplate?.image && (
            <div style={{ marginTop: 10, marginBottom: 4 }}>
              <AircraftImageControls
                aircraftName={profile.fullName || profile.label || ''}
                registration={profile.registration ?? ''}
                hasImage={!!profile.image}
                onImage={dataUrl => patch(null, 'image', dataUrl)}
                onClear={() => patch(null, 'image', null)}
              />
            </div>
          )}

          {/* Name + reg. Centered */}
          <div key={slideKey} style={{ position: 'relative', zIndex: 1, textAlign: 'center', marginBottom: 14, animation: slideKey > 0 ? `slide-in-${slideDir > 0 ? 'right' : 'left'} 0.35s cubic-bezier(0.25,0.46,0.45,0.94) both` : 'none' }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.5px', lineHeight: 1.1 }}>
              {displayName}
            </div>
            {reg && (
              <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'monospace', color: 'var(--text-secondary)', letterSpacing: '1.5px', marginTop: 4 }}>
                {reg}
              </div>
            )}

            {/* Total airframe time. It sits with the name because half the
                maintenance page is measured against it — an inspection due
                "every 100 hours" means nothing until this number is here. It
                used to be behind a button, which hid the one figure most of
                the section depends on. */}
            <div style={{
              display: 'flex', alignItems: 'baseline', justifyContent: 'center',
              gap: 8, marginTop: 10,
            }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)' }}>
                Total Airframe Time:
              </span>
              <input
                value={airframeDraft}
                onChange={e => setAirframeDraft(e.target.value.replace(/[^0-9.]/g, ''))}
                onBlur={commitAirframeTime}
                onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
                inputMode="decimal"
                placeholder="0.0"
                style={{
                  width: 84, padding: '4px 8px', borderRadius: 7,
                  border: '0.5px solid var(--border-strong)', background: 'var(--bg-card-2)',
                  color: 'var(--text)', fontSize: 14, fontWeight: 700, fontFamily: 'monospace',
                  textAlign: 'center', outline: 'none',
                }}
              />
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>hrs</span>
            </div>
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

        {/* Aircraft Details / Maintenance */}
        <div style={{ display: 'flex', gap: 10 }}>
          {[['details', 'Aircraft Details'], ['maintenance', 'Maintenance']].map(([id, label]) => (
            <button key={id} onClick={() => setTopTab(id)} style={{
              flex: 1, padding: '9px 12px', borderRadius: 10,
              background: topTab === id ? 'var(--text)' : 'var(--bg-card)',
              border: 'none', boxShadow: 'var(--shadow-sm)', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
              color: topTab === id ? 'var(--bg)' : 'var(--text)',
              transition: 'background 0.15s, color 0.15s',
            }}>
              {label}
            </button>
          ))}
        </div>

        {topTab === 'maintenance' && (
          <div style={{
            borderRadius: 12, background: 'var(--bg-card)', boxShadow: 'var(--shadow-sm)',
            padding: '34px 18px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Maintenance</div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 6, lineHeight: 1.5 }}>
              Nothing here yet. Tracked against the total airframe time above.
            </div>
          </div>
        )}

        {topTab === 'details' && (<>

        {/* Identity */}
        <Section title="Identity">
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Flight plan category
            </div>
            <SegControl options={FILING_CATEGORIES} value={profile.filingCategory ?? 'Airplane'}
              onChange={v => patch(null, 'filingCategory', v)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Pilot name" value={profile.pilotName ?? ''}
              onChange={v => patch(null, 'pilotName', v)} placeholder="e.g. Diego" colSpan />
            <Field label="Registration" value={profile.registration ?? ''}
              onChange={v => patch(null, 'registration', v.toUpperCase())} placeholder="e.g. N4723A" />
            <Field label="Aircraft type" value={profile.fullName ?? ''}
              onChange={v => patch(null, 'fullName', v)} placeholder="e.g. Cessna 172S" />
            <Field label="Color" value={profile.color ?? ''}
              onChange={v => patch(null, 'color', v)} placeholder="e.g. White/Blue" />
            <Field label="Make" value={profile.make ?? ''}
              onChange={v => patch(null, 'make', v)} placeholder="e.g. Cessna" />
            <Field label="Model" value={profile.model ?? ''}
              onChange={v => patch(null, 'model', v)} placeholder="e.g. 172S" />
            <Field label="Year" type="number" value={profile.year ?? ''}
              onChange={v => patch(null, 'year', v)} placeholder="e.g. 2019" />
          </div>
        </Section>

        {/* Dimensions */}
        {/* Dimensions and Capacities: the aeroplane's fixed numbers in one
            place — how big it is, how much it holds, how heavy it may be,
            and the speeds the POH publishes. All specification figures, as
            opposed to anything that has to be calculated for a given day,
            which now lives with the performance charts. */}
        <Section title="Dimensions and Capacities">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Length" value={profile.dimensions?.length ?? ''}
              onChange={v => patch('dimensions', 'length', v)} placeholder="e.g. 27 ft 2 in" />
            <Field label="Height" value={profile.dimensions?.height ?? ''}
              onChange={v => patch('dimensions', 'height', v)} placeholder="e.g. 8 ft 11 in" />
            {isHelicopter ? (
              <Field label="Rotor diameter" value={profile.dimensions?.rotorDiameter ?? ''}
                onChange={v => patch('dimensions', 'rotorDiameter', v)} placeholder="e.g. 36 ft 1 in" />
            ) : (
              <Field label="Wingspan" value={profile.dimensions?.span ?? ''}
                onChange={v => patch('dimensions', 'span', v)} placeholder="e.g. 36 ft 1 in" />
            )}
            <Field label="Cabin width" value={profile.dimensions?.cabinWidth ?? ''}
              onChange={v => patch('dimensions', 'cabinWidth', v)} placeholder="e.g. 40 in" />
          </div>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(profile.dimensions?.extra ?? []).map(d => (
              <div key={d.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <MiniInput value={d.label} onChange={v => patch('dimensions', 'extra',
                  (profile.dimensions?.extra ?? []).map(x => x.id === d.id ? { ...x, label: v } : x))} placeholder="Label" />
                <MiniInput value={d.value} onChange={v => patch('dimensions', 'extra',
                  (profile.dimensions?.extra ?? []).map(x => x.id === d.id ? { ...x, value: v } : x))} placeholder="Value" />
                <RemoveButton onClick={() => patch('dimensions', 'extra',
                  (profile.dimensions?.extra ?? []).filter(x => x.id !== d.id))} />
              </div>
            ))}
            <Chip label="+ Add dimension" onClick={() => patch('dimensions', 'extra',
              [...(profile.dimensions?.extra ?? []), { id: 'dim-' + Date.now(), label: '', value: '' }])} />
          </div>

          <div style={{ borderTop: '0.5px solid var(--border)', paddingTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
              Weights and Fuel
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="MTOW" value={profile.weights?.mtow ?? ''}
                onChange={v => patch('weights', 'mtow', v)} placeholder="e.g. 2,550 lb" />
              <Field label="Fuel type" value={profile.fuel?.type ?? ''}
                onChange={v => patch('fuel', 'type', v)} placeholder="100LL / Jet-A" />
              <Field label="Fuel total" value={profile.fuel?.total ?? ''}
                onChange={v => patch('fuel', 'total', v)} placeholder="e.g. 56 USG" />
              <Field label="Fuel usable" value={profile.fuel?.usable ?? ''}
                onChange={v => patch('fuel', 'usable', v)} placeholder="e.g. 53 USG" />
              {/* Which column of the cruise chart this aircraft is actually
                  flown at. Without it the app would have to pick a power
                  setting on the pilot's behalf to read fuel flow out of the
                  chart, and inventing a power setting inside fuel planning
                  is not the app's decision to make. */}
              <Field label="Normal cruise setting" value={profile.cruiseSetting ?? ''}
                onChange={v => patch(null, 'cruiseSetting', v)} placeholder="e.g. 65 or 2400" />
            </div>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(profile.fuel?.tanks ?? []).map(t => (
                <div key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <MiniInput value={t.label} onChange={v => patch('fuel', 'tanks',
                    (profile.fuel?.tanks ?? []).map(x => x.id === t.id ? { ...x, label: v } : x))} placeholder="Tank" />
                  <MiniInput value={t.value} onChange={v => patch('fuel', 'tanks',
                    (profile.fuel?.tanks ?? []).map(x => x.id === t.id ? { ...x, value: v } : x))} placeholder="e.g. 26 USG" />
                  <RemoveButton onClick={() => patch('fuel', 'tanks',
                    (profile.fuel?.tanks ?? []).filter(x => x.id !== t.id))} />
                </div>
              ))}
              <Chip label="+ Add tank" onClick={() => patch('fuel', 'tanks',
                [...(profile.fuel?.tanks ?? []), { id: 'tank-' + Date.now(), label: '', value: '' }])} />
            </div>
          </div>

          <div style={{ borderTop: '0.5px solid var(--border)', paddingTop: 14 }}>
          {isHelicopter ? (
            <>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
              Speeds (knots)
            </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <VSpeed label="Vne  Never exceed" value={profile.vspeeds?.vne ?? ''} onChange={v => patch('vspeeds', 'vne', v)} />
                <VSpeed label="Vy   Best climb" value={profile.vspeeds?.vy ?? ''} onChange={v => patch('vspeeds', 'vy', v)} />
                <VSpeed label="Vx   Best angle" value={profile.vspeeds?.vx ?? ''} onChange={v => patch('vspeeds', 'vx', v)} />
                <VSpeed label="Autorotation" value={profile.vspeeds?.auto ?? ''} onChange={v => patch('vspeeds', 'auto', v)} />
                <VSpeed label="Cruise TAS" value={profile.vspeeds?.cruise ?? ''} onChange={v => patch('vspeeds', 'cruise', v)} />
              </div>
            </>
          ) : (
            <>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
              V-Speeds (knots)
            </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <VSpeed label="Vs  Stall clean" value={profile.vspeeds?.vs ?? ''} onChange={v => patch('vspeeds', 'vs', v)} />
                <VSpeed label="Vso Stall flaps" value={profile.vspeeds?.vs0 ?? ''} onChange={v => patch('vspeeds', 'vs0', v)} />
                <VSpeed label="Vr  Rotation" value={profile.vspeeds?.vr ?? ''} onChange={v => patch('vspeeds', 'vr', v)} />
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
            </>
          )}
          </div>
        </Section>

        {/* Airworthiness Directives & Service Bulletins */}
        {/* Airworthiness */}
        <Section title="Airworthiness">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: -6 }}>
            <AirworthinessBadge status={airworthyStatus} />
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

          {/* ADs and SBs sit at the bottom of Airworthiness, where they
              belong, and the search is now just a link out. The old inline
              lookup queried the Federal Register and matched on title text,
              which is a keyword search dressed up as an answer — it cannot
              tell you whether an AD applies to your serial number, and
              looking authoritative about that is worse than sending you to
              the registry that can. The compliance log stays: those are the
              pilot's own records, with recurrence and due tracking. */}
          <div style={{ borderTop: '0.5px solid var(--border)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>
              Airworthiness Directives &amp; Service Bulletins
            </div>
            <a
              href={adSearchUrl(profile.make, profile.model)}
              target="_blank" rel="noreferrer"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                padding: '11px 13px', borderRadius: 'var(--r-sm)', textDecoration: 'none',
                background: 'var(--bg-card-2)', color: 'var(--accent)', fontSize: 14, fontWeight: 600,
              }}>
              <span>Search FAA Dynamic Regulatory System</span>
              <span aria-hidden="true">↗</span>
            </a>
            <a
              href={sbSearchUrl(profile.make)}
              target="_blank" rel="noreferrer"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                padding: '11px 13px', borderRadius: 'var(--r-sm)', textDecoration: 'none',
                background: 'var(--bg-card-2)', color: 'var(--accent)', fontSize: 14, fontWeight: 600,
              }}>
              <span>Search manufacturer service bulletins</span>
              <span aria-hidden="true">↗</span>
            </a>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              Applicability depends on serial number and configuration — confirm with the FAA registry or your A&amp;P.
            </div>
          </div>

          {/* AD compliance log. Filled from the aircraft's logbook AD record */}
          <div style={{ borderTop: '0.5px solid var(--border)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>
              AD Compliance Log
            </div>
            {(currencyData?.airworthy?.ads ?? []).length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                Add ADs from your aircraft's logbook AD-compliance record to track recurring inspections and due dates.
              </div>
            )}
            {(currencyData?.airworthy?.ads ?? []).map(ad => (
              <ADRow key={ad.id} ad={ad} currentHobbs={profile.hobbsTime}
                onChange={(key, v) => updateAD(ad.id, key, v)} onRemove={() => removeAD(ad.id)} />
            ))}
            <div>
              <Chip label="+ Add AD" onClick={addAD} accent />
            </div>
          </div>
        </Section>

        {/* Weight & Balance Setup */}
        <Section title="Weight & Balance Setup">
          {({ close }) => (<>
          <WBSetupSection
            profile={profile} isHelicopter={isHelicopter}
            onPatchWB={patchWB}
            onAddStation={addWBStation} onUpdateStation={updateWBStation} onRemoveStation={removeWBStation}
            onAddPoint={addWBPoint} onUpdatePoint={updateWBPoint} onRemovePoint={removeWBPoint}
          />
          <button onClick={close} style={{
            width: '100%', padding: '13px 0', borderRadius: 'var(--r-sm)', border: 'none',
            background: 'var(--accent)', color: 'var(--accent-fg)',
            fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            Done
          </button>
          </>)}
        </Section>

        {/* Flight History — GPS auto-detected flights for this aircraft */}
        <Section title="Flight History">
          <FlightHistorySection aircraftId={profile.id} />
        </Section>

        {/* Performance Charts */}
        <Section title="Performance Charts">
          {({ close }) => (<>
          <PerformanceChartsSection
            profile={profile}
            onAddAxisValue={addPerfAxisValue}
            onUpdateAxisValue={updatePerfAxisValue}
            onRemoveAxisValue={removePerfAxisValue}
            onSetCell={setPerfCell}
            onSetMeta={setPerfMeta}
            onSetChart={setPerfChart}
          />
          <button onClick={close} style={{
            width: '100%', padding: '13px 0', borderRadius: 'var(--r-sm)', border: 'none',
            background: 'var(--accent)', color: 'var(--accent-fg)',
            fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            Done
          </button>
          </>)}
        </Section>

        {/* Calculates only from the charts above — see PerformanceCalculator */}
        <Section title="Performance Calculator">
          <PerformanceCalculator profile={profile} />
        </Section>

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
        ) : null}

        {/* Notes: a plain box, not a collapsible section. It is one field
            with no structure to reveal, and hiding a scratchpad behind a
            tap is how it stops being used. */}
        <div style={{
          background: 'var(--bg-card)', borderRadius: 'var(--r-lg)',
          boxShadow: 'var(--shadow-sm)', padding: '15px 16px',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.2px', color: 'var(--text)' }}>
            Notes
          </span>
          <textarea
            value={profile.notes ?? ''}
            onChange={e => patch(null, 'notes', e.target.value)}
            placeholder="Any additional notes about this aircraft…"
            rows={4}
            style={{
              width: '100%', boxSizing: 'border-box', resize: 'vertical',
              padding: '11px 13px', borderRadius: 'var(--r-sm)',
              border: 'none', background: 'var(--bg-card-2)',
              color: 'var(--text)', fontSize: 15,
              fontFamily: 'inherit', lineHeight: 1.5, outline: 'none',
            }}
          />
        </div>

        {/* Manage */}
        <Section title="Share / Delete Aircraft">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <button
              onClick={shareProfile}
              disabled={sharing}
              style={{
                width: '100%', padding: '11px 13px', borderRadius: 'var(--r-sm)',
                border: 'none', background: 'var(--accent-light, rgba(10,132,255,0.12))',
                color: 'var(--accent)', fontSize: 15, fontWeight: 700,
                cursor: sharing ? 'default' : 'pointer', fontFamily: 'inherit',
                opacity: sharing ? 0.6 : 1,
              }}>
              {sharing ? 'Sharing…' : 'Share Aircraft Profile'}
            </button>
            <button
              onClick={() => setDeleteConfirmOpen(true)}
              style={{
                width: '100%', padding: '11px 13px', borderRadius: 'var(--r-sm)',
                border: 'none', background: 'var(--danger-light, rgba(255,59,48,0.12))',
                color: 'var(--danger)', fontSize: 15, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
              Delete Aircraft
            </button>
          </div>
          {shareError && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--danger)' }}>{shareError}</div>
          )}
        </Section>
        </>)}

      </div>

      {/* Delete-aircraft confirmation */}
      {deleteConfirmOpen && (
        <ConfirmModal
          title="Delete this aircraft?"
          message={`"${displayName}" will move to Recently Deleted and be permanently removed in 7 days, unless you restore it first.`}
          confirmLabel="Delete"
          danger
          busy={deleting}
          onCancel={() => setDeleteConfirmOpen(false)}
          onConfirm={confirmDelete}
        />
      )}

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


/* ── Performance Calculator ────────────────────────────────────────────────
   Reads the pilot's own POH charts and interpolates between the numbers they
   entered. It computes nothing it cannot source: no chart means no answer, and
   inputs outside the chart's axes are refused rather than extrapolated, because
   a takeoff distance invented past the end of a table is exactly the number a
   pilot must not be handed.
   ── */
function PerformanceCalculator({ profile }) {
  const [type, setType] = useState('takeoff')
  const [x, setX] = useState('')
  const [y, setY] = useState('')

  const meta = CHART_TYPES[type]
  const chart = getPerfChart(profile, type)
  const xNum = x.trim() === '' ? null : parseFloat(x)
  const yNum = y.trim() === '' ? null : parseFloat(y)
  const bothEntered = xNum != null && !isNaN(xNum) && yNum != null && !isNaN(yNum)
  const result = chart && bothEntered ? interpolateChart(chart, xNum, yNum) : null

  const range = axis => axis?.values?.length
    ? `${axis.values[0]} – ${axis.values[axis.values.length - 1]}${axis.unit ? ' ' + axis.unit : ''}`
    : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {Object.keys(CHART_TYPES).map(t => {
          const has = !!getPerfChart(profile, t)
          return (
            <button key={t} onClick={() => { setType(t); setX(''); setY('') }} style={{
              padding: '7px 12px', borderRadius: 20, cursor: 'pointer',
              border: type === t ? 'none' : '1px solid var(--border)',
              background: type === t ? 'var(--accent)' : 'var(--bg-card-2)',
              color: type === t ? 'var(--accent-fg)' : has ? 'var(--text)' : 'var(--text-tertiary)',
              fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
            }}>
              {CHART_TYPES[t].label}
            </button>
          )
        })}
      </div>

      {!chart ? (
        // Shown, but inert. The rule is that a performance figure with no POH
        // data behind it is not calculated at all — not estimated, not filled
        // from a class average — so the fields stay visible and disabled and
        // say plainly what is missing.
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, opacity: 0.45, pointerEvents: 'none' }}>
            <Field label={`${meta.axis1.label}${meta.axis1.unit ? ` (${meta.axis1.unit})` : ''}`} value="" onChange={() => {}} placeholder="—" />
            <Field label={`${meta.axis2.label}${meta.axis2.unit ? ` (${meta.axis2.unit})` : ''}`} value="" onChange={() => {}} placeholder="—" />
          </div>
          <div style={{
            background: 'var(--bg-card-2)', borderRadius: 10, padding: '12px 14px',
            fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5,
          }}>
            <strong style={{ color: 'var(--text)' }}>{meta.label} POH information is missing.</strong>
            {' '}Enter this chart under Performance Charts and the calculation becomes
            available. Nothing is estimated in the meantime.
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label={`${meta.axis1.label}${meta.axis1.unit ? ` (${meta.axis1.unit})` : ''}`}
              value={x} onChange={setX} placeholder={range(chart.axis1) ?? ''} />
            <Field label={`${meta.axis2.label}${meta.axis2.unit ? ` (${meta.axis2.unit})` : ''}`}
              value={y} onChange={setY} placeholder={range(chart.axis2) ?? ''} />
          </div>

          {result ? (
            <div style={{ background: 'var(--bg-card-2)', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {meta.outputs.map(o => (
                <div key={o.key} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{o.label}</span>
                  <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                    {Math.round(result[o.key])}<span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginLeft: 4 }}>{o.unit}</span>
                  </span>
                </div>
              ))}
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5, borderTop: '0.5px solid var(--border)', paddingTop: 8 }}>
                Interpolated from your {meta.label.toLowerCase()} chart
                {chart.baselineWeight ? ` at ${chart.baselineWeight} lb` : ''}
                {chart.source ? ` · ${chart.source}` : ''}. Apply your own corrections for
                wind, runway surface and slope.
              </div>
            </div>
          ) : bothEntered ? (
            <div style={{ fontSize: 13, color: 'var(--warn)', lineHeight: 1.5 }}>
              Outside the range this chart covers ({meta.axis1.label} {range(chart.axis1)},
              {' '}{meta.axis2.label} {range(chart.axis2)}), or a needed cell is blank.
              No value is shown rather than one guessed past the end of the table.
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
              Enter both values to calculate.
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function Section({ title, children }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{
      background: 'var(--bg-card)',
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

export function Field({ label, value, onChange, placeholder, type = 'text' }) {
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
          border: 'none', background: 'var(--bg-card-2)',
          color: 'var(--text)', fontSize: 15, outline: 'none',
          fontVariantNumeric: 'tabular-nums',
        }}
      />
    </div>
  )
}

export function VSpeed({ label, value, onChange }) {
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
            border: 'none', background: 'var(--bg-card-2)',
            color: 'var(--text)', fontSize: 15, outline: 'none',
            fontVariantNumeric: 'tabular-nums',
          }}
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
export function Chip({ label, onClick, accent }) {
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

export function FuelDensityTag({ label, active, onClick }) {
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

export function MiniInput({ value, onChange, placeholder }) {
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

export function RemoveButton({ onClick }) {
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

export function WBStationRow({ station, onChange, onRemove }) {
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

export function WBPointRow({ point, fieldA, fieldB, labelA, labelB, onChange, onRemove }) {
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
