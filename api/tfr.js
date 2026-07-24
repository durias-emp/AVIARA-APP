// FAA TFR proxy — the GeoServer WFS behind tfr.faa.gov serves proper GeoJSON
// with polygon geometry but no CORS headers, so the browser can't call it
// directly. The public CORS proxies the app used to lean on (corsproxy.io,
// allorigins) have gone dead/blocking, which silently killed TFRs — hence a
// first-party proxy, like /api/awc for weather.
const WFS_URL =
  'https://tfr.faa.gov/geoserver/TFR/ows?service=WFS&version=1.1.0&request=GetFeature' +
  '&typeName=TFR:V_TFR_LOC&maxFeatures=300&outputFormat=application/json&srsname=EPSG:4326'

export default async function handler(req, res) {
  try {
    const upstream = await fetch(WFS_URL, {
      headers: { 'User-Agent': 'AVIARA-App/1.0' },
      signal: AbortSignal.timeout(15000),
    })
    const text = await upstream.text()

    res.setHeader('Access-Control-Allow-Origin', '*')
    // TFRs change slowly — cache 5 min at the edge to keep FAA load minimal
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600')
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
    res.status(upstream.status).send(text)
  } catch (err) {
    res.status(502).json({ error: 'upstream fetch failed', detail: err.message })
  }
}
