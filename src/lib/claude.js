import { get, put } from './db'

const API_URL = 'https://api.anthropic.com/v1/messages'

export async function getApiKey() {
  const row = await get('settings', 'claudeApiKey')
  return row?.value ?? null
}

export async function saveApiKey(key) {
  await put('settings', { key: 'claudeApiKey', value: key.trim() })
}

const SYSTEM = `You are the PQRH Assistant — an expert aviation AI for pilots using the Pilot Quick Reference Handbook. You answer questions about:

- METAR and TAF interpretation
- FAR/AIM regulations and procedures
- Aircraft performance: pressure altitude, density altitude, V-speeds, weight & balance
- Flight planning and navigation
- Border crossing procedures (Canada, USA, Latin America)
- Pilot currency requirements (BFR, 90-day, IFR, medical)
- Airspace classifications and limits
- Light gun signals, squawk codes, lost comms procedures
- General aviation safety and best practices

Be concise, accurate, and safety-focused. Use standard aviation terminology. Always note that pilots must verify with official, current FAA FAR/AIM or Transport Canada documentation before flight.`

export async function askClaude(messages, apiKey) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-allow-browser': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: SYSTEM,
      messages,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error?.message ?? `HTTP ${res.status}`)
  }
  const data = await res.json()
  return data.content[0].text
}
