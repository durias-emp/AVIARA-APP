/* global process */
// Live traffic proxy — aggregated ADS-B, for reference only.
//
// Same shape as /api/awc and /api/tfr: the client never talks to the upstream
// directly, so request volume stays a function of how many distinct areas are
// being watched rather than of how many pilots have the layer on.
//
// Source is adsb.lol (ODbL 1.0). Commercial use is permitted on condition of
// attribution, so the attribution string is returned in the payload and the
// client renders it verbatim whenever the layer is on. airplanes.live is
// non-commercial and is therefore dev-only, behind TRAFFIC_SOURCE, which
// defaults to adsb.lol. Flightradar24 is deliberately absent: its terms
// prohibit use in systems supporting flight planning or flight operations,
// which is exactly what this app is.
//
// No in-process cache here on purpose. Serverless instances scale
// horizontally, so N warm instances each holding a 5s local cache is N
// upstream calls per 5s against an upstream that allows about one per second.
// The edge cache is the only cache, which is why the key space below is
// deliberately small.

const SOURCES = {
  'adsb.lol': {
    base: 'https://api.adsb.lol/v2',
    attribution: 'Traffic data © adsb.lol contributors, ODbL 1.0',
  },
  // Dev only. Non-commercial terms, so this must never be the default.
  'airplanes.live': {
    base: 'https://api.airplanes.live/v2',
    attribution: 'Traffic data © airplanes.live (non-commercial)',
  },
}

// The area each request covers, and the grid the centre is snapped to.
//
// The client cannot ask for an arbitrary box. An arbitrary box would give
// every pilot their own cache key, so the edge would collapse nothing and the
// upstream would see one call per client per 5s. Snapping to a whole degree
// means everyone within the same ~60 NM cell shares one cached answer, while
// the layer still works anywhere on earth rather than only in places someone
// remembered to whitelist.
const GRID_DEG = 1
const RADIUS_NM = 150

// A position older than this is not traffic, it is history. Dropping it here
// rather than on the client means the payload is smaller and every client
// agrees on what counts as current.
const MAX_AGE_S = 30

const snap = (v) => Math.round(v / GRID_DEG) * GRID_DEG

export default async function handler(req, res) {
  const lat = Number(req.query.lat)
  const lon = Number(req.query.lon)

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(400).json({ error: 'lat and lon required' })
  }

  const key = SOURCES[process.env.TRAFFIC_SOURCE] ? process.env.TRAFFIC_SOURCE : 'adsb.lol'
  const source = SOURCES[key]
  const url = `${source.base}/lat/${snap(lat)}/lon/${snap(lon)}/dist/${RADIUS_NM}`

  try {
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'AVIARA-App/1.0' },
      signal: AbortSignal.timeout(10000),
    })

    if (!upstream.ok) {
      return res.status(502).json({ error: 'upstream fetch failed', detail: `status ${upstream.status}` })
    }

    const data = await upstream.json()

    // Slimmed to the eight fields the map actually draws. The upstream sends
    // about fifty per aircraft, and this runs every five seconds on a phone
    // that may be on cellular in the air: the raw feed is roughly 100 KB for
    // 200 aircraft, and this is a fraction of it.
    const aircraft = []
    for (const a of data.ac ?? []) {
      if (a.lat == null || a.lon == null) continue
      const age = a.seen_pos ?? a.seen ?? 0
      if (age > MAX_AGE_S) continue

      // alt_baro is the string "ground" for anything on the surface, which is
      // over half of what comes back near a busy field. Treating that as a
      // number gives NaN, and NaN altitude silently breaks the colour bands.
      const onGround = a.alt_baro === 'ground'
      const alt = onGround ? 0 : (typeof a.alt_baro === 'number' ? a.alt_baro : null)

      aircraft.push({
        id: a.hex,
        cs: (a.flight ?? '').trim() || null,
        lat: a.lat,
        lon: a.lon,
        alt,
        gnd: onGround,
        // Absent for a large share of targets, mostly the ones on the ground.
        // The client must not dead reckon without both.
        gs: typeof a.gs === 'number' ? a.gs : null,
        trk: typeof a.track === 'number' ? a.track : null,
        // Triangulated rather than broadcast, so it carries lower confidence
        // and is drawn differently.
        mlat: a.type === 'mlat' || (Array.isArray(a.mlat) && a.mlat.length > 0),
        age,
      })
    }

    res.setHeader('Access-Control-Allow-Origin', '*')
    // Five seconds at the edge, with a 25s grace window: the CDN serves the
    // stale copy while it refreshes, so a burst of clients never becomes a
    // burst of upstream calls.
    res.setHeader('Cache-Control', 'public, s-maxage=5, stale-while-revalidate=25')
    res.setHeader('Content-Type', 'application/json')
    res.status(200).json({
      now: data.now ?? Date.now(),
      count: aircraft.length,
      attribution: source.attribution,
      source: key,
      aircraft,
    })
  } catch (err) {
    res.status(502).json({ error: 'upstream fetch failed', detail: err.message })
  }
}
