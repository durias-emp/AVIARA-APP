// Turning whatever a source gave us into rows in the mirror.
//
// The one rule that shapes this file: a NOTAM must never disappear from the
// mirror because of a transport failure. An empty answer from a source can
// mean "this field has nothing" or "something broke upstream", and those are
// indistinguishable at the HTTP layer. So nothing is ever deleted on the
// strength of an empty response — rows expire on their own `ends_at`, and
// `last_seen` records when a source last vouched for them.

import { parseNotam } from '../../../src/lib/notamParse.js'
import { db } from './db.js'
import { log } from './log.js'

// One RawNotam -> one row.
export function toRow(sourceId, icao, rawNotam) {
  const n = parseNotam(rawNotam.raw, {
    icao,
    id: rawNotam.notamId,
    start: rawNotam.startsAt,
    end: rawNotam.endsAt,
  })

  // The A) field is authoritative for which locations a NOTAM applies to,
  // but a source that returned it for an aerodrome is also telling us
  // something. Union of the two, so a NOTAM with an unparseable A) is still
  // findable at the field it came back for.
  const affected = [...new Set([...n.affected, icao.toUpperCase()])]

  return {
    source: sourceId,
    notam_id: String(rawNotam.notamId),
    fir: n.qcode ? (n.raw.match(/\bQ\)\s*([A-Z]{4})/)?.[1] ?? null) : null,
    affected,
    scope: n.scope || null,
    qcode: n.qcode || null,
    category: n.category,
    severity: n.severity,
    starts_at: n.startMs ? new Date(n.startMs).toISOString() : null,
    ends_at: n.endMs ? new Date(n.endMs).toISOString() : null,
    permanent: n.permanent,
    estimated: n.estimated,
    // Prefer a plain-language translation where the source supplies one; the
    // abbreviated original is always kept in `raw`.
    body: rawNotam.english || n.body,
    raw: n.raw,
    last_seen: new Date().toISOString(),
  }
}

// Upsert on (source, notam_id), via the upsert_notams function rather than
// PostgREST's own upsert.
//
// The difference matters and it is not cosmetic: a FIR-wide NOTAM comes back
// for every aerodrome in the FIR, and each fetch only knows about the one it
// asked about. A plain upsert replaces `affected`, so the last aerodrome
// polled becomes the only one that can find it — a runway closure quietly
// disappearing from every other field in the FIR. The function unions the
// array instead. See migration 0006.
export async function storeNotams(rows) {
  if (!rows.length) return { count: 0 }
  const { error } = await db.rpc('upsert_notams', { p: rows })
  if (error) throw new Error(`upsert failed: ${error.message}`)
  return { count: rows.length }
}

// Poll one aerodrome from one source and mirror the result.
export async function ingestAerodrome(source, icao) {
  const raws = await source.fetch(icao)
  const rows = raws.map(r => toRow(source.id, icao, r))
  await storeNotams(rows)
  return rows.length
}

// Housekeeping, not correctness: expiry is already enforced by `ends_at` on
// read, so this only stops the table growing without bound. The grace period
// exists because a NOTAM that lapsed an hour ago is still worth being able
// to explain to a pilot who saw it this morning.
export async function sweepExpired({ graceDays = 7 } = {}) {
  const cutoff = new Date(Date.now() - graceDays * 86400000).toISOString()
  const { error, count } = await db
    .from('notams')
    .delete({ count: 'exact' })
    .lt('ends_at', cutoff)
  if (error) { log.warn('sweep failed', error.message); return 0 }
  if (count) log.info(`swept ${count} expired NOTAMs`)
  return count ?? 0
}
