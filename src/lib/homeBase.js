// Where the pilot flies from, answered the same way everywhere.
//
// The home airport is written in two places, by two different flows:
//
//   settings/homeAirport   set when the pilot changes their base on the map,
//                          or at the end of onboarding
//   pilot.homeAirport      part of the pilot profile, filled during onboarding
//                          and edited from the profile screen
//
// Neither one is reliably present on its own. The map home read both and the
// route planner read only the first, so a pilot whose base lived on their
// profile saw it on the map and then found the planner's FROM field empty,
// which reads as the app forgetting something it had just shown them.
//
// This is the single answer both of them use. It does not try to reconcile the
// two records, because they are not always in conflict and picking a winner
// silently is how you lose the one the pilot actually meant. It prefers the
// explicit setting, which is the one a pilot changes deliberately.

import { get } from './db'

export async function resolveHomeIdent() {
  const row = await get('settings', 'homeAirport').catch(() => null)
  const pilot = await get('settings', 'pilot').catch(() => null)
  const ident = (row?.value || pilot?.homeAirport || '').trim().toUpperCase()
  return ident || null
}
