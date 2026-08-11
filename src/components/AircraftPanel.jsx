/* ── The top of the drawer ──────────────────────────────────────────────
   What a pilot needs to know about today before they need anything else: the
   aircraft, whether it is legal to fly, and whether they are.

   It used to be a picture and a name. A name is not a status, and the two
   questions a pilot actually answers on the way to the aircraft are "is it due
   for anything" and "am I current". Both are held elsewhere in this app and
   neither was on the screen that opens first, so both are here now, as the same
   coloured dots their own sections use rather than as a second vocabulary. ── */

import { useEffect, useState } from 'react'
import { get, put } from '../lib/db'
import { useMaintenanceItems } from '../hooks/useMaintenanceItems'
import { IconHelmet } from './Icons'

// The aircraft's own dot, rolled up from every maintenance item it carries.
// The WORST item wins, deliberately: an aircraft with one overdue inspection
// and nine clean ones is an aircraft that is overdue, and averaging that away
// would be the app telling a pilot what they would rather hear.
//
// Grey for unknown is not a hedge, it is the honest answer. An aircraft with no
// maintenance items entered has not been assessed, and a green dot would be a
// claim of airworthiness this app has no basis for.
function rollUp(groups, loading) {
  if (loading) return { color: 'rgba(255,255,255,0.28)', label: 'Checking' }
  if (groups.overdue?.length) return { color: 'var(--danger)', label: `${groups.overdue.length} overdue` }
  if (groups.dueSoon?.length) return { color: 'var(--warn)', label: `${groups.dueSoon.length} due soon` }
  if (groups.ok?.length) return { color: 'var(--ok)', label: 'Airworthy' }
  return { color: 'rgba(255,255,255,0.28)', label: 'Not tracked' }
}

function Dot({ color, size = 10 }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0, background: color,
      boxShadow: '0 0 0 1.5px rgba(255,255,255,0.5)',
    }} />
  )
}

const STATUS_COLOR = {
  expired:  'var(--danger)',
  expiring: 'var(--warn)',
  valid:    'var(--ok)',
}
function currencyColor(status) {
  return STATUS_COLOR[status] ?? 'rgba(255,255,255,0.35)'
}

export default function AircraftPanel({ ac, aircraftId, currencyCards, imgCap, textRef, onOpenAircraft, onOpenPilot }) {
  // The airframe total, typed rather than picked, so it is held as a draft and
  // written on blur. Writing on every keystroke would save "12" on the way to
  // "1234" and, worse, would fight the pilot's cursor as the record round-trips.
  const [draft, setDraft] = useState('')
  const [hobbs, setHobbs] = useState(null)

  useEffect(() => {
    if (!aircraftId) return
    let cancelled = false
    get('aircraft', aircraftId).then(row => {
      if (cancelled) return
      setHobbs(row?.hobbsTime ?? null)
      setDraft(row?.hobbsTime == null ? '' : String(row.hobbsTime))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [aircraftId])

  async function commit() {
    if (!aircraftId) return
    const trimmed = draft.trim()
    const val = trimmed === '' ? null : parseFloat(trimmed)
    if (trimmed !== '' && Number.isNaN(val)) { setDraft(hobbs == null ? '' : String(hobbs)); return }
    if (val === hobbs) return
    const row = await get('aircraft', aircraftId).catch(() => null)
    await put('aircraft', { ...(row ?? {}), id: aircraftId, hobbsTime: val, hobbsUpdatedAt: Date.now() })
      .catch(() => {})
    setHobbs(val)
  }

  // Fed the airframe total so hour-based items know how far off they are. An
  // item due at 2400 hours means nothing without knowing the aircraft is at
  // 2380.
  const { loading, ...groups } = useMaintenanceItems(aircraftId, hobbs, null)
  const health = rollUp(groups, loading)

  return (
    <div>
      {/* The aircraft itself, still the top of the drawer and still a door into
          the Hangar. */}
      <button onClick={onOpenAircraft} style={{
        display: 'block', width: '100%', textAlign: 'left', padding: 0,
        border: 'none', background: 'none', cursor: 'pointer',
      }}>
        {ac?.image ? (
          <img src={ac.image} alt="" style={{
            display: 'block', width: '100%', maxHeight: imgCap,
            objectFit: 'contain', marginBottom: 10,
          }} />
        ) : (
          // A custom aircraft is saved with no photograph and its name matches
          // no template. That is a legitimate aircraft, not a broken one: it
          // gets a silhouette of the right kind rather than a gap.
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: Math.min(150, imgCap), marginBottom: 10,
          }}>
            <img src={ac?.category === 'helicopter' ? '/helicopter.png' : '/modo-avion.png'} alt=""
              style={{ width: 96, height: 96, objectFit: 'contain', opacity: 0.22, filter: 'var(--icon-filter)' }} />
          </div>
        )}

        {/* The registration is the aircraft's name in the way a pilot uses it:
            on the radio, in the logbook, on the plan. Its maintenance dot rides
            with it, because "which aircraft" and "is it due" are one question
            asked twice.

            Measured, because the drawer sizes the picture above from whatever
            the text below it needs: without this the image cap is computed
            against a height of zero and the photograph pushes the registration
            off the bottom of the sheet. */}
        <div ref={textRef}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            fontSize: 26, fontWeight: 800, color: 'var(--map-ink)',
            letterSpacing: ac?.registration ? '0.5px' : '-0.7px', lineHeight: 1.1,
            textTransform: ac?.registration ? 'uppercase' : 'none',
          }}>
            {ac?.registration || ac?.fullName || 'No aircraft set'}
          </div>
          {ac && <Dot color={health.color} size={12} />}
        </div>
        {ac && (
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--map-ink-faint)', marginTop: 4 }}>
            {ac.fullName ? `${ac.fullName} · ${health.label}` : health.label}
          </div>
        )}
        </div>
      </button>

      {ac && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
          {/* Airframe time, editable here because this is the number that goes
              stale fastest and the one every hour-based maintenance item is
              measured against. Typing it in the Hangar meant opening the Hangar
              to answer a question the drawer was already asking. */}
          <label style={{
            flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--map-fill-soft)', borderRadius: 14, padding: '10px 12px',
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--map-ink-faint)',
              textTransform: 'uppercase', letterSpacing: '0.4px', flexShrink: 0 }}>
              Airframe
            </span>
            <input
              type="number" inputMode="decimal" step="0.1" placeholder="0.0"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
              // The sheet reads a pointer anywhere on it as a drag. Without
              // this the field cannot be focused: the gesture is taken before
              // the tap lands.
              onPointerDown={e => e.stopPropagation()}
              style={{
                flex: 1, minWidth: 0, width: '100%', border: 'none', background: 'none', outline: 'none',
                fontSize: 15, fontWeight: 800, color: 'var(--map-ink)',
                fontVariantNumeric: 'tabular-nums', textAlign: 'right',
              }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--map-ink-faint)', flexShrink: 0 }}>hrs</span>
          </label>

          {/* The pilot, next to the aircraft, because a legal aeroplane and an
              illegal pilot is still a flight that is not happening. Same two
              dots the Pilot row carries, in the same order. */}
          <button onClick={onOpenPilot} aria-label="Open pilot" style={{
            display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
            background: 'var(--map-fill-soft)', border: 'none', borderRadius: 14,
            padding: '10px 12px', cursor: 'pointer',
          }}>
            <span style={{ display: 'flex', color: 'var(--map-ink)' }}><IconHelmet size={20} /></span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <Dot color={currencyColor(currencyCards?.current.status)} />
              <Dot color={currencyColor(currencyCards?.valid.status)} />
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
