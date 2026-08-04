// Configuration, and the checks that stop this starting in a half-state.
//
// A worker that boots without a database and then quietly mirrors nothing is
// the failure mode to design against, so anything missing is fatal at start
// rather than an error thirty minutes later that nobody is watching for.

export const config = {
  supabaseUrl: process.env.SUPABASE_URL ?? '',
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',

  // Runs the whole pipeline — fetch, parse, build rows — and prints what it
  // would write instead of writing. Needs no credentials, so the ingest can
  // be reviewed against live NOTAM data before production is involved.
  dryRun: process.env.DRY_RUN === '1',

  // Seconds between sweeps of the watch list.
  pollIntervalSec: Number(process.env.POLL_INTERVAL_SEC ?? 300),

  // Airports to mirror on a cold start, before real usage has populated the
  // watch list. Deliberately short: the list is meant to grow from what
  // pilots actually open, not from enumerating a continent.
  seedIdents: (process.env.SEED_IDENTS ?? 'CYYZ,CYLS,CYQA,CYVR,CYUL,CYYC,CYOW,CYHM')
    .split(',').map(s => s.trim().toUpperCase()).filter(Boolean),

  port: Number(process.env.PORT ?? 8080),
}

export function assertConfig() {
  if (config.dryRun) return
  const missing = []
  if (!config.supabaseUrl) missing.push('SUPABASE_URL')
  if (!config.serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY')
  if (missing.length) {
    throw new Error(
      `Missing required config: ${missing.join(', ')}.\n` +
      'Set them, or run with DRY_RUN=1 to exercise ingest without a database.'
    )
  }
}
