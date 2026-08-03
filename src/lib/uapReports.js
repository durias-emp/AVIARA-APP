// Shared UAP report queries/mutations against
// supabase/migrations/0003_uap_reports.sql's uap_reports table. Plain async
// functions returning { data, error }, same convention as follows.js and
// messages.js. This is the shared/submitted-report path — local drafts
// before submission are handled entirely through src/lib/db.js's
// getAll/put/del against the IndexedDB 'uapReports' store, not here.

import { supabase } from './supabase'

// reporter_account_age_days and corroboration_group_id are never sent —
// the DB trigger and match_uap_corroboration() own those, respectively
// (see the migration's comments on why the client can't set either).
export async function submitUapReport(payload) {
  const { data, error } = await supabase.from('uap_reports').insert(payload).select().single()
  if (error) return { data: null, error }

  // Fire-and-forget — corroboration is a nice-to-have enrichment, not a
  // reason to make the pilot wait on their own submission finishing.
  supabase.rpc('match_uap_corroboration', { p_report_id: data.id }).then(({ error: rpcError }) => {
    if (rpcError) console.warn('UAP corroboration match failed:', rpcError)
  })

  return { data, error: null }
}

export async function listMySubmittedReports(myId) {
  const { data, error } = await supabase
    .from('uap_reports')
    .select('*')
    .eq('reporter_id', myId)
    .order('occurred_at', { ascending: false })
  return { data: data ?? [], error }
}
