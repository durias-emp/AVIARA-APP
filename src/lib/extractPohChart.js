import { resizeImageToDataUrl } from './imageResize'

export async function extractPohChart(file, chartType) {
  const imageDataUrl = await resizeImageToDataUrl(file)

  const res = await fetch('/api/extract-poh-chart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chartType, imageDataUrl }),
  })

  // Same defensive text()-then-JSON.parse pattern as generateIcon.js — a
  // dead route or proxy timeout replies with an empty/HTML body instead of
  // JSON, and res.json() on that throws an opaque parse error.
  const text = await res.text()
  let json
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(res.ok ? 'Server sent back something unexpected — try again' : `Server error (${res.status})`)
  }
  if (!res.ok) throw new Error(json.error ?? 'Extraction failed')
  return json.chart  // { axis1: {values}, axis2: {values}, cells, notes }
}
