import { openDB } from 'idb'
import { SYNCED_STORES, pushToCloud } from './sync'

const DB_NAME = 'pqrh'
const DB_VERSION = 3

let _db = null

async function db() {
  if (_db) return _db
  _db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('aircraft',   { keyPath: 'id' })
        db.createObjectStore('currency',   { keyPath: 'id' })
        db.createObjectStore('checklists', { keyPath: 'id' })
        db.createObjectStore('settings',   { keyPath: 'key' })
        db.createObjectStore('weather',    { keyPath: 'icao' })
      }
      if (oldVersion < 2) {
        db.createObjectStore('flights', { keyPath: 'id' })
      }
      if (oldVersion < 3) {
        // Bookkeeping for the cloud-backup push hook below — one row per
        // synced store name, tracking whether its last push succeeded.
        db.createObjectStore('syncMeta', { keyPath: 'store' })
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

export async function get(store, key) {
  return (await db()).get(store, key)
}

export async function put(store, value) {
  const result = await (await db()).put(store, value)
  // Best-effort cloud backup — fire-and-forget, never blocks or throws from
  // here. `pushToCloud` itself no-ops for stores that aren't backed up
  // (including `syncMeta`, so this can't recurse).
  if (SYNCED_STORES.includes(store)) pushToCloud(store)
  return result
}

export async function getAll(store) {
  return (await db()).getAll(store)
}

export async function del(store, key) {
  return (await db()).delete(store, key)
}
