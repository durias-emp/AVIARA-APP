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

// Which emitter categories count as the traffic a general aviation pilot
// shares the sky with. From the ADS-B emitter class field:
//
//   A1  light, under 15,500 lb        the Skyhawks, Cirrus, Bonanzas
//   A7  rotorcraft
//   B1  glider or sailplane
//   B2  lighter than air
//   B4  ultralight, hang glider, paraglider
//
// A0 and a missing category are included deliberately. Unknown is far more
// often a small aircraft with an older installation than it is an airliner,
// and the cost of wrongly including one is a dot on the map, while the cost of
// wrongly excluding one is traffic a pilot expected to see and did not.
const LIGHT_CATEGORIES = new Set(['A0', 'A1', 'A7', 'B1', 'B2', 'B4'])

export function isLight(ac) {
  return !ac.cat || LIGHT_CATEGORIES.has(ac.cat)
}

// Human labels, for the selected-aircraft card.
export const CATEGORY_LABEL = {
  A1: 'Light', A2: 'Small', A3: 'Large', A4: 'High vortex', A5: 'Heavy',
  A6: 'High performance', A7: 'Rotorcraft',
  B1: 'Glider', B2: 'Lighter than air', B3: 'Parachutist',
  B4: 'Ultralight', B6: 'UAV', B7: 'Space vehicle',
}
