import { useCallback, useEffect, useState } from 'react'
import { get, put } from '../lib/db'

const STORE = 'settings'
const KEY   = 'flightPlanType'
const EVENT = 'aviara-flight-plan-type'

// The three choices, written down once.
//
// They used to live inside FlightPlanTypePicker, which was fine while that
// full-screen gate was the only thing that asked. The route card asks now too,
// on the screen a pilot lands on when they open a flight plan, and two copies
// of the same list is how the two end up disagreeing.
//
// A type is not the same thing as a rule, which is why `flightRules` is carried
// beside the label rather than read off it. Local was always flown VFR, and RTC
// is rotorcraft flown under the VFR rules, so both name themselves in `type`
// and answer VFR to everything that asks what rules apply.
export const FLIGHT_PLAN_TYPES = [
  { key: 'VFR', label: 'VFR', flightRules: 'VFR', crossCountry: true },
  { key: 'IFR', label: 'IFR', flightRules: 'IFR', crossCountry: true },
  { key: 'RTC', label: 'RTC', flightRules: 'VFR', crossCountry: true },
]

// Everything the app has ever stored here, including the retired Local, so a
// pilot who picked it before today still gets their choice read back.
const LEGACY = { LOCAL: { key: 'LOCAL', label: 'Local', flightRules: 'VFR', crossCountry: false } }

export function flightPlanTypeByKey(key) {
  return FLIGHT_PLAN_TYPES.find(t => t.key === key) ?? LEGACY[key] ?? null
}

// The picked type, shared between the row under the route card and anything
// else that asks. Same shape as useMapLayer, and for the same reason: the
// planner stays mounted under the drawer while the choice is made above it, so
// without the event it would show the type from when it mounted.
export function useFlightPlanType() {
  const [value, setValue] = useState(undefined)   // undefined = not read yet

  useEffect(() => {
    const load = () => get(STORE, KEY).then(saved => setValue(saved?.value ?? null))
    load()
    window.addEventListener(EVENT, load)
    window.addEventListener('aviara-hydrated', load)
    return () => {
      window.removeEventListener(EVENT, load)
      window.removeEventListener('aviara-hydrated', load)
    }
  }, [])

  const choose = useCallback((option) => {
    const next = {
      type: option.key,
      flightRules: option.flightRules,
      crossCountry: option.crossCountry,
    }
    setValue(next)
    put(STORE, { key: KEY, value: next })
      .then(() => window.dispatchEvent(new Event(EVENT)))
      .catch(() => {})
  }, [])

  return { value, choose }
}
