// Which levels a flight may cruise at, and which one to offer first.
//
// The hemispheric rule, in one place, because it is the kind of thing that
// gets written slightly differently everywhere it is needed. Magnetic course,
// not true: the rule is worded in magnetic and a route that straddles a large
// variation would be given the wrong side of it otherwise.
//
//   000 to 179 magnetic   odd thousands      (VFR adds 500)
//   180 to 359 magnetic   even thousands     (VFR adds 500)
//
// Nothing here decides whether a level is a GOOD idea. Terrain, airspace,
// icing, oxygen and the aircraft's own ceiling are all somebody else's
// question; this only answers which levels are legal for the direction.

// Class A begins at 18,000 ft, which is why VFR stops below it rather than at
// a round number: 17,500 is the highest odd-or-even-plus-500 that still fits.
export const VFR_MAX_FT = 17500
// FL600 is the top of Class A. Above it is Class E again, but an aircraft that
// can get there is not being planned in this box.
export const IFR_MAX_FT = 60000

// True for a level that is in the list only because it is the ceiling, rather
// than because the hemispheric rule produced it.
export function isCeilingOnly(ft, { eastbound = true } = {}) {
  if (ft !== IFR_MAX_FT) return false
  const start = eastbound ? 45000 : 43000
  return (ft - start) % 4000 !== 0
}
// Where feet stop being spoken and flight levels start.
export const FL_FLOOR_FT = 18000

// The lowest level offered. Below 3,000 AGL the hemispheric rule does not
// apply at all, so offering 1,500 would be offering a rule that is not in
// force; the planner is where a low transit gets worked out.
const BASE_FT = 3000

export function isEastbound(magCourseDeg) {
  if (magCourseDeg == null || !Number.isFinite(magCourseDeg)) return true
  const c = ((magCourseDeg % 360) + 360) % 360
  return c < 180
}

// "FL180", or "5,500 ft". The three-digit form is padded, because FL80 is not
// a thing a pilot reads on a plate.
export function formatAltitude(ft) {
  if (ft == null) return '—'
  if (ft >= FL_FLOOR_FT) return `FL${String(Math.round(ft / 100)).padStart(3, '0')}`
  return `${ft.toLocaleString()} ft`
}

// Every legal level for these rules and this direction, low to high.
export function cruisingAltitudes({ rules = 'VFR', eastbound = true } = {}) {
  const out = []
  const wantOdd = eastbound
  if (rules === 'VFR') {
    for (let ft = BASE_FT; ft <= VFR_MAX_FT; ft += 1000) {
      const thousands = ft / 1000
      const odd = thousands % 2 === 1
      if (odd === wantOdd) out.push(ft + 500)
    }
    // The +500 on the last odd/even step can overshoot the ceiling.
    return out.filter(ft => ft <= VFR_MAX_FT)
  }
  // IFR: whole thousands to 17,000, then flight levels. FL180 up to FL410 keep
  // the same odd/even rule in thousands; above FL410 the separation doubles to
  // 4,000 ft, which is the part most tables get wrong.
  for (let ft = BASE_FT; ft < FL_FLOOR_FT; ft += 1000) {
    if ((ft / 1000) % 2 === 1 === wantOdd) out.push(ft)
  }
  for (let ft = FL_FLOOR_FT; ft <= 41000; ft += 1000) {
    if ((ft / 1000) % 2 === 1 === wantOdd) out.push(ft)
  }
  // Above FL410, eastbound is FL450, FL490 ... and westbound FL430, FL470 ...
  for (let ft = wantOdd ? 45000 : 43000; ft < IFR_MAX_FT; ft += 4000) out.push(ft)
  // FL600 itself, which the sequence above steps over in both directions:
  // eastbound reaches FL570 then FL610, westbound FL590 then FL630. It is
  // offered anyway because it is the top of Class A and a pilot asking for the
  // ceiling means the ceiling. It is NOT a hemispheric cruising level, and the
  // box says so rather than letting the list imply otherwise.
  if (!out.includes(IFR_MAX_FT)) out.push(IFR_MAX_FT)
  return out
}

// The one to offer before the pilot has chosen. The lowest legal level that
// clears the terrain by the thousand feet the mountain rule asks for, or the
// lowest legal level at all when the terrain is not known.
//
// Deliberately the LOWEST that works rather than a comfortable one: a
// suggestion that is higher than it needs to be costs fuel and oxygen, and a
// pilot who wants more can see the rest of the list.
export function suggestAltitude({ rules = 'VFR', magCourseDeg = null, terrainMaxFt = null } = {}) {
  const list = cruisingAltitudes({ rules, eastbound: isEastbound(magCourseDeg) })
  if (!list.length) return null
  if (terrainMaxFt == null) return list[0]
  return list.find(ft => ft - terrainMaxFt >= 1000) ?? list[list.length - 1]
}
