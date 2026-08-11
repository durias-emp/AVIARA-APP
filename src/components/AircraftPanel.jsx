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

export default function AircraftPanel({ ac, aircraftId, currencyCards, textRef, onOpenAircraft, onOpenPilot }) {
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

  const thumb = ac?.image || (ac?.category === 'helicopter' ? '/helicopter.png' : '/modo-avion.png')
  const plain = !ac?.image

  return (
    <div ref={textRef}>
      {/* Two equal faces, aircraft on the left and pilot on the right, each a
          door to the section it stands for.

          This replaced a photograph running the full width of the sheet. The
          picture was the nicest thing on the screen and also the reason the
          action row had to shrink onto a floating card at half height: it took
          the room. An identity strip says the same things (which aircraft,
          is it due, am I current) in a fraction of the height, which is what
          buys the buttons their place back. */}
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 10 }}>
        <button onClick={onOpenAircraft} aria-label="Open this aircraft" style={{
          flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 11,
          background: 'var(--map-fill-soft)', border: 'none', borderRadius: 16,
          padding: '11px 12px', cursor: 'pointer', textAlign: 'left',
        }}>
          <img src={thumb} alt="" style={{
            width: 46, height: 46, objectFit: 'contain', flexShrink: 0,
            // A silhouette is a stand-in and is drawn as one. A photograph is
            // the aircraft and gets its own colours.
            opacity: plain ? 0.3 : 1,
            filter: plain ? 'var(--icon-filter)' : 'none',
          }} />
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{
                fontSize: 18, fontWeight: 800, color: 'var(--map-ink)',
                letterSpacing: ac?.registration ? '0.5px' : '-0.3px',
                textTransform: ac?.registration ? 'uppercase' : 'none',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {ac?.registration || ac?.fullName || 'No aircraft'}
              </span>
              {ac && <Dot color={health.color} />}
            </span>
            <span style={{
              display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--map-ink-faint)',
              marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {ac ? (ac.fullName && ac.registration ? ac.fullName : health.label) : 'Tap to add one'}
            </span>
          </span>
        </button>

        <button onClick={onOpenPilot} aria-label="Open pilot" style={{
          flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 11,
          background: 'var(--map-fill-soft)', border: 'none', borderRadius: 16,
          padding: '11px 12px', cursor: 'pointer', textAlign: 'left',
        }}>
          <span style={{
            width: 46, height: 46, flexShrink: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center', color: 'var(--map-ink)',
          }}>
            <IconHelmet size={30} />
          </span>
          <span style={{ minWidth: 0 }}>
            <span style={{
              display: 'block', fontSize: 18, fontWeight: 800, color: 'var(--map-ink)',
              letterSpacing: '-0.3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>Pilot</span>
            {/* The same two dots the Pilot row carries, in the same order, so
                one glance answers currency and medical without opening it. */}
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
              <Dot color={currencyColor(currencyCards?.current.status)} size={9} />
              <Dot color={currencyColor(currencyCards?.valid.status)} size={9} />
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--map-ink-faint)' }}>
                Currency · Medical
              </span>
            </span>
          </span>
        </button>
      </div>

      {ac && (
        // Airframe time, editable here because this is the number that goes
        // stale fastest and the one every hour-based maintenance item is
        // measured against.
        <label style={{
          display: 'flex', alignItems: 'center', gap: 8, marginTop: 10,
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
            // The sheet reads a pointer anywhere on it as a drag. Without this
            // the field cannot be focused: the gesture is taken before the tap
            // lands.
            onPointerDown={e => e.stopPropagation()}
            style={{
              flex: 1, minWidth: 0, width: '100%', border: 'none', background: 'none', outline: 'none',
              fontSize: 15, fontWeight: 800, color: 'var(--map-ink)',
              fontVariantNumeric: 'tabular-nums', textAlign: 'right',
            }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--map-ink-faint)', flexShrink: 0 }}>hrs</span>
        </label>
      )}
    </div>
  )
}
