import { get, put, del, getAll } from './db'
import { pushToCloud } from './sync'

const ACTIVE_KEY = 'activeAircraftId'
export const ACTIVE_AIRCRAFT_SETTINGS_KEY = ACTIVE_KEY

// Soft-deleted aircraft stay in the same `aircraft` store (marked with a
// `deletedAt` timestamp) so cloud sync carries the delete across devices —
// a separate store would need its own sync wiring for no real benefit.
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000 // 1 week

export function newAircraftId() {
  return `aircraft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

// Is this the same aeroplane as the legacy row, already migrated?
//
// Registration decides it where there is one: it is unique to an airframe and
// it is what a pilot would call the aircraft. Where there is none, the model
// name is all there is to go on. Two genuinely different aircraft sharing both
// a blank registration and a name would be treated as one, which is a far
// smaller problem than the one this prevents.
function sameAirframe(a, b) {
  const norm = (v) => (v ?? '').toString().trim().toUpperCase()
  const regA = norm(a.registration), regB = norm(b.registration)
  if (regA || regB) return regA === regB
  return norm(a.fullName) === norm(b.fullName)
}

// One-time re-key of the legacy single-aircraft row ('profile') to a real
// per-aircraft id.
//
// Two things made this duplicate rather than migrate, and the hangar filled
// with copies of one aeroplane, two more on every launch.
//
// It ran twice at once. The provider resolves the active aircraft on mount and
// again when cloud hydration finishes, and both calls read 'profile' before
// either had deleted it, so both created a row. That is what produced them in
// pairs. inFlight makes concurrent callers share one migration.
//
// And it ran again on the next launch, because a cloud restore lands the
// legacy row back in the store after it was deleted here. Deleting it a second
// time is right; copying it a second time is not, so an already-migrated
// airframe is recognised and the stale row is simply dropped.
let inFlight = null

export async function migrateLegacyAircraft() {
  if (inFlight) return inFlight
  inFlight = (async () => {
    const legacy = await get('aircraft', 'profile')
    if (!legacy) return null

    const existing = (await getAll('aircraft'))
      .filter(a => a.id !== 'profile' && !isDeleted(a))
    const already = existing.find(a => sameAirframe(a, legacy))
    if (already) {
      // Migrated on an earlier run and handed back by the cloud. Drop the
      // stale row rather than making a second aeroplane out of it.
      await del('aircraft', 'profile')
      await pushToCloud('aircraft').catch(() => {})
      return already.id
    }

    const id = newAircraftId()
    await put('aircraft', { ...legacy, id })
    await del('aircraft', 'profile')
    // del() doesn't trigger a cloud push on its own (only put() does) — without
    // this the cloud blob would still carry the stale 'profile'-keyed row.
    await pushToCloud('aircraft').catch(() => {})
    return id
  })().finally(() => { inFlight = null })
  return inFlight
}

export async function setActiveAircraftId(id) {
  await put('settings', { key: ACTIVE_KEY, value: id })
}

function isDeleted(row) {
  return row?.deletedAt != null
}

// Permanently removes anything past the 1-week retention window. Called on
// every load so "Recently Deleted" stays self-cleaning without a background job.
export async function purgeExpiredDeletedAircraft() {
  const all = await getAll('aircraft')
  const cutoff = Date.now() - RETENTION_MS
  const expired = all.filter(a => isDeleted(a) && a.deletedAt < cutoff)
  for (const a of expired) await del('aircraft', a.id)
  if (expired.length) await pushToCloud('aircraft').catch(() => {})
}

export async function getDeletedAircraftRows() {
  const all = await getAll('aircraft')
  return all.filter(isDeleted).sort((a, b) => b.deletedAt - a.deletedAt)
}

// Marks an aircraft deleted rather than removing its row immediately, so it
// can sit in "Recently Deleted" for the retention window. If it was the
// active aircraft, resolveActiveAircraftId() will pick a new one (or null)
// on the next reload since this row no longer passes isDeleted().
export async function deleteAircraft(id) {
  const row = await get('aircraft', id)
  if (!row) return
  await put('aircraft', { ...row, deletedAt: Date.now() })
}

export async function restoreAircraft(id) {
  const row = await get('aircraft', id)
  if (!row) return
  const { deletedAt, ...restored } = row
  await put('aircraft', restored)
}

// Bulk "Clear" action for the Recently Deleted section — permanently removes
// everything in it immediately, ahead of the normal 1-week expiry.
export async function clearAllDeletedAircraft() {
  const deleted = await getDeletedAircraftRows()
  for (const a of deleted) await del('aircraft', a.id)
  if (deleted.length) await pushToCloud('aircraft').catch(() => {})
}

// Resolves which aircraft is "active": migrates the legacy row if present,
// purges any deleted aircraft past their retention window, then picks the
// persisted last-selected id if it still exists (and isn't deleted),
// otherwise the first non-deleted aircraft in the list (persisted as the
// new selection). Returns { id: string|null, list: AircraftRow[] }.
export async function resolveActiveAircraftId() {
  await migrateLegacyAircraft()
  await purgeExpiredDeletedAircraft()

  const list = (await getAll('aircraft')).filter(a => !isDeleted(a))
  if (list.length === 0) return { id: null, list }

  const saved = await get('settings', ACTIVE_KEY)
  if (saved?.value && list.some(a => a.id === saved.value)) {
    return { id: saved.value, list }
  }

  const id = list[0].id
  await setActiveAircraftId(id)
  return { id, list }
}

export async function createAircraft(data) {
  const id = newAircraftId()
  const row = { ...data, id }
  await put('aircraft', row)
  await setActiveAircraftId(id)
  return row
}

// Namespaces a global `settings` key by aircraft, so per-aircraft seed
// values (last W&B result, saved performance/cruise-planning inputs) don't
// leak between airframes when the active aircraft is switched.
export function scopedSettingsKey(base, aircraftId) {
  return aircraftId ? `${base}:${aircraftId}` : base
}
