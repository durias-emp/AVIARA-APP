// Altitude bands for the traffic layer, and the lookup that assigns one.
//
// In their own module so TrafficLayer.jsx exports a component and nothing
// else: a module that mixes components with constants loses fast refresh, and
// the legend needs these too.
//
// The breaks are where a pilot's interest changes rather than at round
// numbers: circuit and approach traffic, the low en-route band, and everything
// above that.
export const ALTITUDE_BANDS = [
  { max: 0,        color: '#8E8E93', label: 'On ground' },
  { max: 3000,     color: '#FF3B30', label: 'Below 3,000' },
  { max: 10000,    color: '#FF9500', label: '3,000 to 10,000' },
  { max: Infinity, color: '#0A84FF', label: 'Above 10,000' },
]

export function bandFor(ac) {
  if (ac.gnd) return ALTITUDE_BANDS[0]
  const alt = ac.alt ?? 0
  return ALTITUDE_BANDS.find(b => alt <= b.max) ?? ALTITUDE_BANDS[ALTITUDE_BANDS.length - 1]
}
