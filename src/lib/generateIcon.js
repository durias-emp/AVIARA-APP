export async function generateAircraftIcon(aircraftName) {
  const res = await fetch('/api/generate-aircraft-icon', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aircraftName }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? 'Generation failed')
  return json.image  // data:image/png;base64,...
}
