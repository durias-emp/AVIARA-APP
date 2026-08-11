// The three buttons on the map home, and what a pilot is allowed to put in
// them.
//
// They used to be fixed: weather, record, plan. Those are three good answers to
// "what is this drawer for", but they are not everyone's three. A pilot who
// never records and always files wants different buttons in the place their
// thumb already goes, and that place is worth more than any particular default.
//
// Keys, labels and where each one leads live here rather than in the screen, so
// the row and the settings list are choosing from one list instead of two that
// drift.

// `view` names a DRAWER_VIEWS entry, opened in the sheet. The three with no
// view are behaviours of this screen rather than doors, and the screen wires
// them itself.
export const HOME_ACTIONS = [
  { key: 'airports',  label: 'Airports',  view: 'airports' },
  { key: 'flight',    label: 'FPL',       view: 'flight' },
  { key: 'discover',  label: 'Social',    view: 'discover' },
  { key: 'hangar',    label: 'Hangar',    view: 'hangar' },
  { key: 'pilot',     label: 'Pilot',     view: 'pilot' },
  { key: 'calc',      label: 'Calculators', view: 'calc' },
  { key: 'reference', label: 'Reference', view: 'reference' },
  { key: 'settings',  label: 'Settings',  view: 'settings' },
  // Behaviours, not doors.
  { key: 'weather',   label: 'Weather' },
  { key: 'record',    label: 'Record' },
  { key: 'plan',      label: 'Plan Route' },
]

export function findAction(key) {
  return HOME_ACTIONS.find(a => a.key === key) ?? null
}

// Airports, the flight plan, and the social feed: the three a pilot opens most
// between flights, which is what this row is reached for most.
//
// Record is deliberately not among them any more, but it is still in the list
// above and can be put back into any of the three. Nothing else on this screen
// starts a recording, so a pilot who flies with the recorder should assign it.
export const DEFAULT_HOME_ACTIONS = ['airports', 'flight', 'discover']

export const HOME_ACTIONS_KEY = 'homeActions'

// Anything unrecognised falls back to the default in that position rather than
// blanking the slot: a key removed in a later version must not leave a pilot
// with a button that does nothing.
export function normaliseActions(value) {
  const arr = Array.isArray(value) ? value : []
  return DEFAULT_HOME_ACTIONS.map((fallback, i) => (
    findAction(arr[i]) ? arr[i] : fallback
  ))
}
