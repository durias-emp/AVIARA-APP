// Honduras heliports, from the national AIP.
//
// Source: AD 3.1 Helipuertos Nacionales, AIP Honduras, published by the
// Agencia Hondureña de Aeronáutica Civil (AHAC) through COCESNA's eAIP.
// Edition AMDT 31/26, effective 09 JUL 2026.
// https://www.cocesna.org/aipca/AIPMH/inicio.html
//
// Same reasoning as src/data/esAerodromes.js: src/data/geo/ is generated on a
// 28-day cycle, so hand-added rows there would look right and then vanish.
//
// Nineteen of the AIP's twenty-four are here. The other five (MHHC, MHPB,
// MHVR, MHMC, MHER) are already in the bundled pack within half a nautical
// mile and are left alone rather than duplicated; the merge re-checks by
// distance on every load, so this stays true if the pack changes.
//
// Aerodromes are not here. Unlike El Salvador, the bundled pack already
// carries 161 Honduran airports, so there is no gap worth hand-maintaining.
//
// These do have official ICAO codes, so unlike the El Salvador rows the
// identifier is a real code and the name sits beside it.
//
// COORDINATE FORMATS IN THE SOURCE
//
// The AIP mixes two: most entries are DDMMSS.ss, but MHPM and MHGV are
// DDMM.mmm (degrees and decimal minutes). Both were converted according to
// their own format rather than assumed to be the same one, which matters:
// reading 1531.170 as DDMMSS would put it 15 minutes of latitude out.

const M_TO_FT = 3.28084

const HELIPORTS = [
  { ident: 'MHRP', name: 'Rancho El Paraiso, La Ceiba', lat: 15.783000, lon: -86.672883, elevM: 8.5 },
  { ident: 'MHAE', name: 'Aerocentro, San Pedro Sula', lat: 15.525639, lon: -88.038425, elevM: 117 },
  { ident: 'MHDS', name: 'Diunsa, San Pedro Sula', lat: 15.508611, lon: -88.019444, elevM: null },
  { ident: 'MHFI', name: 'Ficohsa, San Pedro Sula', lat: 15.500000, lon: -88.049722, elevM: null },
  { ident: 'MHJL', name: 'Juan Lindo, San Pedro Sula', lat: 15.518917, lon: -88.051083, elevM: 204 },
  { ident: 'MHPM', name: 'Palmeras, San Pedro Sula', lat: 15.519500, lon: -88.040900, elevM: 37 },
  { ident: 'MHBI', name: 'Bijao, Choloma', lat: 15.704083, lon: -87.926139, elevM: null },
  { ident: 'MHLR', name: 'Los Pinares, El Hatillo, Tegucigalpa', lat: 14.127500, lon: -87.181111, elevM: 1389 },
  { ident: 'MHLL', name: 'Las Lomas, Tegucigalpa', lat: 14.089731, lon: -87.175067, elevM: 1072 },
  { ident: 'MHPD', name: 'Paper Depot, San Pedro Sula', lat: 15.513616, lon: -88.034925, elevM: 122.387 },
  // The AIP publishes this at exactly the same point as MHPM Palmeras, which
  // is in San Pedro Sula, about 25 km from the Naco that names it. One of the
  // two is wrong at the source. It is carried as published rather than moved
  // to a guess, and says so on the marker, because correcting an official
  // position from inference is how a wrong number becomes an authoritative
  // one.
  { ident: 'MHGV', name: 'Green Valley, Naco, Santa Barbara', lat: 15.519500, lon: -88.040900, elevM: 114,
    note: 'AIP position is identical to MHPM Palmeras, 25 km away. Verify before use.' },
  { ident: 'MHRI', name: 'El Rincon, Tegucigalpa', lat: 14.115530, lon: -87.170465, elevM: 1071.680 },
  { ident: 'MHES', name: 'EDI, San Pedro Sula', lat: 15.474742, lon: -88.026550, elevM: 55.76 },
  { ident: 'MHSE', name: 'Siecsa, La Ceiba', lat: 15.781134, lon: -86.756907, elevM: 0.779 },
  { ident: 'MHCT', name: 'Copantl, San Pedro Sula', lat: 15.490981, lon: -88.036897, elevM: 125.405 },
  { ident: 'MHBV', name: 'Altos de Bella Vista, San Pedro Sula', lat: 15.511608, lon: -88.053545, elevM: 299.92 },
  { ident: 'MHCD', name: 'Cayo Redondo, Roatan', lat: 15.951956, lon: -86.474979, elevM: 1.58 },
  { ident: 'MHRM', name: 'Real Minas, El Rincon, Francisco Morazan', lat: 14.114009, lon: -87.177765, elevM: 1019.166 },
  { ident: 'MHVV', name: 'Hospital del Valle, San Pedro Sula, Cortes', lat: 15.536667, lon: -88.015801, elevM: 91.7 },
]

export const HN_SOURCE = 'AIP Honduras (AHAC) AD 3.1'

// [ident, lat, lon, name, elevFt, source, note] — the first four are the shape
// the bundled aux rows use, the rest ride along and are ignored by anything
// that does not know about them.
export const HN_HELIPORT_ROWS = HELIPORTS.map(h => [
  h.ident, h.lat, h.lon, h.name,
  h.elevM == null ? null : Math.round(h.elevM * M_TO_FT),
  HN_SOURCE,
  h.note ?? null,
])
