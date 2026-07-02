import { useState, useEffect, useCallback, useRef } from 'react'
import { get, put } from '../../lib/db'
import { BackButton } from '../../components/Shell'
import { generateAircraftIcon } from '../../lib/generateIcon'

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


/* ── Main component ──────────────────────────────────────── */
export default function Aircraft() {
  const [profile, setProfile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [showCustomModal, setShowCustomModal] = useState(false)
  const [customName, setCustomName] = useState('')
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
  }, [])

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

  if (!profile) return null

  const activeTemplate = TEMPLATES.find(t => t.fullName === profile.fullName)
  const activeTemplateId = activeTemplate?.id ?? (profile.category === 'custom' ? 'custom' : null)
  const heroImage = profile.image ?? activeTemplate?.image ?? null
  const reg = profile.registration?.trim()
  const displayName = profile.fullName || profile.label || '—'
  const isHelicopter = profile.category === 'helicopter'

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

        {/* Identity */}
        <Section title="Identity">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Pilot name" value={profile.pilotName ?? ''}
              onChange={v => patch(null, 'pilotName', v)} placeholder="e.g. Diego" colSpan />
            <Field label="Registration" value={profile.registration ?? ''}
              onChange={v => patch(null, 'registration', v.toUpperCase())} placeholder="e.g. N4723A" />
            <Field label="Aircraft type" value={profile.fullName ?? ''}
              onChange={v => patch(null, 'fullName', v)} placeholder="e.g. Cessna 172S" />
          </div>
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

        {/* Weights */}
        <Section title="Weights">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="BEW (empty)" value={profile.weights?.bew ?? ''}
              onChange={v => patch('weights', 'bew', v)} placeholder="e.g. 1,663 lb" />
            <Field label="MTOW" value={profile.weights?.mtow ?? ''}
              onChange={v => patch('weights', 'mtow', v)} placeholder="e.g. 2,550 lb" />
            <Field label="Useful load" value={profile.weights?.usefulLoad ?? ''}
              onChange={v => patch('weights', 'usefulLoad', v)} placeholder="e.g. 887 lb" />
            <Field label="Baggage limit" value={profile.weights?.baggage ?? ''}
              onChange={v => patch('weights', 'baggage', v)} placeholder="e.g. 120 lb" />
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
  return (
    <div style={{
      background: 'var(--bg-card)', borderRadius: 'var(--r-lg)',
      padding: 16, boxShadow: 'var(--shadow-sm)',
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
        {title}
      </span>
      {children}
    </div>
  )
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 500 }}>
        {label}
      </label>
      <input
        type="text"
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
