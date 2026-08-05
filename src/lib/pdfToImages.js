import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

// Renders each page of a PDF to a JPEG data URL, so a PDF logbook export
// (e.g. ForeFlight's "Print" / PDF export, or any other app's) can be fed
// through the same OCR pipeline already built for a photographed page
// (extractLogbookPage) — a PDF logbook export is normally a cleanly
// formatted table, which the vision model reads reliably without needing a
// separate raw-PDF-text/table-extraction path. That alternative would be
// far more fragile for spacing-based tables and need a different kind of
// dependency (a text/layout extractor rather than a renderer), so this app
// only added pdfjs-dist, purely to rasterize pages as images.
export async function pdfPagesToImages(file, { scale = 2 } = {}) {
  return pdfBytesToImages(await file.arrayBuffer(), { scale })
}

// Same rasterize-to-canvas rendering, for PDF bytes that didn't come from a
// browser File/Blob — e.g. a chart PDF fetched over the network (see
// src/lib/procedureCharts.js) rather than picked from a file input.
export async function pdfBytesToImages(bytes, { scale = 2 } = {}) {
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise
  const images = []
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')
    await page.render({ canvasContext: ctx, viewport }).promise
    images.push(canvas.toDataURL('image/jpeg', 0.9))
  }
  return images
}
