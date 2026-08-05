// Configurable logbook field definitions — shared between the fields
// settings screen (src/pages/Pilot/LogbookFields.jsx, which toggles these on
// and off) and the entry form (LogbookEntryForm.jsx, which only renders
// whatever's currently enabled). Grouped into the same sections ForeFlight
// itself uses, since that's the explicit reference this feature is built
// against.
//
// Date/Aircraft/From/To, Total Time/PIC/Night, and the day/night takeoff and
// landing counts are NOT in here — they're core fields always shown on the
// entry form, matching how none of them appear as toggles on ForeFlight's
// own Configure Fields screen either.
//
// `type`: 'hours' (decimal number, gets a "USE {total}" quick-fill button),
// 'counter' (integer +/- stepper), 'number' (plain decimal, no quick-fill),
// 'text' (free text), 'group' (multiple sub-inputs under one toggle, e.g.
// Hobbs start/end).
export const FIELD_SECTIONS = [
  {
    section: 'General',
    fields: [
      { key: 'route', label: 'Route', type: 'text', default: true },
    ],
  },
  {
    section: 'Start & End',
    fields: [
      { key: 'hobbs', label: 'Hobbs', type: 'group', default: false,
        inputs: [{ key: 'hobbsStart', label: 'Start' }, { key: 'hobbsEnd', label: 'End' }] },
      { key: 'tach', label: 'Tach', type: 'group', default: false,
        inputs: [{ key: 'tachStart', label: 'Start' }, { key: 'tachEnd', label: 'End' }] },
      { key: 'outOffOnIn', label: 'Out/Off/On/In', type: 'group', default: false,
        inputs: [{ key: 'outTime', label: 'Out' }, { key: 'offTime', label: 'Off' }, { key: 'onTime', label: 'On' }, { key: 'inTime', label: 'In' }] },
      { key: 'dutyTime', label: 'Duty Time (On Duty - Off Duty)', type: 'group', default: false,
        inputs: [{ key: 'dutyOn', label: 'On Duty' }, { key: 'dutyOff', label: 'Off Duty' }] },
    ],
  },
  {
    section: 'Times',
    fields: [
      { key: 'sic', label: 'SIC', sublabel: 'Second in Command, Co-Pilot, P2, First Officer', type: 'hours', default: false },
      { key: 'solo', label: 'Solo', type: 'hours', default: true },
      { key: 'multiPilot', label: 'Multi-Pilot', type: 'hours', default: false },
      { key: 'picus', label: 'PICUS', sublabel: 'Pilot-in-command under supervision, ICUS, P1u/s, Command Practice', type: 'hours', default: false },
      { key: 'examiner', label: 'Examiner', type: 'hours', default: false },
    ],
  },
  {
    section: 'Cross Country',
    fields: [
      { key: 'crossCountry', label: 'Distance', type: 'number', default: true },
    ],
  },
  {
    section: 'Takeoffs & Landings',
    fields: [
      { key: 'allLandings', label: 'All Landings', type: 'counter', default: true },
    ],
  },
  {
    section: 'Instrument',
    fields: [
      { key: 'actualInstrument', label: 'Actual Instrument', sublabel: 'Instrument Meteorological Conditions', type: 'hours', default: true },
      { key: 'simulatedInstrument', label: 'Simulated Instrument', sublabel: 'Simulated Instrument Conditions', type: 'hours', default: true },
      { key: 'holds', label: 'Holds', type: 'counter', default: true },
      { key: 'ifr', label: 'IFR', sublabel: 'Operated under Instrument Flight Rules', type: 'hours', default: false },
    ],
  },
  {
    section: 'Training',
    fields: [
      { key: 'dualGiven', label: 'Dual Given', sublabel: 'Instructor, FI', type: 'hours', default: true },
      { key: 'dualReceived', label: 'Dual Received', sublabel: 'Dual', type: 'hours', default: true },
      { key: 'simulatedFlight', label: 'Simulated Flight', type: 'hours', default: true },
      { key: 'groundTraining', label: 'Ground Training', type: 'hours', default: true },
      { key: 'groundTrainingGiven', label: 'Ground Training Given', type: 'hours', default: false },
    ],
  },
  {
    section: 'Night Vision Goggles',
    fields: [
      { key: 'nightVisionGoggles', label: 'Night Vision Goggles', type: 'hours', default: false },
    ],
  },
]

// Flat lookup of every configurable field, for the entry form.
export const ALL_FIELDS = FIELD_SECTIONS.flatMap(s => s.fields)

export function defaultFieldConfig() {
  const config = {}
  for (const f of ALL_FIELDS) config[f.key] = f.default
  return config
}

// Sim time is excluded on purpose — it isn't flight time (see LogbookList.jsx's
// EntryRow comment) — so this is real logged hours only.
//
// Flights awaiting review are excluded for a different reason: the detector
// and the manual timer both file their results as pendingReview so the pilot
// can confirm them, and a total that counted them would be claiming hours
// nobody has agreed to yet. It would also move on its own, mid-flight, as the
// detector filed entries — a running total that changes without the pilot
// doing anything is not a total they can quote.
export function computeTotalHours(entries) {
  return (entries ?? [])
    .filter(e => e.pendingReview !== true)
    .reduce((sum, e) => sum + (parseFloat(e.totalTime) || 0), 0)
}
