// Time/fuel/distance to climb from one altitude to another, for the
// altitude optimizer's per-candidate time/fuel comparison (see
// lib/altitudeOptimizer.js). Bands the climb in fixed steps and looks up
// rate of climb at each band's midpoint via the existing interpolateChart
// (lib/aircraftPerf.js), which never extrapolates — a band outside the
// digitized climb chart's range simply stops the integration and reports
// how far it actually got, the same "never guess" convention used
// everywhere else in this codebase.
import { getPerfChart, interpolateChart } from './aircraftPerf'

// Standard-atmosphere OAT at a given altitude: 15°C at sea level, -2°C per
// 1,000 ft, plus a constant ISA-deviation offset (typically derived from a
// one-time departure METAR temp by the caller). Exported so callers build
// their own oatC(altFt) function without duplicating the lapse rate.
export function isaOat(altFt, isaDevC = 0) {
  return 15 - 2 * (altFt / 1000) + isaDevC
}

// profile: aircraft profile (for its digitized climb chart)
// fromFt/toFt: climb segment bounds
// oatC: (altFt) => number — OAT at that altitude; caller's job, not this
//   module's, so it stays a pure numerical integrator with no weather
//   fetching of its own (see isaOat above for the standard default).
// climbBurnGph/climbTasKt: optional constants — when omitted, fuel/distance
//   are left null rather than guessed (time is the only thing rate-of-climb
//   alone can ever give you).
//
// Returns:
//   { status:'ok', timeMin, fuelGal|null, distNm|null, reachedFt, partial, caveats }
//   { status:'no-chart' }              — aircraft has no digitized climb chart
//   { status:'no-data', reachedFt }    — chart exists but fromFt is already
//                                         outside its own axis range
export function integrateClimb(profile, { fromFt, toFt, oatC, climbBurnGph = null, climbTasKt = null, bandFt = 500 }) {
  if (toFt <= fromFt) return { status: 'ok', timeMin: 0, fuelGal: climbBurnGph != null ? 0 : null, distNm: climbTasKt != null ? 0 : null, reachedFt: fromFt, partial: false, caveats: [] }

  const chart = getPerfChart(profile, 'climb')
  if (!chart) return { status: 'no-chart' }

  let timeMin = 0, fuelGal = 0, distNm = 0
  let alt = fromFt
  let reachedFt = fromFt

  while (alt < toFt) {
    const bandTop = Math.min(alt + bandFt, toFt)
    const mid = (alt + bandTop) / 2
    const interp = interpolateChart(chart, mid, oatC(mid))
    if (!interp || !(interp.value > 0)) break // chart doesn't cover this band — stop, don't guess

    const bandMin = (bandTop - alt) / interp.value
    timeMin += bandMin
    if (climbBurnGph != null) fuelGal += (bandMin / 60) * climbBurnGph
    if (climbTasKt != null) distNm += (bandMin / 60) * climbTasKt
    reachedFt = bandTop
    alt = bandTop
  }

  if (reachedFt === fromFt) return { status: 'no-data', reachedFt }

  const partial = reachedFt < toFt
  return {
    status: 'ok',
    timeMin,
    fuelGal: climbBurnGph != null ? fuelGal : null,
    distNm: climbTasKt != null ? distNm : null,
    reachedFt,
    partial,
    caveats: partial ? [`Digitized climb chart doesn't cover above ${Math.round(reachedFt).toLocaleString()} ft — climb estimate stops there`] : [],
  }
}
