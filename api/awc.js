export default async function handler(req, res) {
  const { path, ...params } = req.query

  if (!path) return res.status(400).json({ error: 'path required' })

  const qs = new URLSearchParams(params).toString()
  const url = `https://aviationweather.gov/api/data/${path}${qs ? '?' + qs : ''}`

  try {
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'PQRH-App/1.0' },
      signal: AbortSignal.timeout(10000),
    })

    const text = await upstream.text()

    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300')
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
    res.status(upstream.status).send(text)
  } catch (err) {
    res.status(502).json({ error: 'upstream fetch failed', detail: err.message })
  }
}
