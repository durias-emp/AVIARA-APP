/**
 * PQRH NOTAM Proxy — Cloudflare Worker
 * No credentials needed. Scrapes notams.aim.faa.gov directly.
 *
 * Deploy steps:
 * 1. Go to dash.cloudflare.com → Workers & Pages → Create → Worker
 * 2. Paste this entire file → Deploy
 * 3. Copy the Worker URL (e.g. https://pqrh-notam.yourname.workers.dev)
 * 4. Paste it into the NOTAM section of the PQRH app — done.
 *
 * Free Cloudflare tier: 100,000 requests/day.
 * No account at FAA or login.gov required.
 */

const BASE    = 'https://notams.aim.faa.gov'
const PILOT   = 'https://pilotweb.nas.faa.gov'
const UA      = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function extractCookies(response) {
  const raw = response.headers.get('set-cookie') || ''
  return raw.split(',').map(c => c.split(';')[0].trim()).filter(Boolean).join('; ')
}

export default {
  async fetch(request) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      })
    }

    const url  = new URL(request.url)
    const icao = url.searchParams.get('icao')?.toUpperCase()
    if (!icao) return json({ error: 'Missing ?icao= parameter' }, 400)

    try {
      // ── Step 1: load notamSearch home to get BIGip session cookie ──
      const r1 = await fetch(`${BASE}/notamSearch/`, {
        headers: { 'User-Agent': UA },
        redirect: 'manual',
      })
      let cookies = extractCookies(r1)

      // ── Step 2: POST search — will 302 to pilotweb, sets akamai cookie ──
      const body = JSON.stringify({
        retrieveLocId: icao,
        notamType: 'N',
        formatType: 'ICAO',
        sortColumns: '5 false',
        sortDirection: true,
        pageSize: 50,
        pageNum: 0,
        actionType: 'notamRetrievalByICAOs',
      })

      const r2 = await fetch(`${BASE}/notamSearch/search`, {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/json;charset=UTF-8',
          'Accept': 'application/json, text/plain, */*',
          'Referer': `${BASE}/notamSearch/`,
          'Origin': BASE,
          'Cookie': cookies,
        },
        body,
        redirect: 'manual',
      })
      cookies += '; ' + extractCookies(r2)

      // ── Step 3: follow redirect to pilotweb to legitimise the session ──
      const location = r2.headers.get('location') || `${PILOT}/PilotWeb/`
      const r3 = await fetch(location, {
        headers: {
          'User-Agent': UA,
          'Referer': BASE,
          'Cookie': cookies,
        },
        redirect: 'manual',
      })
      cookies += '; ' + extractCookies(r3)

      // ── Step 4: POST the actual search with full cookie jar ──
      const r4 = await fetch(`${BASE}/notamSearch/search`, {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/json;charset=UTF-8',
          'Accept': 'application/json, text/plain, */*',
          'Referer': `${BASE}/notamSearch/`,
          'Origin': BASE,
          'Cookie': cookies,
        },
        body,
        redirect: 'follow',
      })

      if (!r4.ok) {
        return json({ error: `Search returned ${r4.status}` }, 502)
      }

      const contentType = r4.headers.get('content-type') || ''
      if (!contentType.includes('json')) {
        // Got HTML back — session not established (Akamai may have intervened)
        return json({ error: 'FAA site returned HTML instead of JSON — try again shortly' }, 503)
      }

      const data = await r4.json()
      const items = data?.notamList || data?.items || []

      // Normalise to a consistent shape
      const notams = items.map(n => ({
        id:        n.notamID        || n.id || null,
        text:      n.icaoMessage    || n.traditionalMessage || n.text || '',
        startDate: n.effectiveStart || n.startDate || null,
        endDate:   n.effectiveEnd   || n.endDate   || null,
      }))

      return new Response(JSON.stringify({ items: notams }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=180',
        },
      })

    } catch (err) {
      return json({ error: String(err) }, 502)
    }
  },
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
