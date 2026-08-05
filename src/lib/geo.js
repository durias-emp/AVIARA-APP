// Small pure geo/nav math shared by the Map screen's flight-plan box and GPS
// info bar. Deliberately separate from Checklists/shared/awc.js (which has
// its own copies) rather than importing across feature folders.

export function bearingDeg(lat1, lon1, lat2, lon2) {
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180
  const Δλ = (lon2 - lon1) * Math.PI / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360
}

export function haversineNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180
  const Δφ = (lat2 - lat1) * Math.PI / 180, Δλ = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Cross-track distance from point (la,lo) to great-circle segment (a→b), in NM
export function crossTrackNm(la, lo, a, b) {
  const R = 3440.065
  const toRad = d => d * Math.PI / 180
  const [lat1, lon1] = a.map(toRad), [lat2, lon2] = b.map(toRad)
  const [lat3, lon3] = [toRad(la), toRad(lo)]
  const d13 = Math.acos(Math.sin(lat1) * Math.sin(lat3) + Math.cos(lat1) * Math.cos(lat3) * Math.cos(lon3 - lon1))
  const θ13 = Math.atan2(Math.sin(lon3 - lon1) * Math.cos(lat3), Math.cos(lat1) * Math.sin(lat3) - Math.sin(lat1) * Math.cos(lat3) * Math.cos(lon3 - lon1))
  const θ12 = Math.atan2(Math.sin(lon2 - lon1) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1))
  return Math.abs(Math.asin(Math.sin(d13) * Math.sin(θ13 - θ12))) * R
}

// Aviation DMS notation: N25°47'42" W080°17'24"
export function fmtAvCoord(lat, lon) {
  const fmt = (val, padDeg) => {
    const d = Math.floor(Math.abs(val))
    const mFull = (Math.abs(val) - d) * 60
    const m = Math.floor(mFull)
    const s = Math.round((mFull - m) * 60)
    return `${String(d).padStart(padDeg, '0')}°${String(m).padStart(2, '0')}'${String(s).padStart(2, '0')}"`
  }
  const ns = lat >= 0 ? 'N' : 'S', ew = lon >= 0 ? 'E' : 'W'
  return `${ns}${fmt(lat, 2)} ${ew}${fmt(lon, 3)}`
}

// Distance to the visible horizon, ignoring terrain — standard aviation
// approximation, altitude in feet AGL/MSL, result in NM.
export function horizonNm(altFt) {
  if (altFt == null || altFt < 0) return null
  return 1.06 * Math.sqrt(altFt)
}
