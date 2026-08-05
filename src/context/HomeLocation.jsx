import { createContext, useContext } from 'react'
import { useLiveLocation } from '../hooks/useLiveLocation'

const HomeLocationContext = createContext(null)

// Home's own map preview thumbnail (MapCard) and the full Map screen
// (MapView, which only ever renders as an overlay ON TOP of Home — Home
// itself never unmounts while it's open) both want the pilot's live
// position. They used to each run their own independent geolocation
// request, which caused two real bugs: MapCard's one-shot fetch only ever
// runs once (the first time Home mounts), so if it happened to land during
// a transient location failure it stayed stuck on the fallback center for
// the rest of the session, with no way to recover even once location
// started working again; and MapView, fully unmounting/remounting every
// time its overlay closes/reopens, restarted its watch from scratch and
// replayed its "jump to your position" animation on every single reopen
// even when it already knew where you were moments earlier.
//
// One watch, started once here when Home mounts and shared by both via
// context, fixes both: every consumer just reads whatever fix currently
// exists, and a fix found after an early failure becomes visible to
// everyone immediately, not just to whichever consumer's own request
// happens to run next.
//
// Deliberately scoped to Home's subtree, not the whole app: location isn't
// polled at all while the pilot is on an unrelated screen reached by real
// navigation (Checklists, Hangar, Profile, etc.) — same battery-conscious
// intent as AirportDiagram.jsx's own separate, independent watch, which
// stays untouched by this (it has its own narrower reason to run only
// while its specific fullscreen view is open).
export function HomeLocationProvider({ children }) {
  const live = useLiveLocation()
  return <HomeLocationContext.Provider value={live}>{children}</HomeLocationContext.Provider>
}

export function useHomeLocation() {
  return useContext(HomeLocationContext)
}
