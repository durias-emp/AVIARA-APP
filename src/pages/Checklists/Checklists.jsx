import { useState, useEffect, useRef, useCallback } from 'react'
import { BackButton } from '../../components/Shell'
import { get, put, del } from '../../lib/db'
import { ExpandableCard, DoneButton, Bone } from './shared/ui'
import { OverflightItem, OxygenItem, RecapItem, IMSafeExpand, IMCurrentExpand, IMValidExpand, IMAirworthyExpand } from './sections/Pilot'
import { AircraftItem } from './sections/AircraftSection'
import { WBExpand, DensityAltItem, PerfDistItem, CruiseItem } from './sections/Performance'
import { AirportItem, NotamItem } from './sections/Airport'
import { AlternatesItem, MetarItem } from './sections/Weather'
import { AltitudeItem, ChartsItem } from './sections/RouteAltitude'
import FlightPlanOnePager from './FlightPlanOnePager'

/* ── Checklist data ──────────────────────────────────────────── */
const CHECKLISTS = [
  {
    id: 'flight-plan',
    title: 'Flight Plan',
    tag: 'FLIGHT PLANNING',
    color: 'var(--text-secondary)',
    sections: [
      {
        title: 'EN ROUTE',
        num: 1,
        items: [
          { id: 'route', label: 'Route and Altitude', sub: 'Charts · Airspace · TFR · Overflight', expand: 'altitude', items: [
            { id: 'route-a', label: 'Charts', sub: 'Sectional · TAC · Chart Supplement', expand: 'charts' },
          ]},
          { id: 'wx', label: 'Weather', sub: 'PROG · METAR · TAF · AIRMET · SIGMET · Winds', expand: 'metar' },
          { id: 'alternates', label: 'Alternate(s)', sub: 'Distance · Weather · Fuel · IFR 1-2-3', expand: 'alternates' },
        ],
      },
      {
        title: 'PERFORMANCE',
        num: 2,
        items: [
          { id: 'wb',         label: 'Weight & Balance', sub: 'CG envelope · Longitudinal & lateral', expand: 'wb' },
          { id: 'perf-da',    label: 'Density Altitude', sub: 'Pressure Alt · ISA Deviation · Performance Impact', expand: 'densityalt' },
          { id: 'perf-dist',  label: 'Distances', sub: 'Takeoff · Landing · Accelerate-Stop · POH · Wind · Surface · Slope corrections', expand: 'perfdist' },
          { id: 'perf-cruise',label: 'Cruise & Fuel', sub: 'Speed · Time · Fuel Required · Endurance · GS · Winds Aloft · Go/No-Go', expand: 'cruise' },
        ],
      },
      {
        title: 'AIRPORT',
        num: 3,
        items: [
          { id: 'apt', label: 'Destination Airport', sub: 'Diagram · Charts · Services · NOTAM · FBO', expand: 'airport' },
        ],
      },
      {
        title: 'AIRCRAFT',
        num: 4,
        items: [
          { id: 'aircraft', label: 'Aircraft', sub: 'CARROW · Airworthiness · Fuel · Equipment', expand: 'aircraft' },
        ],
      },
      {
        title: 'PILOT',
        num: 5,
        items: [
          { id: 'pilot-imsafe',    label: 'IM SAFE',      sub: 'Illness · Medication · Stress · Alcohol · Fatigue · Eating', expand: 'imsafe' },
          { id: 'pilot-imcurrent', label: 'IM CURRENT',   sub: 'Flight review · Passenger currency · IFR currency',          expand: 'imcurrent' },
          { id: 'pilot-imvalid',   label: 'IM VALID',     sub: 'Medical certificate validity',                               expand: 'imvalid' },
          { id: 'pilot-airworthy', label: 'IM AIRWORTHY', sub: 'Annual · Transponder · Pitot-static',                        expand: 'imairworthy' },
          { id: 'pilot-fp',        label: 'Flight Itinerary', sub: 'Recap · Route · Weather · Performance · Pilot status', expand: 'recap' },
        ],
      },
    ],
  },
]

/* ── Flatten all item ids in a checklist ─────────────────────── */
function flattenIds(items) {
  const ids = []
  for (const item of items) {
    ids.push(item.id)
    if (item.items) ids.push(...flattenIds(item.items))
  }
  return ids
}

function allIds(checklist) {
  return checklist.sections.flatMap(s => flattenIds(s.items))
}

/* ── Sub label (plain text) ──────────────────────────────────── */
function SubPills({ sub, isChecked }) {
  if (!sub || isChecked) return null
  return (
    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 3 }}>
      {sub}
    </div>
  )
}

/* ── Root component ──────────────────────────────────────────── */
export default function Checklists() {
  return <ChecklistDetail checklist={CHECKLISTS[0]} />
}


/* ── Checklist detail — MTA Metro layout ────────────────────── */
function ChecklistDetail({ checklist, onBack }) {
  const [checked, setChecked]         = useState(new Set())
  const [customItems, setCustomItems] = useState({ PILOT: [] })
  const [resetKey, setResetKey]       = useState(0)
  const [onePagerOpen, setOnePagerOpen] = useState(false)
  const [addDrawerOpen, setAddDrawerOpen] = useState(false)
  const trackRef = useRef(null)
  const circleRefs = useRef([])

  const customTotal = Object.values(customItems).reduce((sum, arr) => sum + arr.length, 0)
  const total = allIds(checklist).length + customTotal

  useEffect(() => {
    get('checklists', checklist.id).then(saved => {
      if (saved?.checked) setChecked(new Set(saved.checked))
      if (saved?.custom)  setCustomItems(saved.custom)
    })
  }, [checklist.id])

  function save(nextChecked, nextCustom) {
    put('checklists', { id: checklist.id, checked: [...nextChecked], custom: nextCustom })
  }

  function toggle(id) {
    setChecked(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      save(next, customItems)
      return next
    })
  }

  // Wipes every per-flight input so the checklist is a blank slate for the next
  // flight. The only thing kept is the Route section's FROM field — that's the
  // home base, sourced separately from settings.homeAirport, and AltitudeItem
  // already falls back to it whenever settings.route has no saved departure.
  async function reset() {
    setChecked(new Set())
    save(new Set(), customItems)   // custom items persist across resets — they're a template
    setResetKey(k => k + 1)        // remount every item so cleared data shows immediately

    await Promise.all([
      del('settings', 'route'),
      del('settings', 'densityalt'),
      del('settings', 'perfdist'),
      del('settings', 'cruise'),
      del('settings', 'alternates'),
      del('settings', 'selectedRunway'),
      del('settings', 'lastWB'),
    ]).catch(() => {})

    ;['cruise_fuel_state', 'apt_fbo_freq', 'apt_fbo_note',
      'ac_maint_ac-annual', 'ac_maint_ac-100hr', 'ac_maint_ac-oil',
      'ac_maint_ac-elt', 'ac_maint_ac-xpdr', 'ac_maint_ac-pitot',
    ].forEach(key => localStorage.removeItem(key))

    try {
      const currency = await get('currency', 'profile')
      if (currency) await put('currency', { ...currency, safe: {} })
    } catch { /* ignore */ }
  }

  function deleteCustomItem(sectionTitle, itemId) {
    const next = { ...customItems, [sectionTitle]: customItems[sectionTitle].filter(i => i.id !== itemId) }
    const nextChecked = new Set(checked)
    nextChecked.delete(itemId)
    setCustomItems(next)
    setChecked(nextChecked)
    save(nextChecked, next)
  }

  // type: 'check' | 'text' | 'number'
  function addCustomItem(sectionTitle, label, type) {
    const item = { id: `custom-${Date.now()}`, label, type, value: '' }
    const next = { ...customItems, [sectionTitle]: [...(customItems[sectionTitle] ?? []), item] }
    setCustomItems(next)
    save(checked, next)
  }

  function updateCustomItemValue(sectionTitle, itemId, value) {
    const next = {
      ...customItems,
      [sectionTitle]: customItems[sectionTitle].map(i => i.id === itemId ? { ...i, value } : i),
    }
    setCustomItems(next)
    save(checked, next)
  }

  const done     = checked.size
  const pct      = total > 0 ? done / total : 0
  const complete = done === total

  function isSectionDone(section) {
    const builtIn = flattenIds(section.items).every(id => checked.has(id))
    const custom  = (customItems[section.title] ?? []).every(i => checked.has(i.id))
    return builtIn && custom
  }

  // Active section = first incomplete
  const activeSectionIdx = checklist.sections.findIndex(s => !isSectionDone(s))

  // Compute fill height by measuring actual DOM positions of each station circle.
  // Uses getBoundingClientRect so it's correct regardless of scroll, nesting, or card expansion.
  const [trainRatio, setTrainRatio] = useState(0)
  const [trackGeom, setTrackGeom] = useState({ top: 0, height: 0 })

  const recalcTrain = useCallback(() => {
    const track = trackRef.current
    if (!track) return
    const sections = checklist.sections
    const n = sections.length
    const circles = circleRefs.current.slice(0, n)
    if (circles.some(r => !r)) return

    // Get center-Y of each station circle relative to the track container top
    const trackTop = track.getBoundingClientRect().top
    const centerYs = circles.map(el => {
      const r = el.getBoundingClientRect()
      return r.top + r.height / 2 - trackTop
    })
    // The visual line spans from center of circle[0] to center of circle[n-1] —
    // it should not extend above the first circle or below the last one.
    const lineStart = centerYs[0]
    const lineEnd   = centerYs[n - 1]
    const lineH     = lineEnd - lineStart
    setTrackGeom({ top: lineStart, height: lineH })
    if (lineH <= 0) return

    // Find last fully-done section
    let lastDone = -1
    for (let i = 0; i < n; i++) {
      if (isSectionDone(sections[i])) lastDone = i
      else break
    }

    let targetY  // absolute target center-Y within track
    if (lastDone < 0) {
      // Nothing done: interpolate from circle[0] toward circle[1] by section-0 progress
      const items = flattenIds(sections[0].items)
      const frac  = items.length > 0 ? items.filter(id => checked.has(id)).length / items.length : 0
      const endY  = n > 1 ? centerYs[1] : lineEnd
      targetY = centerYs[0] + (endY - centerYs[0]) * frac
    } else if (lastDone === n - 1) {
      targetY = lineEnd
    } else {
      // Reached circle[lastDone+1]; advance into next segment by that section's progress
      const nextSec   = sections[lastDone + 1]
      const nextItems = flattenIds(nextSec.items)
      const nextFrac  = nextItems.length > 0 ? nextItems.filter(id => checked.has(id)).length / nextItems.length : 0
      const fromY = centerYs[lastDone + 1]
      const toY   = lastDone + 2 < n ? centerYs[lastDone + 2] : lineEnd
      targetY = fromY + (toY - fromY) * nextFrac
    }

    // Convert targetY to a ratio of the line segment (circle[0] to circle[n-1])
    setTrainRatio(Math.min(Math.max((targetY - lineStart) / lineH, 0), 1))
  }, [checked, checklist])

  useEffect(() => {
    // Small rAF delay so DOM has painted after state change
    const id = requestAnimationFrame(recalcTrain)
    return () => cancelAnimationFrame(id)
  }, [recalcTrain])

  // Expanding/collapsing any card inside the track (or its content loading in)
  // changes the track's height without changing `checked`/`checklist`, which
  // are the only things recalcTrain normally re-runs on. Without this, the
  // line's measured length goes stale and visually stops short of a circle
  // whose card is currently expanded. A ResizeObserver catches any such
  // layout change directly, regardless of what caused it.
  useEffect(() => {
    const track = trackRef.current
    if (!track || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => recalcTrain())
    observer.observe(track)
    return () => observer.disconnect()
  }, [recalcTrain])

  return (
    <div style={{ paddingBottom: 64 }}>
      {/* Header */}
      <div style={{ padding: '20px 16px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <BackButton onBack={onBack} />
        <h2 style={{ flex: 1, fontSize: 22, fontWeight: 700, letterSpacing: '-0.4px', color: 'var(--text)' }}>
          {checklist.title}
        </h2>
        <button onClick={reset} style={{
          fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)',
          background: 'var(--bg-card)', border: '0.5px solid var(--border)',
          borderRadius: 20, cursor: 'pointer', padding: '6px 14px', flexShrink: 0,
        }}>Reset</button>
      </div>

      {/* MTA Metro timeline */}
      <div ref={trackRef} style={{ padding: '24px 16px 0 16px', position: 'relative' }}>

        {/* Track — spans exactly from center of first circle to center of last */}
        <div style={{
          position: 'absolute', left: 30, top: trackGeom.top, height: trackGeom.height,
          width: 2, background: 'var(--border)', borderRadius: 1,
          marginLeft: -1,
        }} />

        {/* Fill — height driven by measured circle positions */}
        <div style={{
          position: 'absolute', left: 30, top: trackGeom.top,
          width: 2, marginLeft: -1,
          height: `${trainRatio * trackGeom.height}px`,
          background: 'var(--text)', borderRadius: 1,
          transition: 'height 0.55s cubic-bezier(0.4,0,0.2,1)',
        }} />

        {/* Sections */}
        {checklist.sections.map((section, si) => {
          const secDone  = isSectionDone(section)
          const isActive = si === activeSectionIdx
          const isLast   = si === checklist.sections.length - 1

          return (
            <div key={`${section.num}-${resetKey}`} style={{ marginBottom: isLast ? 0 : 4 }}>
              {/* Station row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 4 }}>
                {/* MTA-style station circle — ref'd for fill measurement */}
                <div ref={el => circleRefs.current[si] = el} style={{
                  width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                  background: secDone ? 'var(--text)' : 'var(--bg-card)',
                  border: `2px solid ${secDone ? 'var(--text)' : isActive ? 'var(--text)' : 'var(--border)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 800,
                  color: secDone ? 'var(--bg-card)' : isActive ? 'var(--text)' : 'var(--text-tertiary)',
                  position: 'relative', zIndex: 3,
                  transition: 'all 0.4s cubic-bezier(0.4,0,0.2,1)',
                }}>{section.num}</div>

                {/* Section title */}
                <div style={{ flex: 1 }}>
                  <span style={{
                    fontSize: isActive && !secDone ? 13 : 11,
                    fontWeight: secDone || isActive ? 700 : 500,
                    letterSpacing: '0.5px',
                    textTransform: 'uppercase',
                    color: secDone ? 'var(--text)' : isActive ? 'var(--text)' : 'var(--text-tertiary)',
                    transition: 'all 0.35s',
                  }}>{section.title}</span>
                </div>
              </div>

              {/* Items — indented past the station circle */}
              <div style={{ paddingLeft: 44, paddingBottom: isLast ? 0 : 20 }}>
                <MetroItems items={section.items} checked={checked} onToggle={toggle} depth={0} total={total} />

                {/* Custom items — pilot-added, any section */}
                {(customItems[section.title] ?? []).length > 0 && (
                  <>
                    {customItems[section.title].map(ci => (
                      <div key={ci.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', minHeight: 36 }}>
                        <button
                          onClick={() => toggle(ci.id)}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, minWidth: 0 }}
                        >
                          <div style={{
                            width: 7, height: 7, marginTop: 1, borderRadius: '50%', flexShrink: 0,
                            background: checked.has(ci.id) ? 'var(--text)' : 'transparent',
                            border: `1.5px solid ${checked.has(ci.id) ? 'var(--text)' : 'var(--border-strong)'}`,
                            transition: 'all 0.2s',
                          }} />
                          <span style={{
                            fontSize: 14, fontWeight: 500, lineHeight: 1.35,
                            color: checked.has(ci.id) ? 'var(--text-tertiary)' : 'var(--text)',
                            textDecoration: checked.has(ci.id) ? 'line-through' : 'none',
                            transition: 'color 0.2s',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>{ci.label}</span>
                        </button>
                        {(ci.type === 'text' || ci.type === 'number') && (
                          <input
                            type={ci.type === 'number' ? 'number' : 'text'}
                            inputMode={ci.type === 'number' ? 'decimal' : undefined}
                            value={ci.value ?? ''}
                            onChange={e => updateCustomItemValue(section.title, ci.id, e.target.value)}
                            placeholder="—"
                            style={{
                              width: 84, flexShrink: 0, fontSize: 13, textAlign: 'right',
                              background: 'var(--bg-card-2)', border: '0.5px solid var(--border)',
                              borderRadius: 8, padding: '5px 8px', color: 'var(--text)',
                              outline: 'none', fontFamily: 'inherit',
                            }}
                          />
                        )}
                        <button
                          onClick={() => deleteCustomItem(section.title, ci.id)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: '2px 4px', flexShrink: 0, display: 'flex', alignItems: 'center' }}
                        >
                          <svg width={11} height={11} viewBox="0 0 24 24" fill="none">
                            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                      </div>
                    ))}

                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Complete button ── */}
      <CompleteButton
        pct={pct}
        complete={complete}
        checklist={checklist}
        onComplete={() => setOnePagerOpen(true)}
        onAddStep={() => setAddDrawerOpen(true)}
      />

      {/* ── Flight Plan one-pager — shown before the checklist resets, so
          all the per-flight data it reads is still in IndexedDB. Closing it
          is what actually resets the checklist for the next flight. ── */}
      {onePagerOpen && (
        <FlightPlanOnePager onClose={() => { setOnePagerOpen(false); reset() }} />
      )}

      {/* ── Add custom item drawer ── */}
      {addDrawerOpen && (
        <AddItemDrawer
          sections={checklist.sections}
          onClose={() => setAddDrawerOpen(false)}
          onAdd={(sectionTitle, label, type) => {
            addCustomItem(sectionTitle, label, type)
            setAddDrawerOpen(false)
          }}
        />
      )}
    </div>
  )
}

function CompleteButton({ pct, complete, checklist, onComplete, onAddStep }) {
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)

  const handleComplete = async () => {
    if (!complete || saving || saved) return
    setSaving(true)

    try {
      // Pull everything the pilot filled in
      const [route, cruise, preset, acProfile] = await Promise.all([
        get('settings', 'route'),
        get('settings', 'cruise'),
        get('settings', 'aircraft_preset'),
        get('aircraft', 'profile'),
      ])

      const dep  = route?.dep  || ''
      const dest = route?.dest || ''
      const distNm      = route?.distNm ?? null
      const cruiseAlt   = cruise?.cruiseAlt ?? route?.cruiseAlt ?? null
      const flightRules = cruise?.flightRules || 'VFR'
      const tas         = parseFloat(cruise?.tas)   || null
      const burnRate    = parseFloat(cruise?.burnRate) || null
      const fuelOnBoard = parseFloat(cruise?.fuelOnBoard) || null
      const aircraft    = preset?.label || acProfile?.fullName || acProfile?.registration || ''
      const registration = acProfile?.registration || ''
      const category      = acProfile?.category === 'helicopter' ? 'helicopter' : 'airplane'

      // Flight time from cruise calculation
      let flightTimeH = null
      if (distNm && tas) flightTimeH = distNm / tas

      // Fuel required
      let fuelRequired = null
      if (flightTimeH && burnRate) fuelRequired = parseFloat((flightTimeH * burnRate).toFixed(1))

      const record = {
        id:           Date.now(),
        savedAt:      new Date().toISOString(),
        checklistId:  checklist.id,
        dep,
        dest,
        distNm,
        cruiseAlt,
        flightRules,
        tas,
        burnRate,
        fuelOnBoard,
        fuelRequired,
        flightTimeH:  flightTimeH ? parseFloat(flightTimeH.toFixed(2)) : null,
        aircraft,
        registration,
        category,
      }

      await put('flights', record)
    } catch (e) {
      // Save failed silently — don't block the pilot
    }

    setSaved(true)
    setSaving(false)

    // Brief moment to show the checkmark, then reset the checklist
    setTimeout(() => {
      onComplete()
      setSaved(false)
    }, 1200)
  }

  return (
    <div style={{ padding: '24px 16px 36px', display: 'flex', gap: 10 }}>
      {/* Add Step — opens the add-custom-item drawer */}
      <button
        onClick={onAddStep}
        style={{
          position: 'relative',
          flex: 1,
          height: 52,
          borderRadius: 14,
          border: 'none',
          cursor: 'pointer',
          overflow: 'hidden',
          background: 'var(--bg-card-2)',
          outline: 'none',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <span style={{
          fontSize: 15, fontWeight: 700, letterSpacing: '-0.2px',
          color: 'var(--text)',
        }}>
          + Add Step
        </span>
      </button>

      {/* Button shell — always present, bar fills inside it */}
      <button
        onClick={handleComplete}
        disabled={!complete || saving || saved}
        style={{
          position: 'relative',
          flex: 1,
          height: 52,
          borderRadius: 14,
          border: 'none',
          cursor: complete ? 'pointer' : 'default',
          overflow: 'hidden',
          background: complete ? 'var(--text)' : 'var(--bg-card-2)',
          transition: 'background 0.4s ease',
          outline: 'none',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        {/* Progress fill — grows left to right while not complete */}
        {!complete && (
          <div style={{
            position: 'absolute', inset: 0,
            width: `${pct * 100}%`,
            background: 'var(--border)',
            transition: 'width 0.4s ease',
            borderRadius: 14,
          }} />
        )}

        {/* Label */}
        <span style={{
          position: 'relative', zIndex: 1,
          fontSize: 15, fontWeight: 700, letterSpacing: '-0.2px',
          color: complete ? 'var(--bg)' : 'var(--text-tertiary)',
          transition: 'color 0.4s ease',
        }}>
          {saved
            ? 'Saved to Flights'
            : saving
            ? 'Saving...'
            : complete
            ? 'Complete Flight Plan'
            : 'Complete Flight Plan'}
        </span>
      </button>
    </div>
  )
}


const EXPAND_MAP = {
  wb:          WBExpand,
  imsafe:      IMSafeExpand,
  imcurrent:   IMCurrentExpand,
  imvalid:     IMValidExpand,
  imairworthy: IMAirworthyExpand,
  metar:      MetarItem,
  altitude:   AltitudeItem,
  densityalt: DensityAltItem,
  perfdist:   PerfDistItem,
  cruise:     CruiseItem,
  charts:     ChartsItem,
  alternates: AlternatesItem,
  notam:      NotamItem,
  overflight: OverflightItem,
  airport:    AirportItem,
  aircraft:   AircraftItem,
  oxygen:     OxygenItem,
  recap:      RecapItem,
}

/* ── Metro item rows ─────────────────────────────────────────── */
function MetroItems({ items, checked, onToggle, depth, total }) {
  return (
    <>
      {items.map(item => {
        const isChecked = checked.has(item.id)

        if (item.expand && EXPAND_MAP[item.expand]) {
          const ExpandComp = EXPAND_MAP[item.expand]
          return (
            <div key={item.id}>
              <ExpandComp item={item} isChecked={isChecked} onToggle={onToggle} checked={checked} total={total} />
              {item.items && (
                <MetroItems items={item.items} checked={checked} onToggle={onToggle} depth={0} total={total} />
              )}
            </div>
          )
        }

        return (
          <div key={item.id}>
            <button
              onClick={() => onToggle(item.id)}
              style={{
                width: '100%', textAlign: 'left', background: 'none', border: 'none',
                cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '5px 0', minHeight: 36,
              }}>
              {/* Dot — same size at every level */}
              <div style={{
                width: 7, height: 7, marginTop: 5,
                borderRadius: '50%', flexShrink: 0,
                background: isChecked ? 'var(--text)' : 'transparent',
                border: `1.5px solid ${isChecked ? 'var(--text)' : 'var(--border-strong)'}`,
                transition: 'all 0.2s',
              }} />
              {/* Label + optional subtitle */}
              <div style={{ flex: 1 }}>
                <div style={{
                  fontSize: 14, fontWeight: 500, lineHeight: 1.35,
                  color: isChecked ? 'var(--text-tertiary)' : 'var(--text)',
                  textDecoration: isChecked ? 'line-through' : 'none',
                  transition: 'color 0.2s',
                }}>
                  {item.label}
                </div>
                <SubPills sub={item.sub} isChecked={isChecked} />
              </div>
            </button>
            {item.items && (
              <MetroItems items={item.items} checked={checked} onToggle={onToggle} depth={0} total={total} />
            )}
          </div>
        )
      })}
    </>
  )
}

/* ── Add custom item drawer ──────────────────────────────────── */
const ITEM_TYPES = [
  { key: 'check',  label: 'Checkbox' },
  { key: 'text',   label: 'Text' },
  { key: 'number', label: 'Number' },
]

function AddItemDrawer({ sections, onClose, onAdd }) {
  const [sectionTitle, setSectionTitle] = useState(sections[0]?.title ?? '')
  const [label, setLabel] = useState('')
  const [type, setType] = useState('check')

  const canAdd = sectionTitle && label.trim().length > 0

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        zIndex: 1000, backdropFilter: 'blur(2px)',
      }} />
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1001, padding: '0 12px 20px' }}>
        <div style={{ borderRadius: 16, overflow: 'hidden', marginBottom: 8, background: 'var(--bg-card)' }}>
          <div style={{ padding: '16px 16px 4px' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 14, textAlign: 'center' }}>
              Add Custom Item
            </div>

            {/* Section picker */}
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 6 }}>
              Section
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {sections.map(s => (
                <button key={s.title} onClick={() => setSectionTitle(s.title)} style={{
                  padding: '7px 12px', borderRadius: 20, cursor: 'pointer',
                  fontSize: 12, fontWeight: 700, border: '0.5px solid',
                  borderColor: sectionTitle === s.title ? 'var(--text)' : 'var(--border)',
                  background: sectionTitle === s.title ? 'var(--text)' : 'var(--bg-card-2)',
                  color: sectionTitle === s.title ? 'var(--bg-card)' : 'var(--text-secondary)',
                  transition: 'all 0.15s',
                }}>{s.title}</button>
              ))}
            </div>

            {/* Label */}
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 6 }}>
              Item Label
            </div>
            <input
              value={label} onChange={e => setLabel(e.target.value)}
              placeholder="e.g. Check tie-downs"
              style={{
                width: '100%', boxSizing: 'border-box', marginBottom: 14,
                padding: '10px 12px', borderRadius: 10, border: '0.5px solid var(--border)',
                background: 'var(--bg-card-2)', color: 'var(--text)', fontSize: 14,
                outline: 'none', fontFamily: 'inherit',
              }}
            />

            {/* Type picker */}
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 6 }}>
              Input Type
            </div>
            <div style={{ display: 'flex', background: 'var(--bg-card-2)', borderRadius: 10, padding: 3, marginBottom: 16 }}>
              {ITEM_TYPES.map(t => (
                <button key={t.key} onClick={() => setType(t.key)} style={{
                  flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                  fontSize: 12, fontWeight: 700, transition: 'all 0.15s',
                  background: type === t.key ? 'var(--bg-card)' : 'transparent',
                  color: type === t.key ? 'var(--text)' : 'var(--text-tertiary)',
                }}>{t.label}</button>
              ))}
            </div>
          </div>

          <button
            onClick={() => canAdd && onAdd(sectionTitle, label.trim(), type)}
            disabled={!canAdd}
            style={{
              width: '100%', padding: '14px', border: 'none', cursor: canAdd ? 'pointer' : 'default',
              background: 'var(--accent)', color: 'var(--accent-fg)',
              fontSize: 15, fontWeight: 700, opacity: canAdd ? 1 : 0.5,
              borderTop: '0.5px solid var(--border)',
            }}
          >Add Item</button>
        </div>
        <button onClick={onClose} style={{
          width: '100%', padding: '14px', borderRadius: 14,
          background: 'var(--bg-card)', border: 'none', cursor: 'pointer',
          fontSize: 15, fontWeight: 700, color: 'var(--danger)',
        }}>Cancel</button>
      </div>
    </>
  )
}
