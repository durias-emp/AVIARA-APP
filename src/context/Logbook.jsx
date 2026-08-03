import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { getAll, put, putMany, del } from '../lib/db'

const LogbookContext = createContext(null)

function newEntryId() {
  return `logbook-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

// Every logged flight — manual entries, GPS auto-detected flights, ForeFlight/
// CSV imports, and OCR-scanned logbook pages — lands in the same
// `logbookEntries` store as the same entry shape, distinguished only by
// `source`. Modeled on ActiveAircraftProvider (array of records + refresh),
// not PilotProfileProvider (single settings blob), since this is many rows.
export function LogbookProvider({ children }) {
  // undefined = still loading, array = resolved (possibly empty)
  const [entries, setEntries] = useState(undefined)

  // Returns the promise (not a bare block-body arrow) — addEntry/addEntries/
  // updateEntry/deleteEntry all `await refresh()` expecting it to actually
  // wait for the re-fetched list to land in state before they resolve;
  // without the explicit return here, await refresh() would resolve
  // instantly on undefined instead.
  const refresh = useCallback(() => {
    return getAll('logbookEntries').then(list => {
      setEntries(list.slice().sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')))
    })
  }, [])

  useEffect(() => {
    refresh()
    // A cloud restore can land entries after the initial read above returned
    // empty — re-resolve once hydration finishes, same pattern as
    // ActiveAircraftProvider/PilotProfileProvider.
    window.addEventListener('aviara-hydrated', refresh)
    return () => window.removeEventListener('aviara-hydrated', refresh)
  }, [refresh])

  const addEntry = useCallback(async (entry) => {
    const row = {
      ...entry,
      id: entry.id ?? newEntryId(),
      createdAt: entry.createdAt ?? Date.now(),
      source: entry.source ?? 'manual',
    }
    await put('logbookEntries', row)
    await refresh()
    return row
  }, [refresh])

  // Bulk import/scan path — writes every entry in one IndexedDB transaction
  // and triggers exactly one cloud push for the whole batch via db.js's
  // putMany, instead of calling addEntry in a loop (N separate transactions,
  // each re-uploading the store's entire growing contents — the O(n²)
  // pattern that made a several-hundred-row CSV import effectively hang).
  const addEntries = useCallback(async (list) => {
    const rows = list.map(entry => ({
      ...entry,
      id: entry.id ?? newEntryId(),
      createdAt: entry.createdAt ?? Date.now(),
      source: entry.source ?? 'manual',
    }))
    await putMany('logbookEntries', rows)
    await refresh()
    return rows
  }, [refresh])

  const updateEntry = useCallback(async (id, patch) => {
    const existing = entries?.find(e => e.id === id)
    const row = { ...existing, ...patch, id }
    await put('logbookEntries', row)
    await refresh()
    return row
  }, [entries, refresh])

  const deleteEntry = useCallback(async (id) => {
    await del('logbookEntries', id)
    await refresh()
  }, [refresh])

  return (
    <LogbookContext.Provider value={{ entries, addEntry, addEntries, updateEntry, deleteEntry, refresh }}>
      {children}
    </LogbookContext.Provider>
  )
}

export function useLogbook() {
  return useContext(LogbookContext)
}
