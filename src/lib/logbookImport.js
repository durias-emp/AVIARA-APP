// Imports a ForeFlight logbook CSV export. Confirmed via research (not
// assumed): the file contains two sections back to back — a literal
// "Aircraft Table" marker row, a header row, aircraft data rows, then a
// literal "Flights Table" marker row, a header row, and flight data rows.
// Column sets are pilot-configurable in ForeFlight (the same "which fields
// matter to you" idea this app's own Logbook Fields settings screen
// implements) — there's no single fixed column list to hardcode, so this
// reads whatever headers actually appear and maps recognized ones via an
// alias table, rather than expecting an exact schema.
//
// No CSV parsing dependency exists in this project (checked package.json)
// and the format's real complexity (quoted fields, embedded commas) is
// small enough that hand-rolling a minimal RFC4180-ish parser here is
// simpler than adding one.

function parseCsvRows(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\r') {
      // skip — \n handles the actual row break, whether the file uses \n or \r\n
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = ''
    } else {
      field += c
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows
}

function splitSections(rows) {
  const aircraftIdx = rows.findIndex(r => (r[0] || '').trim() === 'Aircraft Table')
  const flightsIdx = rows.findIndex(r => (r[0] || '').trim() === 'Flights Table')
  if (aircraftIdx === -1 || flightsIdx === -1) return null
  return {
    aircraftRows: rows.slice(aircraftIdx + 1, flightsIdx),
    flightRows: rows.slice(flightsIdx + 1),
  }
}

function rowsToObjects(rows) {
  if (!rows.length) return []
  const headers = rows[0].map(h => h.trim())
  return rows.slice(1)
    .filter(r => r.some(c => c && c.trim()))
    .map(r => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])))
}

function normalizeHeader(h) {
  return (h || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

// Maps recognized ForeFlight column names (many casing/spacing variants seen
// in the wild) to this app's own logbook entry field keys — see
// src/lib/logbookFields.js for the field definitions these correspond to.
const FLIGHT_COLUMN_ALIASES = {
  date: ['date'],
  from: ['from', 'departureairport', 'origin'],
  to: ['to', 'destinationairport', 'destination'],
  route: ['route'],
  aircraftReg: ['aircraftid', 'tailnumber', 'registration'],
  totalTime: ['totaltime'],
  pic: ['pic'],
  sic: ['sic'],
  night: ['night'],
  solo: ['solo'],
  multiPilot: ['multipilot'],
  picus: ['picus'],
  examiner: ['examiner'],
  crossCountry: ['crosscountry', 'distance', 'xc'],
  // ForeFlight's own export puts the qualifier BEFORE the noun (e.g.
  // "Takeoff Day", "Landing Full-Stop Night", "TimeOut") — confirmed
  // against a real export, which is why these lists carry that word order
  // as well as the more "natural-reading" order this file originally
  // guessed at.
  dayTakeoffs: ['daytakeoffs', 'dayto', 'takeoffday'],
  nightTakeoffs: ['nighttakeoffs', 'nightto', 'takeoffnight'],
  dayLandings: ['daylandingsfullstop', 'daylandings', 'dayfullstops', 'landingfullstopday'],
  nightLandings: ['nightlandingsfullstop', 'nightlandings', 'nightfullstops', 'landingfullstopnight'],
  allLandings: ['alllandings'],
  actualInstrument: ['actualinstrument'],
  simulatedInstrument: ['simulatedinstrument', 'simulatedinstrumenthood'],
  holds: ['holds'],
  ifr: ['ifr'],
  hobbsStart: ['hobbsstart'],
  hobbsEnd: ['hobbsend'],
  tachStart: ['tachstart'],
  tachEnd: ['tachend'],
  outTime: ['outtime', 'out', 'timeout'],
  offTime: ['offtime', 'off', 'timeoff'],
  onTime: ['ontime', 'on', 'timeon'],
  inTime: ['intime', 'in', 'timein'],
  dualGiven: ['dualgiven'],
  dualReceived: ['dualreceived'],
  simulatedFlight: ['simulatedflight'],
  groundTraining: ['groundtraining'],
  groundTrainingGiven: ['groundtraininggiven'],
  nightVisionGoggles: ['nightvisiongoggles', 'nvg', 'nvgops'],
  // "Flight Review (FAA)" / "Checkride (FAA)" are checkbox-style columns in
  // ForeFlight (present because the pilot's account is set to US/FAA) —
  // there's no numeric UI field for these yet in logbookFields.js, but the
  // raw value is captured on the entry rather than dropped, so it's not
  // lost even before that UI exists.
  flightReviewCheck: ['flightreviewfaa', 'flightreview'],
  checkride: ['checkridefaa', 'checkride'],
  comments: ['pilotcomments', 'comments', 'flightcomments'],
}

// ForeFlight logs a variable number of approaches/crew per flight as
// numbered columns — Approach1, Approach2, ... and Person1, Person2, ... —
// so these need a pattern match rather than a fixed alias per exact number,
// or a flight with more approaches/crew than any we'd seen when writing the
// fixed list above would just report them as unrecognized.
const NUMBERED_COLUMN_PATTERNS = {
  approaches: /^approach(\d+)$/,
  people: /^person(\d+)$/,
}

const NORMALIZED_ALIASES = Object.fromEntries(
  Object.entries(FLIGHT_COLUMN_ALIASES).flatMap(([key, aliases]) =>
    aliases.map(a => [normalizeHeader(a), key])
  )
)

// `aircraftByReg` — a lookup of the pilot's OWN Hangar aircraft, keyed by
// normalized registration, so an imported flight can be linked to an
// aircraft already known to this app. A flight whose AircraftID isn't found
// there stays unlinked (aircraftId: null) rather than guessing or blocking
// the import — the review screen surfaces this so the pilot knows which
// aircraft to add first if they want it linked.
function mapFlightRow(raw, aircraftByReg) {
  const entry = { source: 'import' }
  const unrecognized = []
  const numbered = { approaches: [], people: [] }
  for (const [header, value] of Object.entries(raw)) {
    if (!value) continue
    const norm = normalizeHeader(header)

    const numberedKey = Object.keys(NUMBERED_COLUMN_PATTERNS)
      .find(k => NUMBERED_COLUMN_PATTERNS[k].test(norm))
    if (numberedKey) { numbered[numberedKey].push(value); continue }

    const key = NORMALIZED_ALIASES[norm]
    if (!key) { unrecognized.push(header); continue }
    if (key === 'aircraftReg') {
      const match = aircraftByReg[normalizeHeader(value)]
      entry.aircraftId = match?.id ?? null
      entry.aircraftReg = value
    } else {
      entry[key] = value
    }
  }
  if (numbered.approaches.length) entry.approaches = numbered.approaches
  if (numbered.people.length) entry.people = numbered.people
  return { entry, unrecognized }
}

// Links a flight's aircraftReg — from either a CSV import or a PDF-OCR'd
// page (src/pages/Pilot/LogbookImport.jsx uses this for both) — to the
// pilot's own Hangar aircraft, if a match exists. Shared so both import
// paths resolve aircraft identically rather than duplicating the lookup.
export function matchAircraftId(entry, aircraftList) {
  if (!entry.aircraftReg) return entry
  const aircraftByReg = Object.fromEntries(
    (aircraftList ?? []).filter(a => a.registration).map(a => [normalizeHeader(a.registration), a])
  )
  const match = aircraftByReg[normalizeHeader(entry.aircraftReg)]
  return { ...entry, aircraftId: match?.id ?? null }
}

// `aircraftList` — the pilot's own Hangar aircraft (from useActiveAircraft),
// used only to link imported flights to an aircraft already known here.
export function parseForeFlightCsv(text, { aircraftList = [] } = {}) {
  const rows = parseCsvRows(text)
  const sections = splitSections(rows)
  if (!sections) {
    return { error: 'Could not find "Aircraft Table" and "Flights Table" sections — this doesn\'t look like a ForeFlight logbook export.' }
  }

  const aircraftFromFile = rowsToObjects(sections.aircraftRows)
  const flightRowsRaw = rowsToObjects(sections.flightRows)

  const aircraftByReg = Object.fromEntries(
    aircraftList.filter(a => a.registration).map(a => [normalizeHeader(a.registration), a])
  )

  const unrecognizedSet = new Set()
  const flights = flightRowsRaw.map(raw => {
    const { entry, unrecognized } = mapFlightRow(raw, aircraftByReg)
    unrecognized.forEach(u => unrecognizedSet.add(u))
    return entry
  })

  return {
    aircraftFromFile,
    flights,
    unrecognizedColumns: [...unrecognizedSet],
  }
}
