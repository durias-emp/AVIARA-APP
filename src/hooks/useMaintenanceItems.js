import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

/* The maintenance status engine, ported from Diego's CNA OpsBoard.
   Nothing here writes: an item stores the absolute hours, cycles and date at
   which it falls due, and how far away that is gets computed at render time
   against the aircraft's current counters. So flying the aeroplane moves every
   countdown without touching a single maintenance row.

   One change from the original. It took `hobbsCurrent ?? 0`, which meant an
   aircraft with no airframe time recorded compared every due figure against
   zero — and a 100-hour inspection due at 1,250 hours read as "1,250 hours
   remaining", green, on an airframe that might be an hour overdue. An unknown
   counter is not a counter of zero. Items whose clocks cannot be read now say
   so instead. */

const WARN_HOURS_STANDARD = 10    // items with interval < 1500 hrs
const WARN_HOURS_HEAVY    = 50    // items with interval >= 1500 hrs
const WARN_MONTHS         = 1
const WARN_CYCLES         = 100

export const STATUS = Object.freeze({
  OVERDUE:        'overdue',
  DUE_SOON:       'due_soon',
  OK:             'ok',
  ON_CONDITION:   'on_condition',
  NOT_APPLICABLE: 'not_applicable',
  UNKNOWN:        'unknown',
})

function monthsRemaining(dueDateStr) {
  if (!dueDateStr) return null
  const due = new Date(dueDateStr + 'T12:00:00')
  if (isNaN(due)) return null
  const now = new Date()
  // Simple month count, matching how the maintenance sheet is read
  return (due.getFullYear() - now.getFullYear()) * 12 + (due.getMonth() - now.getMonth())
}

function isDateOverdue(dueDateStr) {
  if (!dueDateStr) return false
  const due = new Date(dueDateStr + 'T12:00:00')
  return !isNaN(due) && due < new Date()
}

// "TRACK:acRef:ohRef" notes carry airframe/overhaul reference offsets
function parseTrackRefs(notes) {
  if (!notes?.startsWith('TRACK:')) return null
  const [, acStr, ohStr] = notes.split(':')
  const acRef = parseFloat(acStr)
  const ohRef = parseFloat(ohStr)
  if (isNaN(acRef) || isNaN(ohRef)) return null
  return { acRef, ohRef }
}

function computeStatus(item, remaining, unreadable) {
  if (item.notes?.startsWith('N/A')) return STATUS.NOT_APPLICABLE
  if (item.limit_type === 'ON_CONDITION') return STATUS.ON_CONDITION

  const { hrsRemaining, cycsRemaining, mthsRemaining } = remaining

  // A clock this item is governed by, that we have no counter for. The date
  // clock may still be readable, so an overdue date is still worth reporting —
  // but "not yet due" cannot be claimed while a clock is unread.
  const dateOverdue = isDateOverdue(item.due_date)
  if (unreadable && !dateOverdue) return STATUS.UNKNOWN

  const hoursOverdue  = hrsRemaining  != null && hrsRemaining  <= 0
  const cyclesOverdue = cycsRemaining != null && cycsRemaining <= 0
  if (hoursOverdue || cyclesOverdue || dateOverdue) return STATUS.OVERDUE

  // Heavier intervals get a wider warning band
  const warnHrs = (item.hours_interval != null && item.hours_interval >= 1500)
    ? WARN_HOURS_HEAVY : WARN_HOURS_STANDARD

  const hoursDueSoon  = hrsRemaining  != null && hrsRemaining  <= warnHrs
  const cyclesDueSoon = cycsRemaining != null && cycsRemaining <= WARN_CYCLES
  const dateDueSoon   = mthsRemaining != null && mthsRemaining <= WARN_MONTHS
  if (hoursDueSoon || cyclesDueSoon || dateDueSoon) return STATUS.DUE_SOON

  return STATUS.OK
}

function enrichItem(item, hobbsCurrent, cyclesCurrent) {
  const haveHobbs  = Number.isFinite(hobbsCurrent)
  const haveCycles = Number.isFinite(cyclesCurrent)

  // Which of this item's clocks we cannot read, and therefore must not score
  const missing = []
  if (item.due_at_hours  != null && !haveHobbs)  missing.push('airframe hours')
  if (item.due_at_cycles != null && !haveCycles) missing.push('cycles')

  const hrsRemaining = item.due_at_hours != null && haveHobbs
    ? Math.round((item.due_at_hours - hobbsCurrent) * 10) / 10 : null
  const cycsRemaining = item.due_at_cycles != null && haveCycles
    ? item.due_at_cycles - cyclesCurrent : null
  const mthsRemaining = monthsRemaining(item.due_date)

  const status = computeStatus(
    item, { hrsRemaining, cycsRemaining, mthsRemaining }, missing.length > 0)

  // Running totals for ON_CONDITION items tracked against a reference point
  let trackAcHours = null
  let trackOhHours = null
  const refs = parseTrackRefs(item.notes)
  if (refs && item.last_complied_hours != null && haveHobbs) {
    const flownSince = hobbsCurrent - item.last_complied_hours
    trackAcHours = Math.round((refs.acRef + flownSince) * 10) / 10
    trackOhHours = Math.round((refs.ohRef + flownSince) * 10) / 10
  }

  return { ...item, status, hrsRemaining, cycsRemaining, mthsRemaining,
    trackAcHours, trackOhHours, missingCounters: missing }
}

export function useMaintenanceItems(aircraftId, hobbsCurrent, cyclesCurrent) {
  const [items, setItems]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const fetchSeq = useRef(0)   // guards against out-of-order responses

  const load = useCallback(async () => {
    if (!aircraftId) { setItems([]); setLoading(false); return }
    const seq = ++fetchSeq.current
    setLoading(true)
    setError(null)

    const { data, error: err } = await supabase
      .from('maintenance_items')
      .select('*')
      .eq('aircraft_id', aircraftId)
      .eq('is_active', true)
      .order('description')

    if (seq !== fetchSeq.current) return   // a newer request overtook this one

    if (err) setError(err.message)
    else setItems(data ?? [])
    setLoading(false)
  }, [aircraftId])

  useEffect(() => { load() }, [load])

  // Re-scored whenever the counters move; no re-fetch involved
  const enriched = useMemo(
    () => items.map(i => enrichItem(i, hobbsCurrent, cyclesCurrent)),
    [items, hobbsCurrent, cyclesCurrent]
  )

  const groups = useMemo(() => ({
    overdue:       enriched.filter(i => i.status === STATUS.OVERDUE),
    dueSoon:       enriched.filter(i => i.status === STATUS.DUE_SOON),
    ok:            enriched.filter(i => i.status === STATUS.OK),
    unknown:       enriched.filter(i => i.status === STATUS.UNKNOWN),
    onCondition:   enriched.filter(i => i.status === STATUS.ON_CONDITION),
    notApplicable: enriched.filter(i => i.status === STATUS.NOT_APPLICABLE),
  }), [enriched])

  return { items: enriched, ...groups, loading, error, refresh: load }
}
