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

// ── ICAO NOTAM text ──────────────────────────────────────────
//
//   (D3009/26 NOTAMN
//   Q) CZYZ/QMXLC/IV/BO/A/000/999/4341N07938W005
//   A) CYYZ B) 2608051400 C) 2608051800
//   E) TWY DR, TWY D BTN TWY DQ AND TWY DT CLSD.)
//
// Q) carries the machine-readable part: FIR, a five-character Q-code, then
// traffic/purpose/scope and an altitude band. The Q-code is the useful bit —
// two letters of subject, two of condition — and it is what lets a list of
// forty NOTAMs be sorted into "runway closed" and "sanctions notice".

const RE_HEADER = /^\(\s*([A-Z]?\d{1,4}\/\d{2,4})\s+(NOTAM[NRC])(?:\s+([A-Z]?\d{1,4}\/\d{2,4}))?/
const RE_Q = /\bQ\)\s*([^\n]+)/
const RE_A = /\bA\)\s*([\s\S]*?)(?=\s+B\)|\n)/
const RE_B = /\bB\)\s*(\S+)/
const RE_C = /\bC\)\s*(\S+)/
const RE_E = /\bE\)\s*([\s\S]*?)(?=\n\s*[FG]\)\s|\s*\)\s*$|$)/
const RE_F = /\bF\)\s*(\S+)/
const RE_G = /\bG\)\s*(\S+)/

// YYMMDDHHMM, always UTC.
function icaoTime(s) {
  const m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(s || '')
  if (!m) return null
  const [, yy, mm, dd, hh, mi] = m
  const t = Date.UTC(2000 + +yy, +mm - 1, +dd, +hh, +mi)
  return Number.isFinite(t) ? t : null
}

// First letter of the Q-code subject. Coarse on purpose: the exact
// two-letter subjects run to several hundred, and a pilot scanning a list
// wants "is this about the runway or about paperwork", not a taxonomy.
const SUBJECT_GROUP = {
  A: 'Airspace', C: 'Communications', F: 'Aerodrome', G: 'GNSS',
  I: 'Instrument approach', L: 'Lighting', M: 'Movement area',
  N: 'Navaids', O: 'Other', P: 'Procedures', R: 'Airspace restriction',
  S: 'ATS services', W: 'Warnings',
}

// The handful worth naming exactly, because they are the ones that change a
// decision rather than colour it.
const SUBJECT_EXACT = {
  MR: 'Runway', MX: 'Taxiway', MN: 'Apron', MS: 'Stopway', MT: 'Threshold',
  FA: 'Aerodrome', FF: 'Firefighting', FU: 'Fuel',
  IC: 'ILS', PI: 'Instrument approach', LR: 'Runway lighting',
  RT: 'Restricted airspace', WU: 'Unmanned aircraft', WP: 'Parachuting',
  // Both sit in the catch-all 'O' group but are far too useful to leave
  // labelled "Other": CYLS's single local NOTAM today is an unlit 420 ft
  // tower 2.9 NM off the approach.
  OB: 'Obstacle', OL: 'Obstacle lighting',
}

// Condition codes that mean "you cannot use this", as opposed to a change
// or an advisory.
const CLOSED = new Set(['LC'])
const OUT = new Set(['AS', 'AU', 'AW', 'AC', 'AX', 'LD'])

function classify(qcode) {
  const subject = qcode.slice(1, 3)
  const condition = qcode.slice(3, 5)
  const label = SUBJECT_EXACT[subject] ?? SUBJECT_GROUP[subject[0]] ?? 'Other'
  const severity = CLOSED.has(condition) ? 'closed'
    : OUT.has(condition) ? 'unserviceable'
    : 'info'
  return { subject, condition, category: label, severity }
}

// Parses one raw NOTAM. Always returns an object: an unparseable one still
// shows its own text, because a NOTAM this code does not understand is
// exactly the one a pilot must still be able to read.
export function parseNotam(raw, { icao, id: fallbackId, start, end } = {}) {
  const text = (raw || '').trim()
  const header = RE_HEADER.exec(text)
  const q = RE_Q.exec(text)?.[1]?.trim() ?? ''
  const qparts = q.split('/')
  const qcode = (qparts[1] || '').toUpperCase()
  const scope = (qparts[4] || '').toUpperCase()

  const affected = (RE_A.exec(text)?.[1] ?? '').trim().split(/\s+/).filter(Boolean)
  const bodyRaw = RE_E.exec(text)?.[1] ?? ''
  // Collapse the blank lines NAV CANADA pads runway-condition reports with,
  // and drop the bracket that closes the NOTAM.
  const body = bodyRaw.replace(/\)\s*$/, '').replace(/\n{2,}/g, '\n').trim()

  const startMs = icaoTime(RE_B.exec(text)?.[1]) ?? (start ? Date.parse(start) : null)
  const endText = RE_C.exec(text)?.[1] ?? ''
  const permanent = /PERM|UFN/i.test(endText)
  const estimated = /EST$/i.test(endText)
  const endMs = permanent ? null : (icaoTime(endText) ?? (end ? Date.parse(end) : null))

  const cls = qcode.length >= 5 ? classify(qcode)
    : { subject: '', condition: '', category: 'Other', severity: 'info' }

  // Canadian runway surface condition reports are filed as QFAXX — plain
  // language about the aerodrome — which loses the one thing that makes them
  // worth finding in a list of thirty. The body says what the Q-code does
  // not, and RSC is a fixed prefix, so this is a read of the text rather
  // than a guess about it.
  if (/^RSC\b/.test(body)) cls.category = 'Runway surface'

  const id = header?.[1] ?? fallbackId ?? null
  const upper = (icao || '').toUpperCase()

  return {
    id,
    kind: header?.[2] ?? null,          // NOTAMN new / NOTAMR replaces / NOTAMC cancels
    replaces: header?.[3] ?? null,
    qcode,
    scope,
    affected,
    ...cls,
    // Does this NOTAM name the airport being looked at, or is it a
    // FIR-wide notice that happens to be returned for it? Every one of
    // CYLS's five is the latter, so without this split a small field looks
    // like it has five problems when it has none of its own.
    isLocal: !!upper && (affected.includes(upper) || scope === 'A'),
    startMs,
    endMs,
    permanent,
    estimated,
    body: body || text,
    raw: text,
  }
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

// Most consequential first within each group, then soonest-started.
function rank(a, b) {
  const w = { closed: 0, unserviceable: 1, info: 2 }
  if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1
  if (w[a.severity] !== w[b.severity]) return w[a.severity] - w[b.severity]
  return (b.startMs ?? 0) - (a.startMs ?? 0)
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
      .sort(rank)
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

// ── Formatting ───────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function stamp(ms) {
  const d = new Date(ms)
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${p(d.getUTCHours())}${p(d.getUTCMinutes())}Z`
}

// "03 Aug 1805Z — 14 Aug 2359Z", "from 05 Aug 1400Z", "permanent".
export function validity(n) {
  if (n.permanent) return n.startMs ? `${stamp(n.startMs)} — permanent` : 'Permanent'
  const from = n.startMs ? stamp(n.startMs) : null
  const to = n.endMs ? stamp(n.endMs) + (n.estimated ? ' (est)' : '') : null
  if (from && to) return `${from} — ${to}`
  if (from) return `From ${from}`
  if (to) return `Until ${to}`
  return null
}

// In force right now? A NOTAM that starts tomorrow is worth showing and
// worth distinguishing — it is the difference between "the taxiway is shut"
// and "the taxiway shuts on Tuesday".
export function isActive(n, now = Date.now()) {
  if (n.startMs && now < n.startMs) return false
  if (n.endMs && now > n.endMs) return false
  return true
}
