// Departure and arrival procedures — the named first and last thirds of a
// filed route.
//
// A clearance reads "CWARD2 SLI": fly the CWARD TWO departure, leave it at
// SLI. The procedure is the route, referenced by name rather than spelled out,
// and until this existed the app could print the name but not draw a metre of
// it. The pack is built by scripts/build_procedures.py from the FAA's CIFP.
//
// Only fix-terminated legs are stored, so what comes back can be drawn
// honestly. The legs that cannot — fly a heading until an altitude, until an
// intercept, until ATC turns you — are counted rather than invented, and every
// expansion reports how many of them it left out.

let _procs = null
async function load() {
  if (_procs) return _procs
  try {
    _procs = (await import('../data/navdata/procedures.json')).default
    return _procs
  } catch {
    return null                        // offline before the first download
  }
}

// There is deliberately no looksLikeProcedure() here.
//
// The obvious rule — letters then a revision digit — cannot be made to work:
// checked against the real tables it claims 165 airways (AR10, AR11 … are ATS
// routes, not departures) while still missing five genuine procedures named
// L711, O431, U142 and friends. The shapes overlap, so no pattern separates
// them. What does separate them is publication: a procedure is a procedure
// because it appears in this table, at this airport. The lookup below IS the
// test, and it is asked only after the airway and fix tables have declined
// the token.

export async function lookupProcedure(airport, ident) {
  const data = await load()
  if (!data) return null
  const apt = (airport || '').trim().toUpperCase()
  const id = (ident || '').trim().toUpperCase()
  return data[apt]?.[id] ?? null
}

// Turn a procedure into the fix sequence it actually flies.
//
// airport   the field it belongs to — a SID's departure, a STAR's destination
// ident     CWARD2, CAMRN5
// neighbour the route token next to it: for a SID the fix you rejoin the
//           airway structure at, for a STAR the fix you arrive from. That
//           name IS the transition's name, which is how "CWARD2 SLI" selects
//           one of several published paths through the same departure.
//
// Returns { t, fixes, transition, undrawable, partial } or null. `partial` is
// true when the procedure has enroute transitions but the neighbour matched
// none of them: the common portion is real, the rest of the path is not known
// from the route string alone, and the UI must not imply otherwise.
export async function expandProcedure(airport, ident, neighbour) {
  const proc = await lookupProcedure(airport, ident)
  if (!proc) return null

  const near = (neighbour || '').trim().toUpperCase()
  const transitions = proc.e ?? {}
  const names = Object.keys(transitions)
  const picked = names.includes(near) ? near : null

  // A SID runs common-then-transition; a STAR arrives on the transition and
  // ends on the common portion. Flying either the wrong way round would put
  // the route's fixes in reverse order down the map.
  const common = proc.c ?? []
  const leg = picked ? transitions[picked] : []
  const fixes = proc.t === 'SID' ? [...common, ...leg] : [...leg, ...common]

  // Consecutive duplicates: a transition usually restates the fix the common
  // portion ended on.
  const dedup = fixes.filter((f, i) => i === 0 || f !== fixes[i - 1])

  // "Partial" means the route rejoins somewhere this expansion does not reach.
  // It is NOT partial merely because no transition matched: a route reading
  // "CWARD2 CWARD" leaves the procedure exactly where its common portion ends,
  // which is complete. Only warn when the handover fix is genuinely absent
  // from what we drew.
  const end = proc.t === 'SID' ? dedup[dedup.length - 1] : dedup[0]
  const partial = names.length > 0 && !picked && near !== '' && near !== end

  return {
    t: proc.t,
    fixes: dedup,
    transition: picked,
    // Only the legs on the path actually drawn. The runway transitions are
    // counted separately and never included here: ALTNN2 carries seven
    // heading legs, one for each runway at Miami, and a departure flies
    // exactly one of them. Adding them up would be true of the record and
    // false of the flight.
    undrawable: (proc.uc ?? 0) + (picked ? (proc.ue?.[picked] ?? 0) : 0),
    // The runway-specific first segment is never drawn, because which one
    // applies is not known until the runway is. That is worth saying on every
    // departure that has them, not just the ones with heading legs.
    hasRunwayTransition: Boolean(proc.r && Object.keys(proc.r).length),
    partial,
    availableTransitions: names,
  }
}
