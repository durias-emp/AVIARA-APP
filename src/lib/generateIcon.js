export async function generateAircraftIcon(aircraftName) {
  return postForImage('/api/generate-aircraft-icon', { aircraftName })
}

// Photo in, house-style icon out. Same contract as the by-name generator, so
// callers treat the two the same; the server does the extra vision step.
export async function generateIconFromPhoto({ imageDataUrl, registration, hint }) {
  return postForImage('/api/aircraft-photo-icon', { imageDataUrl, registration, hint })
}

async function postForImage(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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
