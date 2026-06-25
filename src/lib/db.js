import { openDB } from 'idb'

const DB_NAME = 'pqrh'
const DB_VERSION = 2

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
  return (await db()).put(store, value)
}

export async function getAll(store) {
  return (await db()).getAll(store)
}
