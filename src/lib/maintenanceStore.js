// The maintenance schedule, on the device.
//
// Local rather than in Postgres, and that is a decision rather than an
// omission. Every other thing a pilot owns in this app (aircraft, flights,
// currency, checklists) lives in IndexedDB and is backed up to the cloud as a
// blob; only the social features are relational. A pilot checking whether the
// 100-hour is due is usually standing at the aircraft, which is exactly where
// there is no signal, so a maintenance page that needs a network round trip is
// blank at the one moment it is wanted.
//
// It also sidesteps a type mismatch. The relational version keys items by
// `aircraft_id uuid`, but this app's aircraft ids look like
// `aircraft-1786115925057-9`, which is not a uuid and cannot be stored in that
// column at all.

import { getAll, put, del, transact } from './db'

// Same shape as every other id in this app: sortable by creation time and
// unique enough for a device that is the only writer of these rows.
const newId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

const ITEMS = 'maintenanceItems'
const LOG = 'complianceLog'

// Every item on one aircraft's schedule, newest state first.
export async function loadItems(aircraftId) {
  if (!aircraftId) return []
  const rows = await getAll(ITEMS).catch(() => [])
  return rows.filter(r => r.aircraftId === aircraftId && !r.deletedAt && r.isActive !== false)
}

export async function loadLog(aircraftId, itemId = null) {
  const rows = await getAll(LOG).catch(() => [])
  return rows
    .filter(r => r.aircraftId === aircraftId && (itemId == null || r.itemId === itemId))
    .sort((a, b) => (b.compliedDate ?? '').localeCompare(a.compliedDate ?? ''))
}

export async function saveItem(item) {
  const row = { ...item, id: item.id ?? newId('mx'), updatedAt: Date.now() }
  await put(ITEMS, row)
  return row
}

// Removed from the schedule, not from history. The compliance log keeps every
// row that ever referred to it, because what was done to an aircraft does not
// stop having happened when the schedule is tidied.
export async function removeItem(id) {
  const rows = await getAll(ITEMS).catch(() => [])
  const row = rows.find(r => r.id === id)
  if (row) await put(ITEMS, { ...row, deletedAt: Date.now() })
}

// Rolling an item forward, and the record that says why.
//
// Two writes that must both happen or neither: the audit row that says the
// work was done, and the item's new due values. The original does it in a
// Postgres function so a failure between them cannot leave the schedule
// claiming an inspection is complied with when nothing recorded it, or the
// reverse. An IndexedDB transaction across both stores gives the same
// guarantee, which is what Section 8 of the handoff asks for when the backend
// is not Postgres.
//
// The roll forward is measured from the COMPLIED values, not from the old due
// values. That is how a real sheet works and it self-corrects: an inspection
// done fifty hours early sets the next one a hundred hours from where it was
// actually done, rather than compounding the error.
export async function logCompliance(item, {
  workOrder, compliedDate, compliedHours, compliedCycles, notes,
  // A retirement replaces a part rather than servicing one, so the new part
  // brings its own identity and its own remaining life.
  replacement = null,
} = {}) {
  const entry = {
    id: newId('mxlog'),
    itemId: item.id,
    aircraftId: item.aircraftId,
    description: item.description,
    workOrder: workOrder?.trim() || null,
    compliedDate,
    compliedHours: compliedHours ?? null,
    compliedCycles: compliedCycles ?? null,
    notes: notes?.trim() || null,
    // What came off and what went on, when this was a life-limited part.
    replacedPartNumber: replacement ? (item.partNumber ?? null) : null,
    replacedSerialNumber: replacement ? (item.serialNumber ?? null) : null,
    fittedPartNumber: replacement?.partNumber ?? null,
    fittedSerialNumber: replacement?.serialNumber ?? null,
    createdAt: Date.now(),
  }

  const next = rollForward(item, { compliedDate, compliedHours, compliedCycles, replacement })

  await transact([ITEMS, LOG], 'readwrite', (tx) => Promise.all([
    tx.objectStore(LOG).put(entry),
    tx.objectStore(ITEMS).put(next),
  ]))
  return { entry, item: next }
}

// The new due values after compliance.
//
// For an inspection: complied value plus the interval, on whichever clocks the
// item actually has. A clock with no interval keeps whatever it had, because
// an item due on a fixed date with no recurrence is complied with once and
// then simply done.
//
// For a retirement: the fitted part's own remaining life decides, because the
// part that just went on is a different part. Its life is counted from its own
// time in service, which for a new part is zero and for a used one is not, and
// the caller supplies both. Rolling these forward by the interval, the way the
// original does, would hand the same serial number a second full life.
export function rollForward(item, { compliedDate, compliedHours, compliedCycles, replacement }) {
  const base = { ...item, updatedAt: Date.now() }

  if (replacement) {
    const sinceNew = replacement.hoursSinceNew ?? 0
    const cyclesSinceNew = replacement.cyclesSinceNew ?? 0
    return {
      ...base,
      partNumber: replacement.partNumber ?? item.partNumber ?? null,
      serialNumber: replacement.serialNumber ?? null,
      lastCompliedDate: compliedDate ?? null,
      lastCompliedHours: compliedHours ?? null,
      lastCompliedCycles: compliedCycles ?? null,
      dueAtHours: item.hoursInterval != null && compliedHours != null
        ? Math.round((compliedHours + (item.hoursInterval - sinceNew)) * 10) / 10
        : item.dueAtHours,
      dueAtCycles: item.cyclesInterval != null && compliedCycles != null
        ? compliedCycles + (item.cyclesInterval - cyclesSinceNew)
        : item.dueAtCycles,
      dueDate: nextDate(item, compliedDate),
    }
  }

  return {
    ...base,
    lastCompliedDate: compliedDate ?? null,
    lastCompliedHours: compliedHours ?? null,
    lastCompliedCycles: compliedCycles ?? null,
    dueAtHours: item.hoursInterval != null && compliedHours != null
      ? Math.round((compliedHours + item.hoursInterval) * 10) / 10
      : item.dueAtHours,
    dueAtCycles: item.cyclesInterval != null && compliedCycles != null
      ? compliedCycles + item.cyclesInterval
      : item.dueAtCycles,
    dueDate: nextDate(item, compliedDate),
  }
}

function nextDate(item, compliedDate) {
  if (item.calendarIntervalMonths == null || !compliedDate) return item.dueDate ?? null
  const d = new Date(`${compliedDate}T12:00:00`)
  if (isNaN(d)) return item.dueDate ?? null
  d.setMonth(d.getMonth() + item.calendarIntervalMonths)
  return d.toISOString().slice(0, 10)
}

// The bundled schedule for this airframe, loaded once onto a device that has
// none.
//
// Reference data, not user data: it is the operator's own sheet, converted
// from their export by scripts/convert-maintenance-sql.js. Seeded only into an
// empty schedule, so a device where a mechanic has been logging compliance is
// never overwritten by the snapshot it started from.
// Single-flight, and this is not defensive programming, it is a bug that
// happened. React mounts effects twice in development, so this ran twice, both
// runs read an empty schedule before either had written, and the aircraft
// ended up with 236 items instead of 118. Checking then writing is not atomic
// across two callers; sharing one promise makes the second wait for the first.
let seeding = null
export function seedFromFixture(aircraftId, registration) {
  if (!aircraftId) return Promise.resolve({ seeded: 0 })
  if (seeding) return seeding
  seeding = runSeed(aircraftId, registration).finally(() => { seeding = null })
  return seeding
}

async function runSeed(aircraftId, registration) {
  const existing = await loadItems(aircraftId)
  if (existing.length) return { seeded: 0, reason: 'schedule already present' }

  const fixture = await import('../data/maintenance/ys-cna.json').then(m => m.default).catch(() => null)
  if (!fixture?.items?.length) return { seeded: 0, reason: 'no schedule bundled for this airframe' }

  // The sheet belongs to one tail number. Loading it onto a different airframe
  // would be inventing that aircraft's history.
  const tail = (fixture.aircraft?.tailNumber ?? '').trim().toUpperCase()
  if (tail && registration && tail !== registration.trim().toUpperCase()) {
    return { seeded: 0, reason: `bundled schedule is for ${tail}` }
  }

  for (const item of fixture.items) {
    await put(ITEMS, {
      ...item,
      id: newId('mx'),
      aircraftId,
      isActive: true,
      source: fixture.source ?? null,
      snapshot: fixture.snapshot ?? null,
      updatedAt: Date.now(),
    })
  }
  return { seeded: fixture.items.length, snapshot: fixture.snapshot ?? null }
}

// Everything off one aircraft's schedule. Used by the import, so a fresh
// snapshot replaces the last one rather than doubling it.
export async function clearSchedule(aircraftId) {
  const rows = await getAll(ITEMS).catch(() => [])
  const mine = rows.filter(r => r.aircraftId === aircraftId)
  for (const r of mine) await del(ITEMS, r.id)
  return mine.length
}
