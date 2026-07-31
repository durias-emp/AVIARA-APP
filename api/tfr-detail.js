// FAA per-TFR detail proxy — the WFS layer behind api/tfr.js (lateral
// polygons only) has NO altitude field at all (confirmed via a live
// DescribeFeatureType request against TFR:V_TFR_LOC: SHAPE, GID,
// CNS_LOCATION_ID, NOTAM_KEY, TITLE, LAST_MODIFICATION_DATETIME, STATE,
// LEGAL — nothing else). Floor/ceiling only exists in the structured NOTAM
// detail text tfr.faa.gov's own detail page renders, fetched here from the
// same internal API it uses (tfrapi/getWebText) — an HTML fragment wrapped
// in JSON, parsed client-side in src/lib/tfrAltitude.js. No CORS headers
// upstream, same reason api/tfr.js exists.
export default async function handler(req, res) {
  const { notamId } = req.query
  if (!notamId) {
    return res.status(400).json({ error: 'notamId is required' })
  }
  try {
    const upstream = await fetch(`https://tfr.faa.gov/tfrapi/getWebText?notamId=${encodeURIComponent(notamId)}`, {
      headers: { 'User-Agent': 'AVIARA-App/1.0' },
      signal: AbortSignal.timeout(15000),
    })
    const text = await upstream.text()

    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600')
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
    res.status(upstream.status).send(text)
  } catch (err) {
    res.status(502).json({ error: 'upstream fetch failed', detail: err.message })
  }
}
