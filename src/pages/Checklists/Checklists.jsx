import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { HomeButton } from '../../components/Shell'
import { get, put, del } from '../../lib/db'
import { trackEvent } from '../../lib/analytics'
import { scopedSettingsKey } from '../../lib/aircraft'
import { useActiveAircraft } from '../../context/ActiveAircraft'
import ChecklistTabShell from './ChecklistTabShell'
import FlightPlanOnePager from './FlightPlanOnePager'
import FlightPlanTypePicker from './FlightPlanTypePicker'
import SplitFlapTitle from './shared/SplitFlapTitle'
import { PlannerHostContext } from './shared/PlannerHost'

const TITLE_INTRO_MS = 3000    // how long "Flight Plan" shows before switching to the active step
const TITLE_CYCLE_MS = 60000   // how often it flashes back to "Flight Plan"

/* ── Checklist data ──────────────────────────────────────────── */
const CHECKLISTS = [
  {
    id: 'flight-plan',
    title: 'Flight Plan',
    tag: 'FLIGHT PLANNING',
    color: 'var(--text-secondary)',
    sections: [
      {
        title: 'ROUTE',
        num: 1,
        items: [
          { id: 'route', label: 'Route and Altitude', sub: 'Charts · Airspace · TFR · Overflight', expand: 'altitude' },
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
          { id: 'apt', label: 'Airports', sub: 'Destination · En route · Diagram · Services · NOTAM', expand: 'airport' },
          // Moved here from the route section: these are the published charts
          // and the Chart Supplement for the fields, which is airport work.
          // The id is unchanged, so anyone who had already ticked it keeps it.
          { id: 'route-a', label: 'Charts', sub: 'Sectional · TAC · Chart Supplement', expand: 'charts' },
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

// Renders a full-screen overlay against the body instead of in place, for the
// hosts where "in place" is inside something the browser has transformed.
function portalIf(embedded, node) {
  return embedded ? createPortal(node, document.body) : node
}

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

/* ── Root component ──────────────────────────────────────────── */
//
// Two hosts, one planner. Standalone at /checklists it owns the screen;
// embedded it fills whatever box the map home's drawer gives it, and reports
// a calculated route back so the drawer can drop down and show the line.
export default function Checklists({ embedded = false, onClose, onRouteCalculated }) {
  return (
    <ChecklistDetail
      checklist={CHECKLISTS[0]}
      embedded={embedded}
      onBack={onClose}
      onRouteCalculated={onRouteCalculated}
    />
  )
}


/* ── Checklist detail: full-screen tabbed steps ─────────────── */
function ChecklistDetail({ checklist, onBack, embedded = false, onRouteCalculated }) {
  const { aircraftId } = useActiveAircraft()
  const [checked, setChecked]         = useState(new Set())
  const [customItems, setCustomItems] = useState({ PILOT: [] })
  const [resetKey, setResetKey]       = useState(0)
  const [onePagerOpen, setOnePagerOpen] = useState(false)
  const [addDrawerOpen, setAddDrawerOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  // Flight-plan-type picker (VFR/IFR + Local/Cross Country). Gates entry to
  // the checklist. `undefined` = not yet loaded from storage (render nothing
  // to avoid a flash of the picker before we know), `null` = loaded and not
  // yet picked, an object = picked and persisted until Reset.
  const [flightPlanType, setFlightPlanType] = useState(undefined)

  useEffect(() => {
    get('settings', 'flightPlanType').then(saved => {
      setFlightPlanType(saved?.value ?? null)
    })
  }, [checklist.id])

  function pickFlightPlanType(value) {
    setFlightPlanType(value)
    put('settings', { key: 'flightPlanType', value })
  }

  const customTotal = Object.values(customItems).reduce((sum, arr) => sum + arr.length, 0)
  const total = allIds(checklist).length + customTotal

  // Header title: shows "Flight Plan" for the first few seconds, then the
  // active step's name, and periodically flashes back to "Flight Plan" for
  // a few seconds as an ambient reminder of what's currently in progress.
  const [headerTitle, setHeaderTitle] = useState(checklist.title)
  const introDoneRef = useRef(false)
  const activeIndexRef = useRef(activeIndex)

  useEffect(() => { activeIndexRef.current = activeIndex }, [activeIndex])

  // Where the title settles after the intro flip: the VFR/IFR/Local picker
  // shows "Flight Type" (nothing to pick a step from yet), the checklist
  // shows the active step's name, and "loading from storage" (undefined)
  // has no settled state. The intro effect below skips it entirely.
  useEffect(() => {
    if (flightPlanType === undefined) { introDoneRef.current = false; setHeaderTitle(checklist.title); return }
    const introTimer = setTimeout(() => {
      introDoneRef.current = true
      setHeaderTitle(flightPlanType === null ? 'Flight Type' : (checklist.sections[activeIndexRef.current]?.title ?? checklist.title))
    }, TITLE_INTRO_MS)
    return () => clearTimeout(introTimer)
  }, [checklist, flightPlanType])

  useEffect(() => {
    if (!introDoneRef.current || flightPlanType === null) return
    setHeaderTitle(checklist.sections[activeIndex]?.title ?? checklist.title)
  }, [activeIndex, checklist, flightPlanType])

  useEffect(() => {
    if (flightPlanType === undefined) return
    const cycle = setInterval(() => {
      if (!introDoneRef.current) return
      setHeaderTitle(checklist.title)
      setTimeout(() => {
        setHeaderTitle(flightPlanType === null ? 'Flight Type' : (checklist.sections[activeIndexRef.current]?.title ?? checklist.title))
      }, TITLE_INTRO_MS)
    }, TITLE_CYCLE_MS)
    return () => clearInterval(cycle)
  }, [checklist, flightPlanType])

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
  // flight. The only thing kept is the Route section's FROM field. That's the
  // home base, sourced separately from settings.homeAirport, and AltitudeItem
  // already falls back to it whenever settings.route has no saved departure.
  async function reset() {
    setChecked(new Set())
    save(new Set(), customItems)   // custom items persist across resets. They're a template
    setResetKey(k => k + 1)        // remount every item so cleared data shows immediately
    setFlightPlanType(null)        // back to the VFR/IFR + Local/XC picker for the next flight

    await Promise.all([
      del('settings', 'route'),
      del('settings', 'densityalt'),
      del('settings', scopedSettingsKey('perfdist', aircraftId)),
      del('settings', scopedSettingsKey('cruise', aircraftId)),
      del('settings', 'alternates'),
      del('settings', 'selectedRunway'),
      del('settings', scopedSettingsKey('lastWB', aircraftId)),
      del('settings', 'flightPlanType'),
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

  // Only the embedded planner has a host to talk to. Standalone this stays
  // null, and usePlannerHost's consumers fall back to doing nothing.
  const plannerHost = useMemo(
    () => (embedded ? { embedded: true, onRouteCalculated, onClose: onBack } : null),
    [embedded, onRouteCalculated, onBack],
  )

  // The container below is pinned to the viewport rather than sized by its
  // ancestors. The pane inside it can only scroll if its height is definite,
  // and previously that height arrived through a six-link chain of flex rules.
  // #root, the app shell, <main>, that div, the tab shell, the pane, any one
  // of which failing quietly let the pane stretch to its content, at which
  // point there is no overflow and nothing scrolls. That failure was observed
  // in the field (pane 1,762 px tall in a 696 px viewport) without being
  // reproducible locally, which is exactly the behaviour of a layout that
  // depends on everything above it. position:fixed depends on nothing.
  // The body's safe-area padding doesn't reach a fixed child, so the top
  // inset is re-applied there; the fixed footer already handles the bottom.
  //
  // Embedded, it cannot be fixed: it has to be the size of the drawer, not
  // the size of the screen. The chain of heights that made the standalone
  // version fragile is only two links long there (the drawer sets a definite
  // height, this fills it), and the drawer sits below the notch already, so
  // there is no top inset to re-apply.
  return (
    <PlannerHostContext.Provider value={plannerHost}>
    <div style={embedded
      ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg)' }
      : {
        position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
        paddingTop: 'var(--safe-top)', background: 'var(--bg)',
      }}>
      {/* Header. Tighter embedded: the drawer's own handle sits directly
          above it, and the standalone screen's breathing room would push the
          first card off a half-height drawer. */}
      <div style={{
        padding: embedded ? '4px 16px 8px' : '20px 16px 12px',
        display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
      }}>
        <HomeButton onBack={onBack} />
        <h2 style={{ flex: 1, fontSize: embedded ? 18 : 22, fontWeight: 700, letterSpacing: '-0.4px', color: 'var(--text)', margin: 0 }}>
          <SplitFlapTitle text={headerTitle} />
        </h2>
        {flightPlanType !== null && (
          <button onClick={reset} style={{
            fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)',
            background: 'var(--bg-card)', borderRadius: 20, cursor: 'pointer', padding: '6px 14px', flexShrink: 0,
          }}>Reset</button>
        )}
      </div>

      {flightPlanType === null && (
        <FlightPlanTypePicker onComplete={pickFlightPlanType} />
      )}

      {flightPlanType && (
      <ChecklistTabShell
        embedded={embedded}
        sections={checklist.sections}
        resetKey={resetKey}
        checked={checked}
        onToggle={toggle}
        total={total}
        customItems={customItems}
        onDeleteCustomItem={deleteCustomItem}
        onUpdateCustomItemValue={updateCustomItemValue}
        activeIndex={activeIndex}
        onActiveIndexChange={setActiveIndex}
        completeBar={
          <CompleteButton
            pct={pct}
            complete={complete}
            checklist={checklist}
            onComplete={() => setOnePagerOpen(true)}
            onAddStep={() => setAddDrawerOpen(true)}
          />
        }
      />
      )}

      {/* ── Flight Plan one-pager. Shown before the checklist resets, so
          all the per-flight data it reads is still in IndexedDB. Closing it
          is what actually resets the checklist for the next flight.

          Both of these cover the whole screen with position:fixed, which only
          means the screen while no ancestor is transformed. Embedded in the
          map home's drawer one is, so they are lifted out to the body, where
          fixed means what they were written to assume. Standalone they are
          left exactly where they were rather than portalled for symmetry:
          that path works today and is not worth re-proving. ── */}
      {onePagerOpen && portalIf(embedded,
        <FlightPlanOnePager onClose={() => { setOnePagerOpen(false); reset() }} />
      )}

      {/* ── Add custom item drawer ── */}
      {addDrawerOpen && portalIf(embedded,
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
    </PlannerHostContext.Provider>
  )
}

function CompleteButton({ pct, complete, checklist, onComplete, onAddStep }) {
  const { aircraftId } = useActiveAircraft()
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)

  const handleComplete = async () => {
    if (!complete || saving || saved) return
    setSaving(true)

    try {
      // Pull everything the pilot filled in
      const [route, cruise, preset, acProfile] = await Promise.all([
        get('settings', 'route'),
        get('settings', scopedSettingsKey('cruise', aircraftId)),
        get('settings', 'aircraft_preset'),
        aircraftId ? get('aircraft', aircraftId) : null,
      ])

      const dep  = route?.dep  || ''
      const dest = route?.dest || ''
      const distNm      = route?.distNm ?? null
      const cruiseAlt   = route?.cruiseAlt ?? null
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
      trackEvent('checklist_completed', { checklistId: checklist.id, dep, dest })
    } catch (e) {
      // Save failed silently: don't block the pilot
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
    <div style={{
      padding: '12px 16px', display: 'flex', gap: 10, flexShrink: 0,
      background: 'var(--bg-card)',
    }}>
      {/* Add Step: opens the add-custom-item drawer */}
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

      {/* Button shell, always present, bar fills inside it */}
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
        {/* Progress fill: grows left to right while not complete */}
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
  // Mounts off-screen (translateY 100%) and slides up on the next frame, so
  // the drawer arrives from the bottom instead of just appearing in place.
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [])

  function handleClose() {
    setVisible(false)
    setTimeout(onClose, 260)
  }

  const canAdd = sectionTitle && label.trim().length > 0

  return (
    <>
      <div onClick={handleClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        zIndex: 1000, backdropFilter: 'blur(2px)',
        opacity: visible ? 1 : 0, transition: 'opacity 0.28s ease',
      }} />
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1001, padding: '0 12px 20px',
        transform: visible ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 0.32s cubic-bezier(0.4,0,0.2,1)',
      }}>
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
                padding: '10px 12px', borderRadius: 10, background: 'var(--bg-card-2)', color: 'var(--text)', fontSize: 16,
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
        <button onClick={handleClose} style={{
          width: '100%', padding: '14px', borderRadius: 14,
          background: 'var(--bg-card)', border: 'none', cursor: 'pointer',
          fontSize: 15, fontWeight: 700, color: 'var(--danger)',
        }}>Cancel</button>
      </div>
    </>
  )
}
