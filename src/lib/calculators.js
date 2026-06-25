// Unit conversions
export const conv = {
  usgToL: v => v * 3.785,
  lToUsg: v => v * 0.264172,
  nmToFt: v => v * 6076,
  nmToSm: v => v * 1.15078,
  nmToKm: v => v * 1.852,
  lbsToKg: v => v * 0.453592,
  kgToLbs: v => v * 2.20462,
  cToF: v => v * 1.8 + 32,
  fToC: v => (v - 32) / 1.8,
  mbToInhg: v => v / 33.8639,
  inhgToMb: v => v * 33.8639,
}

// Fuel weights (lb/USG and kg/L)
export const FUEL = {
  avgas: { lbPerUsg: 6.0, kgPerL: 0.72 },
  jetA:  { lbPerUsg: 6.7, kgPerL: 0.80 },
  oil:   { lbPerUsg: 7.5, kgPerL: 0.90, lbPerQt: 1.875 },
}

// Pressure Altitude
// PA = (29.92 - altSetting) * 1000 + fieldElev
export function pressureAltitude(altSetting, fieldElev) {
  return (29.92 - altSetting) * 1000 + fieldElev
}

// ISA temperature at a given pressure altitude
export function isaTemp(pa) {
  return 15 - (2 * pa / 1000)
}

// Density Altitude
// DA = PA + 120 * (OAT - ISA)
export function densityAltitude(altSetting, fieldElev, oat) {
  const pa = pressureAltitude(altSetting, fieldElev)
  const isa = isaTemp(pa)
  return pa + 120 * (oat - isa)
}

// V_REF = 1.3 * V_SO
export function vRef(vso) {
  return 1.3 * vso
}

// Weight Shift: w/W = D/d
// Solve for any one unknown given the other three
export function weightShift({ w, W, D, d }) {
  if (w == null) return (W * D) / d
  if (W == null) return (w * d) / D
  if (D == null) return (w * d) / W
  if (d == null) return (W * D) / w
  return null
}
