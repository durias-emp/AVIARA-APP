// FAA procedure chart lookups for the Airports section's Procedures tab.
// Two very different data shapes, two very different fetch strategies:
//
//   - The per-airport chart INDEX (which charts exist, and their pdf_name)
//     is bundled, build-time data — src/data/geo/procedures_index.json,
//     produced by scripts/build_procedure_index.py on the same FAA-cycle
//     cadence as the rest of this app's navdata. No fetch, no TTL: same
//     posture as every other bundled navdata file. Lazily imported (like
//     src/lib/aerodromes.js does for airport_details.json) since most
//     airport lookups never open the Procedures tab at all.
//   - The actual chart PDF bytes are fetched live, on demand, per chart a
//     pilot taps, via /api/procedure-chart (see that file's header comment
//     for why: committing every airport's charts into the repo isn't
//     reasonable, and "fresh from the FAA" is the one place currency
//     genuinely matters here).

import { get, put, getAll, del } from './db'
import { pdfBytesToImages } from './pdfToImages'

let _index = null
async function loadIndex() {
  if (!_index) _index = (await import('../data/geo/procedures_index.json')).default
  return _index
}

// { approach: [[chartName, pdfName]], departure: [...], visual: [...] },
// or null if this airport has nothing published (most small fields).
export async function getProcedures(icao) {
  const index = await loadIndex()
  return index[icao] ?? null
}

export async function getProceduresCycle() {
  const index = await loadIndex()
  return index._meta?.cycle ?? null
}

function cacheKey(icao, cycle, pdfName) {
  return `${icao}:${cycle}:${pdfName}`
}

// Renders a chart PDF to page images, cache-first. The cycle baked into the
// cache key means a new 28-day cycle is automatically a cache miss with no
// explicit invalidation logic — but nothing prunes an OLD cycle's rows on
// its own, so every write here also clears this airport's previous-cycle
// leftovers rather than letting them accumulate forever.
export async function fetchProcedureChartImages(icao, cycle, pdfName) {
  const key = cacheKey(icao, cycle, pdfName)
  const cached = await get('procedureChartImages', key).catch(() => null)
  if (cached?.images) return cached.images

  const res = await fetch(`/api/procedure-chart?cycle=${encodeURIComponent(cycle)}&pdf=${encodeURIComponent(pdfName)}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Chart fetch failed (${res.status})`)
  }
  const bytes = await res.arrayBuffer()
  const images = await pdfBytesToImages(bytes)

  await put('procedureChartImages', { key, icao, cycle, images, fetchedAt: Date.now() })
  pruneStaleCycles(icao, cycle).catch(() => {})
  return images
}

async function pruneStaleCycles(icao, currentCycle) {
  const all = await getAll('procedureChartImages')
  for (const row of all) {
    if (row.icao === icao && row.cycle !== currentCycle) {
      await del('procedureChartImages', row.key)
    }
  }
}
