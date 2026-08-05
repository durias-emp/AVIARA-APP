import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { resolveActiveAircraftId, getDeletedAircraftRows, setActiveAircraftId as persistActiveId } from '../lib/aircraft'

const ActiveAircraftContext = createContext(null)

export function ActiveAircraftProvider({ children }) {
  // undefined = still loading, null = no aircraft yet, string = resolved id
  const [aircraftId, setAircraftIdState] = useState(undefined)
  const [aircraftList, setAircraftListState] = useState(undefined)
  const [deletedList, setDeletedListState] = useState(undefined)

  const refreshDeletedList = useCallback(async () => {
    const list = await getDeletedAircraftRows()
    setDeletedListState(list)
    return list
  }, [])

  const reload = useCallback(() => {
    resolveActiveAircraftId().then(({ id, list }) => {
      setAircraftIdState(id)
      setAircraftListState(list)
    })
    refreshDeletedList()
  }, [refreshDeletedList])

  useEffect(() => {
    reload()
    // A cloud restore can land aircraft rows after the initial read above
    // returned empty — re-resolve once hydration finishes, same pattern as
    // PilotProfileProvider.
    window.addEventListener('aviara-hydrated', reload)
    return () => window.removeEventListener('aviara-hydrated', reload)
  }, [reload])

  const setActiveAircraftId = useCallback(async (id) => {
    setAircraftIdState(id)
    await persistActiveId(id)
  }, [])

  // Re-resolves both the active id and the list — a plain re-fetch of the
  // list alone isn't enough once deletion can change which aircraft is
  // active (deleting the active aircraft must fall through to another one,
  // or to null).
  const refreshAircraftList = useCallback(async () => {
    const { id, list } = await resolveActiveAircraftId()
    setAircraftIdState(id)
    setAircraftListState(list)
    return list
  }, [])

  return (
    <ActiveAircraftContext.Provider value={{ aircraftId, aircraftList, deletedList, setActiveAircraftId, refreshAircraftList, refreshDeletedList }}>
      {children}
    </ActiveAircraftContext.Provider>
  )
}

export function useActiveAircraft() {
  return useContext(ActiveAircraftContext)
}
