// Aircraft profile export/import — lets one pilot hand an aircraft's full
// setup to another without any account linking or backend. The "Share"
// button turns a profile into a small JSON file (sent via whatever the
// device's native Share sheet offers — Messages, AirDrop, email...); the
// recipient's "Import Aircraft" reads that file back into their own Hangar
// as a brand-new, independent aircraft.
const EXPORT_KIND = 'aviara-aircraft-profile'
const EXPORT_VERSION = 1

// Only these two keys are specific to *this device's copy* of the aircraft
// row — everything else in the profile is exactly what should travel with
// the share.
const STRIP_KEYS = ['id', 'deletedAt']

export function buildAircraftExport(profile) {
  const data = { ...profile }
  for (const key of STRIP_KEYS) delete data[key]
  return { kind: EXPORT_KIND, version: EXPORT_VERSION, data }
}

export function parseAircraftImport(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error("That file isn't a valid aircraft profile.")
  }
  if (parsed?.kind !== EXPORT_KIND || !parsed.data) {
    throw new Error("That file isn't a valid aircraft profile.")
  }
  return parsed.data
}

export function exportFileName(profile) {
  const base = (profile.registration || profile.fullName || profile.label || 'aircraft')
    .toString().trim().replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()
  return `${base || 'aircraft'}.aviaraaircraft.json`
}
