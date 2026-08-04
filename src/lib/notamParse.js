// ICAO NOTAM text, parsed. Pure functions, no imports.
//
// Extracted from notams.js so the backend worker can use exactly the same
// parser as the app. Every authority publishes this same format, so this is
// the one piece of NOTAM handling that is genuinely universal — which is
// also why it must not drift between the two places that read it. One copy,
// no dependencies, runs identically in a browser and in Node.
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

// YYMMDDHHMM, always UTC.
export function icaoTime(s) {
  const m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(s || '')
  if (!m) return null
  const [, yy, mm, dd, hh, mi] = m
  const t = Date.UTC(2000 + +yy, +mm - 1, +dd, +hh, +mi)
  return Number.isFinite(t) ? t : null
}

// First letter of the Q-code subject. Coarse on purpose: the exact two-letter
// subjects run to several hundred, and a pilot scanning a list wants "is this
// about the runway or about paperwork", not a taxonomy.
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
  OB: 'Obstacle', OL: 'Obstacle lighting',
}

const CLOSED = new Set(['LC'])
const OUT = new Set(['AS', 'AU', 'AW', 'AC', 'AX', 'LD'])

export function classify(qcode) {
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
  // Collapse the blank lines runway-condition reports are padded with, and
  // drop the bracket that closes the NOTAM.
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
    // Does this NOTAM name the airport being looked at, or is it a FIR-wide
    // notice that happens to be returned for it? Every one of CYLS's five is
    // the latter, so without this split a small field looks like it has five
    // problems when it has none of its own.
    isLocal: !!upper && (affected.includes(upper) || scope === 'A'),
    startMs,
    endMs,
    permanent,
    estimated,
    body: body || text,
    raw: text,
  }
}

// Most consequential first within each group, then most recently started.
export function rankNotams(a, b) {
  const w = { closed: 0, unserviceable: 1, info: 2 }
  if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1
  if (w[a.severity] !== w[b.severity]) return w[a.severity] - w[b.severity]
  return (b.startMs ?? 0) - (a.startMs ?? 0)
}

// In force right now? A NOTAM that starts tomorrow is worth showing and worth
// distinguishing — it is the difference between "the taxiway is shut" and
// "the taxiway shuts on Tuesday".
export function isActive(n, now = Date.now()) {
  if (n.startMs && now < n.startMs) return false
  if (n.endMs && now > n.endMs) return false
  return true
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function stamp(ms) {
  const d = new Date(ms)
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${p(d.getUTCHours())}${p(d.getUTCMinutes())}Z`
}

// "03 Aug 1805Z — 14 Aug 2359Z", "From 05 Aug 1400Z", "permanent".
export function validity(n) {
  if (n.permanent) return n.startMs ? `${stamp(n.startMs)} — permanent` : 'Permanent'
  const from = n.startMs ? stamp(n.startMs) : null
  const to = n.endMs ? stamp(n.endMs) + (n.estimated ? ' (est)' : '') : null
  if (from && to) return `${from} — ${to}`
  if (from) return `From ${from}`
  if (to) return `Until ${to}`
  return null
}
