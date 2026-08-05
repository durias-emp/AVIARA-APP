// AVIARA-to-AVIARA PIREPs against supabase/migrations/0007_pireps.sql.
// Same { data, error } convention as uapReports.js/follows.js. These are
// shared only between AVIARA users — nothing here files anything with the
// FAA, and the UI must never imply otherwise.

import { supabase } from './supabase'

// A PIREP describes conditions at a moment; a 12-hour-old one is weather
// history, not weather. The layer and the query agree on this cutoff.
export const PIREP_MAX_AGE_HOURS = 12

// Vocabulary shared by the form (checkboxes), the DB constraints, and the
// popup decoder. Order matters: it's the display order everywhere.
export const PIREP_SKY = ['CLR', 'FEW', 'SCT', 'BKN', 'OVC']
export const PIREP_WX = ['RA', 'SN', 'FZRA', 'DZ', 'GR', 'FG', 'HZ', 'FU', 'TS']
export const PIREP_WX_LABELS = {
  RA: 'Rain', SN: 'Snow', FZRA: 'Freezing rain', DZ: 'Drizzle', GR: 'Hail',
  FG: 'Fog', HZ: 'Haze', FU: 'Smoke', TS: 'Thunderstorm',
}
export const PIREP_TURB = ['NEG', 'LGT', 'MOD', 'SEV', 'EXTM']
export const PIREP_ICING = ['NEG', 'TRACE', 'LGT', 'MOD', 'SEV']

export async function submitPirep(p) {
  const { data: s } = await supabase.auth.getSession()
  const uid = s.session?.user?.id
  if (!uid) return { data: null, error: new Error('Sign in to share PIREPs with other pilots') }
  const { data, error } = await supabase
    .from('pireps')
    .insert({ ...p, user_id: uid })
    .select()
    .single()
  return { data, error }
}

export async function listRecentPireps() {
  const since = new Date(Date.now() - PIREP_MAX_AGE_HOURS * 3600e3).toISOString()
  const { data, error } = await supabase
    .from('pireps')
    .select('*')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(500)
  return { data: data ?? [], error }
}
