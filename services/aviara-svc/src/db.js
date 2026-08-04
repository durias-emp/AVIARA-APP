// The database handle.
//
// Service role, which bypasses RLS. That is correct here and dangerous
// everywhere else: this key must never reach a browser, which is the whole
// reason this worker exists as a separate deployable rather than another
// serverless function the PWA can reach.
//
// In dry-run mode there is no client at all. Every write goes through this
// module, so a stub that logs instead of writing makes the entire pipeline
// runnable — and reviewable — before anyone has touched production.

import { createClient } from '@supabase/supabase-js'
import { config } from './config.js'
import { log } from './log.js'

function dryRunClient() {
  const noop = { data: null, error: null, count: 0 }
  // Accumulated across the run so dry-run can prove the thing it exists to
  // prove: that a FIR-wide NOTAM seen at several aerodromes ends up findable
  // at all of them, rather than only the last one polled.
  const seen = new Map()

  const chain = () => ({
    upsert: () => Promise.resolve(noop),
    update: () => ({ eq: () => Promise.resolve(noop) }),
    delete: () => ({ lt: () => Promise.resolve(noop) }),
    select: () => ({
      order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
      eq: () => Promise.resolve({ data: [], error: null }),
      limit: () => Promise.resolve({ data: [], error: null }),
    }),
  })

  return {
    from: chain,
    rpc: (fn, args) => {
      if (fn !== 'upsert_notams') return Promise.resolve(noop)
      const rows = args?.p ?? []
      log.info(`[dry-run] upsert_notams: ${rows.length} rows`)
      for (const r of rows) {
        const key = `${r.source}/${r.notam_id}`
        const prev = seen.get(key)
        // Mirror what the SQL function does, so the dry run reflects reality.
        const merged = [...new Set([...(prev?.affected ?? []), ...r.affected])]
        seen.set(key, { ...r, affected: merged })
        if (prev) {
          log.info(`  merged ${key} -> affected now [${merged.join(' ')}]`)
        }
      }
      for (const r of rows.slice(0, 3)) {
        log.info(`  ${r.source}/${r.notam_id}  ${String(r.severity).padEnd(14)} ${r.category ?? ''} — ${(r.body ?? '').split('\n')[0].slice(0, 55)}`)
      }
      if (rows.length > 3) log.info(`  …and ${rows.length - 3} more`)
      return Promise.resolve({ data: rows.length, error: null })
    },
  }
}

export const db = config.dryRun
  ? dryRunClient()
  : createClient(config.supabaseUrl, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
