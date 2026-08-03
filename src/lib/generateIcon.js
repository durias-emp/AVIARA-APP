export async function generateAircraftIcon(aircraftName) {
  const res = await fetch('/api/generate-aircraft-icon', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aircraftName }),
  })

  // The endpoint always replies with JSON when it actually runs, but a dead
  // route (no serverless function behind it, a proxy timeout, a host-level
  // error page) replies with an empty or HTML body instead — res.json() on
  // that throws a "Unexpected end of JSON input" that meant nothing to the
  // user. Read as text first so a non-JSON reply becomes a plain message.
  const text = await res.text()
  let json
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(res.ok ? 'Server sent back something unexpected — try again' : `Server error (${res.status})`)
  }
  if (!res.ok) throw new Error(json.error ?? 'Generation failed')
  return json.image  // data:image/png;base64,...
}
