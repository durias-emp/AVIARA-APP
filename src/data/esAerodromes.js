// El Salvador's aerodromes and heliports, from the national authority.
//
// Source: Autoridad de Aviación Civil (AAC) de El Salvador, the published
// national list of aeródromos and helipuertos. Coordinates were given in
// degrees/minutes/seconds and converted here; elevations are metres above mean
// sea level exactly as published.
//
// WHY THIS FILE EXISTS, AND WHY IT IS NOT IN src/data/geo/
//
// Everything in src/data/geo/ is generated: rebuilt on the FAA's 28-day cycle
// by the builders in scripts/. Adding these rows there would look right and
// then silently vanish at the next refresh. This is hand-maintained national
// data with no upstream builder, so it lives outside that pipeline and is
// merged in at load time by src/lib/aerodromes.js.
//
// WHAT IS HERE AND WHAT IS NOT
//
// Only the fields the bundled OurAirports pack does not already carry. Seven
// of the AAC's thirteen aerodromes are already in it within a few hundred
// metres (MSLP, MSSS, MSBS, MSJC, MSZT, MSLM, MSET) and are deliberately left
// alone: duplicating them would put two markers on one strip. The merge also
// re-checks by distance at load time, so if OurAirports later adds any of
// these, the copy here drops out rather than doubling up.
//
// All fifteen helipuertos are here because the bundled pack contains no
// heliports anywhere in El Salvador at all.
//
// There are no seaplane bases: the AAC list has none, and neither does the
// bundled pack for the country. That is an absence in the source, not a gap
// left here.
//
// NO INVENTED IDENTIFIERS
//
// The AAC list gives names, not ICAO codes, and most of these fields have
// none. Pilots fly to strips that are not in any database, and a made-up code
// would be indistinguishable from a real one on a chart, so `ident` is the
// published name and `official` is false. Anything rendering these must not
// present the name as a code.

const M_TO_FT = 3.28084

// Aeródromos not already in the bundled pack.
const AERODROMES = [
  { name: 'La Odisea',    lat: 13.332193, lon: -88.501404, elevM: 81.79 },
  // Not the MSPT "El Platanar" already in the bundled pack: that one sits at
  // 13.945, -89.063, about 50 NM north west of this. Two different fields
  // sharing a name, which is exactly why the merge below matches on position
  // rather than on what something is called.
  { name: 'El Platanar',  lat: 13.586880, lon: -88.297670, elevM: 248.15 },
  { name: 'Belén',        lat: 13.337500, lon: -87.868333, elevM: 40.0 },
  { name: 'Los Soles',    lat: 13.763528, lon: -89.419833, elevM: 462.0 },
  { name: 'Canta Rana',   lat: 13.243333, lon: -88.704722, elevM: 3.2 },
  { name: 'La Magdalena', lat: 13.454547, lon: -88.108267, elevM: 118.93 },
]

// Helipuertos. Most of these are rooftop and corporate pads clustered over
// San Salvador, which is why several sit within a few hundred metres of each
// other rather than being duplicates.
const HELIPORTS = [
  { name: 'Escalón Norte',            lat: 13.718768, lon: -89.249942, elevM: 1008.142 },
  { name: 'Sierra Santa Elena',       lat: 13.659828, lon: -89.263292, elevM: 1014.011 },
  { name: "D'CASA",                   lat: 13.670082, lon: -89.271665, elevM: 885.8657 },
  { name: 'Unifersa-Disagro',         lat: 13.656240, lon: -89.277307, elevM: 949.792 },
  { name: 'Constitución',             lat: 13.702767, lon: -89.225631, elevM: 748.565 },
  { name: 'Las Lomas',                lat: 13.677216, lon: -89.230409, elevM: 840.579 },
  { name: 'Pirámide Banco Cuscatlán', lat: 13.672039, lon: -89.273502, elevM: 887.754 },
  { name: 'Diaz Nuila',               lat: 13.714538, lon: -89.258339, elevM: 1064.4866 },
  { name: 'TACA',                     lat: 13.651948, lon: -89.255719, elevM: 911.943 },
  { name: 'HELITOURS',                lat: 13.676058, lon: -89.206833, elevM: 725.0 },
  { name: 'Montealto',                lat: 13.718433, lon: -89.250428, elevM: 1026.0 },
  { name: 'Salamanca',                lat: 13.629528, lon: -89.253500, elevM: 858.0 },
  // The AAC list publishes no elevation for this one. Left null rather than
  // guessed from a neighbour: an invented field elevation is a number a pilot
  // could plan a circuit around.
  { name: 'Millennium',               lat: 13.701347, lon: -89.228494, elevM: null },
  { name: 'Planta Holcim, El Ronco',  lat: 14.326857, lon: -89.498628, elevM: 463.263 },
  { name: 'Samedan',                  lat: 13.658736, lon: -89.250096, elevM: 1001.4149 },
]

export const ES_SOURCE = 'AAC El Salvador'

const withDerived = (r) => ({
  ...r,
  elevFt: r.elevM == null ? null : Math.round(r.elevM * M_TO_FT),
  official: false,
  source: ES_SOURCE,
})

// Shaped like the bundled rows so the merge is a concat rather than a special
// case everywhere downstream. Airports are [ident, lat, lon, cls, name] with
// the extras riding along after; every existing reader destructures the first
// five and ignores the rest.
//
// cls 0 (small) for all of them: these are strips and pads, and the class is
// what decides marker size and the zoom at which they appear.
export const ES_AERODROME_ROWS = AERODROMES.map(r => {
  const d = withDerived(r)
  return [d.name, d.lat, d.lon, 0, null, d.elevFt, d.source]
})

// Aux rows are [ident, lat, lon, name] plus the same extras.
export const ES_HELIPORT_ROWS = HELIPORTS.map(r => {
  const d = withDerived(r)
  return [d.name, d.lat, d.lon, null, d.elevFt, d.source]
})
