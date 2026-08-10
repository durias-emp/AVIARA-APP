// Where the official aerodrome chart for a field actually comes from.
//
// "The airport diagram" is a United States product. The FAA publishes one for
// every towered field in the d-TPP set, on a 28-day cycle, free, and this app
// already fetches and renders those (see lib/procedureCharts.js). Nothing else
// in the world works that way. Every other state publishes its aerodrome
// charts in its own AIP, on its own terms, most behind a portal that a phone
// cannot fetch a PDF from unattended, and several only as a paid subscription.
//
// So this module answers the question in whichever of two ways is true, and
// never in a third way that would be convenient:
//
//   'faa'        the FAA publishes an AIRPORT DIAGRAM for this field and the
//                app can open it, current cycle, offline once cached.
//   'authority'  the chart exists and this app does not carry it. The state's
//                own civil aviation authority is named, because a pilot who
//                needs the chart needs to know whose chart it is.
//
// There is deliberately no third branch that links to a chart site that is not
// the publisher. A scan of an aerodrome chart on a document-sharing site is
// not an official chart however good the scan is, and presenting one as though
// it were is exactly what this app may not do.

import { getProcedures, getProceduresCycle } from './procedureCharts'

// Who publishes the AIP, by ICAO location indicator prefix. Longest prefix
// wins, so PA/PH/PG resolve to the FAA before the single-letter fallbacks are
// reached. Only states this app is actually flown in are listed; anything else
// gets the honest generic answer below.
const AUTHORITY = [
  ['K', { name: 'FAA', country: 'United States', faa: true }],
  ['PA', { name: 'FAA', country: 'United States', faa: true }],
  ['PH', { name: 'FAA', country: 'United States', faa: true }],
  ['PG', { name: 'FAA', country: 'Guam and the Marianas', faa: true }],
  ['TJ', { name: 'FAA', country: 'Puerto Rico', faa: true }],
  ['TI', { name: 'FAA', country: 'the US Virgin Islands', faa: true }],
  ['C', { name: 'NAV CANADA', country: 'Canada' }],
  ['MM', { name: 'AFAC', country: 'Mexico' }],
  ['MZ', { name: 'the Department of Civil Aviation', country: 'Belize' }],
  ['MG', { name: 'DGAC', country: 'Guatemala' }],
  ['MS', { name: 'AAC', country: 'El Salvador' }],
  ['MH', { name: 'AHAC', country: 'Honduras' }],
  ['MN', { name: 'INAC', country: 'Nicaragua' }],
  ['MR', { name: 'DGAC', country: 'Costa Rica' }],
  ['MP', { name: 'AAC', country: 'Panama' }],
]

export function chartAuthority(icao) {
  const id = (icao ?? '').toUpperCase()
  let best = null
  for (const [prefix, info] of AUTHORITY) {
    if (id.startsWith(prefix) && (!best || prefix.length > best[0].length)) best = [prefix, info]
  }
  return best?.[1] ?? null
}

// The FAA's own d-TPP search, which is where a pilot goes when the bundled
// index has no diagram for a US field (a new one, or one that only ever had
// approach plates). The ident the search wants is the FAA one, so the K comes
// off, exactly as the Airports section already does it.
export function faaSearchUrl(icao) {
  const ident = (icao ?? '').toUpperCase().replace(/^K/, '')
  return `https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/dtpp/search/results/?cycle=&ident=${encodeURIComponent(ident)}`
}

// Resolve what this field's official chart situation is.
//
//   { kind: 'faa', pdf, cycle, label }        openable in the app
//   { kind: 'faa-search', url }               FAA covers it, no diagram bundled
//   { kind: 'authority', name, country }      published elsewhere, not by us
//   { kind: 'unknown' }                       no idea whose it is, and says so
export async function officialChart(icao) {
  const id = (icao ?? '').toUpperCase()
  const authority = chartAuthority(id)

  if (authority?.faa) {
    try {
      const procs = await getProcedures(id)
      const diagram = (procs?.airport ?? []).find(([name]) => /AIRPORT DIAGRAM/i.test(name))
      if (diagram) {
        return {
          kind: 'faa',
          label: diagram[0],
          pdf: diagram[1],
          cycle: await getProceduresCycle(),
        }
      }
    } catch {
      // The index is a lazily-imported chunk like every other pack here, and a
      // failed import must not take the plate down with it.
    }
    return { kind: 'faa-search', url: faaSearchUrl(id) }
  }

  if (authority) return { kind: 'authority', name: authority.name, country: authority.country }
  return { kind: 'unknown' }
}
