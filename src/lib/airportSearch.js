// Finding an airport without already knowing its code.
//
// The picker used to accept four characters and nothing else, which quietly
// assumed the pilot already knew the answer. That is fine for a home field
// and useless for everything else: "the airport at Muskoka", "somewhere near
// Barrie", "YYZ". This searches identifier, IATA code, airport name and city
// together, and ranks the results rather than returning the first hit.
//
// Everything is local. The bundled OurAirports set is already on the device
// for the map and the en-route corridor, and the extra city/IATA columns ride
// in a positional sidecar (see build_geo_pack.py) that is fetched the first
// time someone actually types a word. So search works with no signal, which
// matters — a pilot looking for a diversion is not reliably online.

import { getAirports, getAuxAerodromes } from './aerodromes'

// Accents are stripped from both the index and the query, so "Montreal"
// finds "Montréal" and vice versa. Done once at index build, not per
// keystroke.
const fold = s => (s || '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')   // combining marks, i.e. the accents themselves
  .toUpperCase()

let _index = null
let _building = null

// { idents, names, foldedNames, cities, foldedCities, iatas, countries,
//   lats, lons, classes, hasAux }
//
// Parallel arrays rather than an array of objects: 34k objects is a lot of
// allocation to hold permanently for something scanned on every keystroke,
// and the flat form keeps the hot loop reading numbers out of typed-ish
// arrays instead of chasing pointers.
async function buildIndex() {
  const airports = await getAirports()
  if (!airports) return null

  // Heliports and seaplane bases, appended after the runway airports.
  //
  // They are held in their own file because the class number the rest of the
  // app sorts on is a size tier and a heliport is not a smaller aerodrome. But
  // a picker that says it finds any airport in the world and then cannot find
  // an oil-platform helideck or a lake in British Columbia is not telling the
  // truth, and 11,804 of them is not a rounding error. So they are searchable
  // here, marked, and ranked below every runway: a pilot typing a place name
  // means the field with a runway on it unless they say otherwise.
  //
  // Optional. If the file will not load, search is exactly what it was before.
  let auxRows = []
  try {
    const aux = await getAuxAerodromes()
    auxRows = [
      ...(aux?.heliports ?? []).map(r => [r[0], r[1], r[2], r[3], 'heliport']),
      ...(aux?.seaplaneBases ?? []).map(r => [r[0], r[1], r[2], r[3], 'seaplane']),
    ]
  } catch { /* the runway airports alone are still a search */ }

  const n = airports.length
  const total = n + auxRows.length
  const idx = {
    idents: new Array(total), names: new Array(total), foldedNames: new Array(total),
    cities: new Array(total), foldedCities: new Array(total), iatas: new Array(total),
    countries: new Array(total), classes: new Uint8Array(total),
    kinds: new Array(total),
    lats: new Float64Array(total), lons: new Float64Array(total),
    // How many rows the positional sidecar is allowed to describe. It lines up
    // with airports.json and nothing else, so it must never run past n.
    nAirports: n,
    hasAux: false,
  }
  for (let i = 0; i < n; i++) {
    const a = airports[i]
    idx.idents[i] = a[0]
    idx.lats[i] = a[1]
    idx.lons[i] = a[2]
    idx.classes[i] = a[3] ?? 0
    idx.names[i] = a[4] || ''
    idx.foldedNames[i] = fold(a[4])
    idx.cities[i] = ''
    idx.foldedCities[i] = ''
    idx.iatas[i] = ''
    idx.countries[i] = ''
    idx.kinds[i] = 'airport'
  }

  // The sidecar is optional by design. If it is missing, unreadable, or no
  // longer lines up with airports.json, search still works on identifier and
  // name — degraded, but never wrong. Attaching row i's city to a different
  // airport would be worse than having no cities at all, which is the entire
  // reason the guard exists.
  try {
    const aux = (await import('../data/geo/airport_search.json')).default
    const rows = aux?.rows
    // The sidecar describes airports.json, and getAirports appends supplements
    // to it (six El Salvador fields today) that the sidecar has never heard of.
    // So it describes a PREFIX of the list, not the whole of it.
    //
    // Comparing its length against the merged total therefore failed on every
    // device, every time, and quietly turned off city and IATA search. Two of
    // the four things this picker's own subtitle offers, gone, with a warning
    // in a console no pilot reads. Checking the prefix keeps the guard's real
    // purpose, which is never to hang row i's city on a different airport.
    const m = Array.isArray(rows) ? rows.length : 0
    const aligned = m > 0 && m <= n && aux.n === m &&
      aux.first === idx.idents[0] && aux.last === idx.idents[m - 1]
    if (aligned) {
      for (let i = 0; i < m; i++) {
        const parts = rows[i].split('\t')
        idx.cities[i] = parts[0] || ''
        idx.foldedCities[i] = parts[0] ? fold(parts[0]) : ''
        idx.iatas[i] = parts[1] || ''
        idx.countries[i] = parts[2] || ''
      }
      idx.hasAux = true
    } else if (rows) {
      console.warn('[airportSearch] search index does not match airports.json — city/IATA search disabled')
    }
  } catch {
    // offline before the first fetch, or the file isn't built yet
  }

  // Appended after the sidecar, so the alignment guard above only ever sees
  // the rows the sidecar actually describes.
  for (let k = 0; k < auxRows.length; k++) {
    const i = n + k
    const r = auxRows[k]
    idx.idents[i] = r[0]
    idx.lats[i] = r[1]
    idx.lons[i] = r[2]
    idx.classes[i] = 0
    idx.names[i] = r[3] || ''
    idx.foldedNames[i] = fold(r[3])
    idx.cities[i] = ''
    idx.foldedCities[i] = ''
    idx.iatas[i] = ''
    idx.countries[i] = ''
    idx.kinds[i] = r[4]
  }

  return idx
}

export function loadSearchIndex() {
  if (_index) return Promise.resolve(_index)
  if (!_building) _building = buildIndex().then(i => { _index = i; return i })
  return _building
}

function haversineNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065
  const toRad = d => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// True when `q` starts a word in `hay` — so "SIMCOE" hits "Barrie-Lake Simcoe
// Regional" but "IMCOE" does not. A bare indexOf would rank a match in the
// middle of a word alongside one at the start of a name, which is how
// searching "ORD" ends up offering Concord before Chicago O'Hare.
function wordStart(hay, q) {
  let from = 0
  for (;;) {
    const i = hay.indexOf(q, from)
    if (i < 0) return false
    if (i === 0 || !/[A-Z0-9]/.test(hay[i - 1])) return true
    from = i + 1
  }
}

// How much a bigger field is worth, in relevance points.
//
// Size cannot be a pure tiebreak between equal scores, which is what it was
// first written as. Real queries do not tie: "Barrie" is an exact city match
// for a private strip called Grenfel Field and only a name match for
// Barrie-Lake Simcoe Regional, so on relevance alone the strip won and the
// actual airport came second. Same shape put Centennial above Denver
// International and a Chilean field above LAX. A pilot typing a place name
// means the airport people fly to, so size has to be able to outrank a
// fractionally better string match — one class of it, not any amount of it:
// this is deliberately smaller than the gap between a code match and a word
// match, so typing an identifier still beats typing a city.
const CLASS_WEIGHT = 120

function relevance(idx, i, q) {
  const ident = idx.idents[i]
  if (ident === q) return 1000
  // The leading region letter is the part pilots drop — "YLS" for CYLS,
  // "JFK" for KJFK. Ranked above an exact IATA match on purpose: IATA "YLS"
  // really is Lebel-sur-Quévillon, but someone typing it into a flight-
  // planning app in Ontario means Barrie, and Lebel-sur-Quévillon is still
  // right underneath.
  if (ident.length === q.length + 1 && ident.endsWith(q)) return 950
  if (idx.iatas[i] && idx.iatas[i] === q) return 900
  if (ident.startsWith(q)) return 700
  if (q.length >= 3 && ident.includes(q)) return 620

  const name = idx.foldedNames[i]
  const city = idx.foldedCities[i]

  // Name beats city throughout. A field's own name is what it is called; its
  // city is only where it happens to sit, and thousands of tiny strips list a
  // big city they are merely near.
  if (name.startsWith(q)) return 520
  if (city && city === q) return 480
  if (city && city.startsWith(q)) return 400
  if (wordStart(name, q)) return 340
  if (city && wordStart(city, q)) return 260
  if (name.includes(q)) return 160
  if (city && city.includes(q)) return 120
  return 0
}

// What a heliport or seaplane base gives up against a runway airport. Bigger
// than one size class, so a small strip still beats a helideck that matched
// equally well, and smaller than the gap between a code match and a name match,
// so typing a helipad's own identifier still puts it first.
const NO_RUNWAY_PENALTY = 150

function score(idx, i, q) {
  const r = relevance(idx, i, q)
  if (r === 0) return 0
  const s = r + idx.classes[i] * CLASS_WEIGHT
  return idx.kinds[i] === 'airport' ? s : Math.max(1, s - NO_RUNWAY_PENALTY)
}

// A city is not a municipality, and a pilot asking for New York does not mean
// "fields with New York in their paperwork".
//
// Newark Liberty is in New Jersey. Its municipality is Newark, and no amount of
// city data will ever file it under New York. Teterboro likewise. Narita's
// municipality is Narita. So a text search over names and cities answers "the
// airports at New York" with the two that happen to carry the words, and leaves
// out the one half of New York actually flies from.
//
// The fix needs no data at all: once a place has been matched, offer the
// airports AROUND the best match as well. That is why it works for every city
// on earth rather than the handful someone remembered to tabulate.
//
// 35 NM because that is the span of a metropolitan airport system: JFK to
// Newark is 21, Heathrow to Gatwick 24, Haneda to Narita 32. Medium and large
// only, or every metro drags in fifty private strips.
const METRO_NM = 35
const METRO_MAX = 5

// Only for place queries. Typing KJFK means KJFK, and answering with four of
// its neighbours would be the app arguing with the pilot. A code match scores
// above 520; everything from a name match down is a place, and a place has
// surroundings.
const PLACE_RELEVANCE_MAX = 520

// Worth as much as a name that merely contains the query, before size is added.
// That is the point: Newark is the airport New York flies from, and it has to
// come out above a police helipad called "New York State Police Troop E", which
// is what appending them to the end of the list produced.
const METRO_BASE = 300

function metroCompanions(idx, hits, q) {
  if (!hits.length) return []
  const anchor = hits[0]
  if (relevance(idx, anchor.i, q) > PLACE_RELEVANCE_MAX) return []

  const lat = idx.lats[anchor.i], lon = idx.lons[anchor.i]
  // Every text match, not just the visible ones, or a field ranked 40th would
  // come back a second time as a neighbour of itself.
  const have = new Set(hits.map(h => idx.idents[h.i]))
  const dLat = METRO_NM / 60
  const dLon = METRO_NM / (60 * Math.max(0.05, Math.cos(lat * Math.PI / 180)))

  const out = []
  for (let i = 0; i < idx.idents.length; i++) {
    if (idx.classes[i] < 1) continue
    if (idx.kinds[i] !== 'airport') continue
    if (have.has(idx.idents[i])) continue
    if (Math.abs(idx.lats[i] - lat) > dLat) continue
    if (Math.abs(idx.lons[i] - lon) > dLon) continue
    const d = haversineNm(lat, lon, idx.lats[i], idx.lons[i])
    if (d <= METRO_NM) out.push({ i, d })
  }
  // Biggest first, then closest: a pilot scanning a metro wants the airline
  // fields at the top whichever side of the city they sit on.
  out.sort((a, b) => (idx.classes[b.i] - idx.classes[a.i]) || (a.d - b.d))
  return out.slice(0, METRO_MAX)
}

let _regionNames
function regionName(cc) {
  if (!cc) return ''
  if (_regionNames === undefined) {
    // Built into every browser this app runs on, so a full ISO-3166 table
    // costs nothing to ship. Undefined rather than null on failure so the
    // feature detection runs once.
    try { _regionNames = new Intl.DisplayNames(['en'], { type: 'region' }) }
    catch { _regionNames = null }
  }
  try { return _regionNames?.of(cc) || cc } catch { return cc }
}

function hydrate(idx, i, near) {
  return {
    ident: idx.idents[i],
    name: idx.names[i],
    city: idx.cities[i],
    iata: idx.iatas[i],
    country: idx.countries[i],
    countryName: regionName(idx.countries[i]),
    cls: idx.classes[i],
    // 'airport' | 'heliport' | 'seaplane'. The picker says which, because a
    // helideck offered without a word about it is how a fixed-wing pilot ends
    // up planning to land on one.
    kind: idx.kinds?.[i] ?? 'airport',
    lat: idx.lats[i],
    lon: idx.lons[i],
    distNm: near ? haversineNm(near.lat, near.lon, idx.lats[i], idx.lons[i]) : null,
  }
}

// Ranked matches for a free-text query across ident, IATA, name and city.
//
// `near` ({lat, lon}) is a tiebreak, not a filter: a pilot in Ontario
// searching "Springfield" should be offered the near one first, but must
// still be able to reach the far one. With an empty query it becomes the
// whole ordering — that is the "nearest airports" list.
export async function searchAirports(query, { limit = 25, near = null } = {}) {
  const idx = await loadSearchIndex()
  if (!idx) return []
  const q = fold(query).trim()

  if (!q) {
    if (!near) return []
    return nearbyAirports(near.lat, near.lon, { limit })
  }

  const hits = []
  for (let i = 0; i < idx.idents.length; i++) {
    const s = score(idx, i, q)
    if (s > 0) hits.push({ i, s })
  }

  hits.sort((a, b) => {
    // Size is already inside the score — see CLASS_WEIGHT.
    if (b.s !== a.s) return b.s - a.s
    if (near) {
      const d = haversineNm(near.lat, near.lon, idx.lats[a.i], idx.lons[a.i]) -
                haversineNm(near.lat, near.lon, idx.lats[b.i], idx.lons[b.i])
      if (d) return d
    }
    return idx.idents[a.i] < idx.idents[b.i] ? -1 : 1
  })

  // Ranked in, not tacked on. Appended, Newark sat below every helipad with
  // "New York" in its name, which is the opposite of the question asked.
  const metro = metroCompanions(idx, hits, q)
  if (metro.length) {
    for (const m of metro) {
      hits.push({ i: m.i, s: METRO_BASE + idx.classes[m.i] * CLASS_WEIGHT, metroNm: m.d })
    }
    hits.sort((a, b) => (b.s - a.s) || (idx.idents[a.i] < idx.idents[b.i] ? -1 : 1))
  }

  return hits.slice(0, limit).map(h => {
    const r = hydrate(idx, h.i, near)
    // Says how far it is from the place that was typed, so a field that did not
    // match the words never arrives unexplained.
    if (h.metroNm != null) r.metroNm = h.metroNm
    return r
  })
}

// Closest fields first, regardless of name. Used for "near me" and as the
// picker's opening suggestion when there is nothing typed yet.
export async function nearbyAirports(lat, lon, { limit = 25, withinNm = 250 } = {}) {
  const idx = await loadSearchIndex()
  if (!idx || !Number.isFinite(lat) || !Number.isFinite(lon)) return []

  // Box prefilter before the haversine, same shape as nearestMetar's — 34k
  // trig calls per keystroke is the one thing here that would actually be
  // slow.
  const dLat = withinNm / 60
  const dLon = withinNm / (60 * Math.max(0.05, Math.cos(lat * Math.PI / 180)))
  const hits = []
  for (let i = 0; i < idx.idents.length; i++) {
    if (Math.abs(idx.lats[i] - lat) > dLat) continue
    if (Math.abs(idx.lons[i] - lon) > dLon) continue
    const d = haversineNm(lat, lon, idx.lats[i], idx.lons[i])
    if (d <= withinNm) hits.push({ i, d })
  }
  hits.sort((a, b) => a.d - b.d)
  return hits.slice(0, limit).map(h => {
    const r = hydrate(idx, h.i, { lat, lon })
    r.distNm = h.d
    return r
  })
}

// "Barrie, Canada" / "New York, United States" / "" — the line under the
// airport name in a result row. Country is included because search reaches
// worldwide and "Springfield" alone does not narrow anything down.
export function placeLabel(r) {
  return [r.city, r.countryName].filter(Boolean).join(', ')
}
