// FAA d-TPP chart PDF proxy — fetched live, on demand, per chart a pilot
// actually taps (unlike the bundled procedures_index.json, which is built
// once per FAA cycle by scripts/build_procedure_index.py; committing every
// airport's chart PDFs into the repo isn't reasonable, and "fresh from the
// FAA" is the one place currency genuinely matters for this feature).
//
// Binary-safe on purpose: api/tfr.js's text()/send(text) shape (the obvious
// template to copy) would corrupt a PDF's byte stream — decoding it through
// UTF-8 text and re-encoding mangles binary content. This uses arrayBuffer()
// + Buffer.from(...), the same primitive api/generate-aircraft-icon.js
// already uses correctly for image bytes.
const BASE = 'https://aeronav.faa.gov/d-tpp'

// Both params are used to build the upstream URL — reject anything that
// isn't exactly the shape the FAA's own feed produces, so this can't be
// turned into an open relay to arbitrary URLs.
const CYCLE_RE = /^\d{3,4}$/
const PDF_RE = /^[A-Za-z0-9_.-]+\.PDF$/i

// Vercel's serverless response body is capped well under a pathological
// multi-page chart PDF's worst case — a clear error beats a silently
// truncated/corrupt PDF handed to pdfjs-dist on the client.
const MAX_BYTES = 4.5 * 1024 * 1024

export default async function handler(req, res) {
  const { cycle, pdf } = req.query ?? {}
  if (!CYCLE_RE.test(cycle ?? '') || !PDF_RE.test(pdf ?? '')) {
    return res.status(400).json({ error: 'cycle and pdf must match the FAA d-TPP metadata feed\'s own values' })
  }

  try {
    const upstream = await fetch(`${BASE}/${cycle}/${pdf}`, {
      headers: { 'User-Agent': 'AVIARA-App/1.0' },
      signal: AbortSignal.timeout(20000),
    })
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `FAA server returned ${upstream.status}` })
    }

    const contentLength = Number(upstream.headers.get('content-length') ?? 0)
    if (contentLength > MAX_BYTES) {
      return res.status(502).json({ error: 'Chart PDF is too large to proxy' })
    }

    const buffer = Buffer.from(await upstream.arrayBuffer())
    if (buffer.length > MAX_BYTES) {
      return res.status(502).json({ error: 'Chart PDF is too large to proxy' })
    }

    res.setHeader('Content-Type', 'application/pdf')
    // Charts only change once per 28-day cycle (baked into the cache key on
    // the client anyway) — safe to cache at the edge for a while.
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800')
    res.status(200).end(buffer)
  } catch (err) {
    res.status(502).json({ error: 'upstream fetch failed', detail: err.message })
  }
}
