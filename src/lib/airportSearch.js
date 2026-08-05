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

import { getAirports } from './aerodromes'

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

  const n = airports.length
  const idx = {
    idents: new Array(n), names: new Array(n), foldedNames: new Array(n),
    cities: new Array(n), foldedCities: new Array(n), iatas: new Array(n),
    countries: new Array(n), classes: new Uint8Array(n),
    lats: new Float64Array(n), lons: new Float64Array(n),
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
  }

  // The sidecar is optional by design. If it is missing, unreadable, or no
  // longer lines up with airports.json, search still works on identifier and
  // name — degraded, but never wrong. Attaching row i's city to a different
  // airport would be worse than having no cities at all, which is the entire
  // reason the guard exists.
  try {
    const aux = (await import('../data/geo/airport_search.json')).default
    const rows = aux?.rows
    const aligned = Array.isArray(rows) && rows.length === n &&
      aux.n === n && aux.first === idx.idents[0] && aux.last === idx.idents[n - 1]
    if (aligned) {
      for (let i = 0; i < n; i++) {
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

function score(idx, i, q) {
  const r = relevance(idx, i, q)
  return r === 0 ? 0 : r + idx.classes[i] * CLASS_WEIGHT
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

  return hits.slice(0, limit).map(h => hydrate(idx, h.i, near))
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
