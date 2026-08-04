// aviara-svc — the always-on half of AVIARA.
//
// Today it keeps the NOTAM mirror current. It exists because a static PWA and
// serverless functions that die per request cannot hold a subscription to a
// national NOTAM feed, cannot notice something changed while nobody had the
// app open, and cannot hold vendor credentials. See
// docs/backend-architecture.md for where this goes next — SWIM ingest, push
// notifications, and eventually the Leidos filing proxy.

import { createServer } from 'node:http'
import { config, assertConfig } from './config.js'
import { log } from './log.js'
import { db } from './db.js'
import { SOURCES, sourceById } from './sources/index.js'
import { ingestAerodrome, sweepExpired } from './ingest.js'

const state = { started: Date.now(), sweeps: 0, mirrored: 0, lastSweep: null, errors: 0 }

// Which aerodromes to poll, least-recently-polled first within priority.
// Falls back to the seed list on a cold start, so a fresh deployment mirrors
// something useful before anyone has opened the app.
async function dueForPoll(limit) {
  if (config.dryRun) {
    return config.seedIdents.map(ident => ({ ident, source: 'navcanada' }))
  }
  const { data, error } = await db
    .from('notam_watch')
    .select('ident, source')
    .order('priority', { ascending: false })
    .limit(limit)
  if (error) { log.warn('watch list read failed:', error.message); return [] }
  if (data?.length) return data
  return config.seedIdents.map(ident => ({ ident, source: 'navcanada' }))
}

// One pass over the watch list.
//
// Sequential with a delay rather than parallel: these are other people's
// public endpoints, and NAV CANADA's in particular is unauthenticated and
// free. Being a good citizen of it is worth more than a faster sweep.
async function sweep() {
  const targets = await dueForPoll(200)
  if (!targets.length) { log.info('nothing to poll'); return }

  let mirrored = 0, failed = 0
  for (const { ident, source: sourceId } of targets) {
    const source = sourceById(sourceId)
    if (!source || source.mode === 'stream') continue   // streams feed themselves
    if (source.configured === false) continue

    try {
      mirrored += await ingestAerodrome(source, ident)
      if (!config.dryRun) {
        await db.from('notam_watch')
          .update({ last_polled: new Date().toISOString(), last_error: null })
          .eq('ident', ident)
      }
    } catch (err) {
      failed++
      log.warn(`${ident} via ${sourceId}: ${err.message}`)
      if (!config.dryRun) {
        await db.from('notam_watch')
          .update({ last_polled: new Date().toISOString(), last_error: String(err.message).slice(0, 200) })
          .eq('ident', ident)
      }
    }
    const perMin = source.ratePerMin ?? 30
    await new Promise(r => setTimeout(r, Math.ceil(60000 / perMin)))
  }

  state.sweeps++
  state.mirrored += mirrored
  state.errors += failed
  state.lastSweep = new Date().toISOString()
  log.info(`sweep: ${targets.length} aerodromes, ${mirrored} NOTAMs mirrored, ${failed} failed`)
}

// Health endpoint. Fly and Railway both want one, and it doubles as the
// fastest way to see whether the mirror is actually moving.
function serveHealth() {
  createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({
      ok: true,
      uptimeSec: Math.round((Date.now() - state.started) / 1000),
      dryRun: config.dryRun,
      sources: SOURCES.map(s => ({
        id: s.id, mode: s.mode,
        configured: s.configured !== false,
      })),
      ...state,
    }, null, 1))
  }).listen(config.port, () => log.info(`health on :${config.port}`))
}

async function main() {
  assertConfig()
  log.info(`aviara-svc starting${config.dryRun ? ' (DRY RUN — no writes)' : ''}`)

  for (const s of SOURCES) {
    if (s.configured === false) log.warn(s.unconfiguredReason)
    else log.info(`source ${s.id} ready (${s.mode})`)
  }

  serveHealth()

  await sweep()
  setInterval(() => sweep().catch(e => log.error('sweep threw:', e.message)),
    config.pollIntervalSec * 1000)

  if (!config.dryRun) {
    // Daily. Housekeeping only — expiry is enforced on read.
    setInterval(() => sweepExpired().catch(e => log.warn('expiry sweep:', e.message)), 86400000)
  }
}

main().catch(err => { log.error(err.message); process.exit(1) })
