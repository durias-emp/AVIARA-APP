import { openDB } from 'idb'
import { SYNCED_STORES, pushToCloud } from './sync'

const DB_NAME = 'pqrh'
const DB_VERSION = 8

let _db = null

// `oldVersion < N` blocks below are kept purely for readability/history —
// every actual createObjectStore call is ALSO gated on
// objectStoreNames.contains(...), which is the part that actually matters.
// Real incident, this session: DB_VERSION was bumped to 5 in one edit, with
// the matching createObjectStore('logbookEntries', ...) added in a
// SEPARATE, later edit — a live dev tab's hot-reload ran db() in the gap
// between those two edits, which upgraded that tab's on-disk database to
// "version 5" without ever creating the store. IndexedDB only re-runs
// upgrade logic when it sees a version HIGHER than what's already recorded,
// so that tab's database was permanently stuck missing the store — no
// retry, no reload, nothing short of a further version bump could fix it,
// since `oldVersion < 5` alone would never evaluate true again for that
// tab. The `contains()` guard makes every store idempotent to create, so a
// future version of this exact mistake (an upgrade that partially applies
// due to timing) self-corrects on the next bump instead of silently and
// permanently breaking one store forever.
function ensureStore(db, name, options) {
  if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, options)
}

async function db() {
  if (_db) return _db
  _db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        ensureStore(db, 'aircraft',   { keyPath: 'id' })
        ensureStore(db, 'currency',   { keyPath: 'id' })
        ensureStore(db, 'checklists', { keyPath: 'id' })
        ensureStore(db, 'settings',   { keyPath: 'key' })
        ensureStore(db, 'weather',    { keyPath: 'icao' })
      }
      if (oldVersion < 2) {
        ensureStore(db, 'flights', { keyPath: 'id' })
      }
      if (oldVersion < 3) {
        // Bookkeeping for the cloud-backup push hook below — one row per
        // synced store name, tracking whether its last push succeeded.
        ensureStore(db, 'syncMeta', { keyPath: 'store' })
      }
      if (oldVersion < 4) {
        // Cached OpenStreetMap runway/taxiway/apron/building geometry for the
        // Airports section's diagram — a disposable fetch cache like
        // `weather`, not pilot data, so it's excluded from cloud sync too.
        ensureStore(db, 'airportDiagram', { keyPath: 'icao' })
      }
      if (oldVersion < 6) {
        // One row per logged flight — manual entries, GPS auto-detected
        // flights, ForeFlight/CSV imports, and OCR-scanned logbook pages all
        // land here as the same entry shape, distinguished only by `source`.
        // (Originally added at version 5 — see the incident note above for
        // why this re-runs at 6 too.)
        ensureStore(db, 'logbookEntries', { keyPath: 'id' })
      }
      if (oldVersion < 7) {
        // One row per submitted UAP/UFO sighting report — same personal,
        // locally-owned-then-synced shape as logbookEntries.
        ensureStore(db, 'uapReports', { keyPath: 'id' })
      }
      if (oldVersion < 8) {
        // Rendered (rasterized-to-image) FAA procedure chart pages, keyed by
        // `${icao}:${cycle}:${pdfName}` — the cycle baked into the key means
        // a new 28-day cycle is automatically a cache miss with no separate
        // invalidation logic needed. Disposable fetch cache like `weather`/
        // `airportDiagram`, not pilot data, so it's excluded from cloud sync.
        ensureStore(db, 'procedureChartImages', { keyPath: 'key' })
      }
    },
    blocking() {
      // A newer version is waiting — close this connection so the upgrade can proceed
      _db?.close()
      _db = null
    },
    blocked() {
      // An older tab is blocking our upgrade — reload once it closes
      window.location.reload()
    },
  })
  return _db
}

// Runs `fn` against the open database, and if it fails with the specific
// error a stale connection throws (opened before a later DB_VERSION bump
// added a store this tab doesn't know about — e.g. left open across a
// deploy, or across this app's own dev-server HMR reconnecting to an
// already-live tab), drops the cached connection and retries once against a
// freshly opened one. Without this, that failure mode is permanent until
// the pilot manually reloads — every one of get/put/getAll/putMany/del goes
// through this so all of them self-heal the same way.
async function withDb(fn) {
  try {
    return await fn(await db())
  } catch (err) {
    if (err?.name === 'NotFoundError') {
      try { _db?.close() } catch { /* already closed */ }
      _db = null
      return await fn(await db())
    }
    throw err
  }
}

export async function get(store, key) {
  return withDb(database => database.get(store, key))
}

export async function put(store, value) {
  const result = await withDb(database => database.put(store, value))
  // Best-effort cloud backup — fire-and-forget, never blocks or throws from
  // here. `pushToCloud` itself no-ops for stores that aren't backed up
  // (including `syncMeta`, so this can't recurse).
  if (SYNCED_STORES.includes(store)) pushToCloud(store)
  return result
}

export async function getAll(store) {
  return withDb(database => database.getAll(store))
}

// Writes many records in ONE IndexedDB transaction and triggers exactly one
// cloud push for the whole batch, instead of N separate put() calls each
// re-uploading the store's entire (growing) contents — that N-separate-push
// pattern is O(n²) in data transferred and is what made a several-hundred-
// row logbook CSV import effectively hang. Use this for any bulk insert
// (CSV/PDF import, OCR scan) instead of looping put().
export async function putMany(store, values) {
  await withDb(async database => {
    const tx = database.transaction(store, 'readwrite')
    await Promise.all([...values.map(v => tx.store.put(v)), tx.done])
  })
  if (SYNCED_STORES.includes(store)) pushToCloud(store)
}

export async function del(store, key) {
  return withDb(database => database.delete(store, key))
}

// Wipe one store's contents (not the store itself). Used on sign-out so a
// shared device doesn't leak one pilot's data into the next account.
export async function clearStore(store) {
  return withDb(database => database.clear(store))
}
