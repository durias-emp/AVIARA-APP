// NOTAM proxy. Two upstreams, one of which needs a secret.
//
// NAV CANADA is keyless but sends no CORS headers, so the browser cannot
// call it directly. The FAA's NOTAM API needs a client id/secret from a free
// api.faa.gov registration, and those must never reach the client — which is
// the other reason both go through here rather than being fetched from the
// page.
//
// Deliberately thin: this forwards and returns the upstream body untouched.
// All parsing lives in src/lib/notams.js, so the dev-server mirror in
// vite.config.js has only this much to duplicate.

const UPSTREAM = {
  navcanada: icao =>
    `https://plan.navcanada.ca/weather/api/alpha/?site=${encodeURIComponent(icao)}&alpha=notam`,
  faa: icao =>
    `https://external-api.faa.gov/notamapi/v1/notams?icaoLocation=${encodeURIComponent(icao)}&pageSize=50`,
}

export default async function handler(req, res) {
  const icao = String(req.query.icao || '').toUpperCase()
  const source = String(req.query.source || '')

  if (!/^[A-Z0-9]{3,4}$/.test(icao)) {
    return res.status(400).json({ error: 'icao required' })
  }
  if (!UPSTREAM[source]) {
    return res.status(400).json({ error: 'source must be navcanada or faa' })
  }

  const headers = { 'User-Agent': 'PQRH-App/1.0', Accept: 'application/json' }

  if (source === 'faa') {
    const id = process.env.FAA_NOTAM_CLIENT_ID
    const secret = process.env.FAA_NOTAM_CLIENT_SECRET
    // Same shape as the "OPENAI_API_KEY not configured" path elsewhere in
    // this folder: say what is missing rather than failing as if the airport
    // had no NOTAMs. 501 is what src/lib/notams.js reads to tell a setup
    // problem from an outage.
    if (!id || !secret) {
      return res.status(501).json({
        error: 'US NOTAMs need FAA API credentials. Register free at api.faa.gov, then set FAA_NOTAM_CLIENT_ID and FAA_NOTAM_CLIENT_SECRET.',
      })
    }
    headers.client_id = id
    headers.client_secret = secret
  }

  try {
    const upstream = await fetch(UPSTREAM[source](icao), {
      headers,
      signal: AbortSignal.timeout(15000),
    })
    const text = await upstream.text()

    res.setHeader('Access-Control-Allow-Origin', '*')
    // Short: a NOTAM is the most perishable thing this app serves, and a
    // runway that closed two minutes ago is exactly the case that matters.
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120')
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
    res.status(upstream.status).send(text)
  } catch (err) {
    res.status(502).json({ error: 'upstream fetch failed', detail: err.message })
  }
}
