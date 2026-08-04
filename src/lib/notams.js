// NOTAMs — what's broken, closed or dangerous at an airport right now.
//
// Two sources, because no single free one covers both countries:
//
//   * NAV CANADA (plan.navcanada.ca) for Canadian aerodromes. Keyless, no
//     registration, and it reaches down to the small fields this app cares
//     about — CNA3 answers with six. It sends no CORS headers, hence the
//     proxy at api/notams.js
//   * the FAA NOTAM API for US fields, which needs a free api.faa.gov
//     client id/secret. Those live server-side only; until they are set the
//     proxy says so plainly and this file surfaces that message rather than
//     an empty list
//
// Both are asked for the same thing and answer in the same ICAO NOTAM text
// format, so everything below the fetch is shared. What differs is only how
// the raw text is dug out of each response.
//
// Anywhere else on earth this app has no NOTAM source, and says exactly that.
// "No NOTAMs" and "nowhere to ask" look identical on screen and mean opposite
// things to a pilot, so they are never conflated here.

import { get, put } from './db'
import { parseNotam, rankNotams } from './notamParse'

// The parser lives in notamParse.js so the backend worker can use exactly
// the same one — see docs/backend-architecture.md. Re-exported here because
// the UI already imports validity/isActive from this module, and moving the
// file should not mean touching every call site.
export { parseNotam, validity, isActive, classify } from './notamParse'

// NOTAMs are the most perishable thing this app displays and the most
// consequential to get stale, so this is deliberately short. A cached copy
// still beats nothing when offline, and its age always travels with it.
const MAX_AGE_MS = 10 * 60 * 1000

const keyFor = icao => `NOTAM:${icao}`

export const SOURCE_NAMES = { navcanada: 'NAV CANADA', faa: 'FAA' }

// Which authority publishes for this ident. Canada is every C-prefixed
// aerodrome (CY**, CZ**, and the CN/CG/CS.. small-field idents); the US is
// the same K/PA/PH set the rest of the app uses.
export function sourceFor(icao) {
  const id = (icao || '').toUpperCase()
  if (/^C/.test(id)) return 'navcanada'
  if (/^(K|PA|PH)/.test(id)) return 'faa'
  return null
}

// ── Sources ──────────────────────────────────────────────────

async function proxy(icao, source) {
  const res = await fetch(`/api/notams?icao=${encodeURIComponent(icao)}&source=${source}`,
    { signal: AbortSignal.timeout(15000) })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { /* handled below */ }
  if (!res.ok) {
    // The proxy reports a missing FAA credential as 501 with a message. That
    // is a configuration fact the pilot should see, not a generic failure.
    const err = new Error(data?.error || `NOTAM source returned ${res.status}`)
    err.status = res.status
    err.configuration = res.status === 501
    throw err
  }
  return data
}

function fromNavCanada(payload, icao) {
  // meta.messages carries per-site errors — asking for a weather station
  // rather than an aerodrome (CXBI) comes back as alpha.geomInvalid.
  const problem = (payload?.meta?.messages ?? []).find(m => m?.type === 'error')
  if (problem && !(payload?.data ?? []).length) {
    throw new Error(`NAV CANADA does not list ${icao} as an aerodrome`)
  }
  return (payload?.data ?? []).map(item => {
    let raw = '', english = null
    try {
      const t = JSON.parse(item.text)
      raw = t.raw ?? ''
      english = t.english ?? null
    } catch {
      raw = typeof item.text === 'string' ? item.text : ''
    }
    const n = parseNotam(raw, {
      icao, id: item.pk, start: item.startValidity, end: item.endValidity,
    })
    // The plain-language translation, where NAV CANADA supplies one, is
    // strictly easier to read than the abbreviated original — but the
    // original is kept, because it is the authoritative text.
    if (english) n.body = english
    return n
  })
}

// The FAA's documented v1 shape. Untested against the live service — it
// needs credentials this project does not yet have — so it is written to
// tolerate the response being shaped differently rather than to assume it
// is not: anything that fails to yield NOTAMs falls through to a clear
// error instead of an empty list that would read as "no NOTAMs here".
function fromFaa(payload, icao) {
  const items = payload?.items
  if (!Array.isArray(items)) {
    throw new Error('FAA NOTAM API returned an unexpected response shape')
  }
  const out = []
  for (const item of items) {
    const core = item?.properties?.coreNOTAMData?.notam
    if (!core) continue
    const translated = (item.properties.coreNOTAMData.notamTranslation ?? [])
      .find(t => t?.formattedText)?.formattedText
    out.push(parseNotam(translated || core.text || '', {
      icao, id: core.number ?? core.id, start: core.effectiveStart, end: core.effectiveEnd,
    }))
  }
  return out
}

// { icao, source, notams, fetchedAt, error, unsupported }
//
// Never throws. A country with no wired source comes back `unsupported`, a
// credential problem comes back with the message, and either way a cached
// copy is offered if there is one — all three are different from "this
// airport has no NOTAMs", which is `notams: []` with no error.
export async function loadNotams(icao) {
  const id = (icao || '').toUpperCase()
  const source = sourceFor(id)
  if (!source) {
    return { icao: id, source: null, notams: [], fetchedAt: Date.now(), error: null, unsupported: true }
  }

  const key = keyFor(id)
  const cached = await get('weather', key).catch(() => null)
  if (cached && Date.now() - (cached.fetchedAt ?? 0) < MAX_AGE_MS) return cached

  try {
    const payload = await proxy(id, source)
    const notams = (source === 'navcanada' ? fromNavCanada(payload, id) : fromFaa(payload, id))
      .sort(rankNotams)
    const record = { icao: key, source, notams, fetchedAt: Date.now(), error: null, unsupported: false }
    put('weather', record).catch(() => {})
    return { ...record, icao: id }
  } catch (err) {
    if (cached) return { ...cached, icao: id, error: err.message, stale: true }
    return {
      icao: id, source, notams: [], fetchedAt: Date.now(),
      error: err.message, configuration: !!err.configuration, unsupported: false,
    }
  }
}
