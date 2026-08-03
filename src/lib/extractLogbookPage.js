import { resizeImageToDataUrl } from './imageResize'

async function postForExtraction(imageDataUrl) {
  const res = await fetch('/api/extract-logbook-page', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageDataUrl }),
  })

  // Same defensive text()-then-JSON.parse pattern as extractPohChart.js — a
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
  return json.entries ?? []
}

// A full logbook page's handwriting is smaller/denser than a single POH
// chart, so this uses a larger maxDim than extractPohChart.js's default
// (1600) to keep individual row entries legible after resizing.
export async function extractLogbookPage(file) {
  const imageDataUrl = await resizeImageToDataUrl(file, { maxDim: 2000 })
  return postForExtraction(imageDataUrl)
}

// For a PDF page already rendered to a data URL by pdfToImages.js — the
// canvas render is already sized appropriately, so this skips the
// createImageBitmap-based resize step extractLogbookPage uses for a raw
// photo file.
export async function extractLogbookPageFromDataUrl(imageDataUrl) {
  return postForExtraction(imageDataUrl)
}
