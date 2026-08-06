// A direct route between two known points, computed without the planner.
//
// This exists because the confirmation panel needed numbers before the
// planner was on screen, and the only thing that could produce them lived
// inside the planner's Route card, which only mounts when a pilot opens it.
// Handing the destination to a screen that was not there left the panel on
// "Working out the route" forever.
//
// Same arithmetic and the same declination source as the planner's own
// calculation, and the record it returns is the same shape the planner saves,
// so the planner restores it as if it had made it: fields prefilled, route
// drawn, nothing recalculated. Waypoints, airways and procedures stay the
// planner's business; this is only ever departure direct destination.

import { bearingDeg, haversineNm } from './geo'

// dep, dest: { ident, name?, lat, lon }
export async function computeDirectRoute(dep, dest) {
  const distNm = haversineNm(dep.lat, dep.lon, dest.lat, dest.lon)
  const tc = bearingDeg(dep.lat, dep.lon, dest.lat, dest.lon)

  // NOAA magnetic declination at the route midpoint, exactly as the planner
  // fetches it. Bounded by a timeout the planner's call does not have, because
  // this one runs while a pilot is watching a read-back panel: a dead network
  // should cost four seconds, not forever. On failure the variation is 0 and
  // the magnetic course equals true, which is what the planner shows in the
  // same circumstance.
  let magVar = 0
  try {
    const midLat = (dep.lat + dest.lat) / 2
    const midLon = (dep.lon + dest.lon) / 2
    const r = await fetch(
      `https://www.ngdc.noaa.gov/geomag-web/calculators/calculateDeclination?lat1=${midLat.toFixed(4)}&lon1=${midLon.toFixed(4)}&key=zNEw7&resultFormat=json`,
      { signal: AbortSignal.timeout(4000) },
    )
    const d = await r.json()
    magVar = d.result?.[0]?.declination ?? 0
  } catch { /* declination is a refinement, not a requirement */ }

  const mc = ((tc - magVar) + 360) % 360

  return {
    tc: Math.round(tc), mc: Math.round(mc),
    distNm: Math.round(distNm),
    magVar: magVar.toFixed(1),
    depName: dep.name || dep.ident,
    destName: dest.name || dest.ident,
    depPos: [dep.lat, dep.lon],
    destPos: [dest.lat, dest.lon],
    dep: dep.ident,
    dest: dest.ident,
    wpts: [],
    airwayNotes: [],
    procedureNotes: [],
    atsTokens: [dep.ident, dest.ident],
  }
}
