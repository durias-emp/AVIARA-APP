/* global process */
/* Preflight altitude briefing.
 *
 * The engine has already done the analysis: it sampled the route, pulled the
 * forecast profile, gathered the hazards, ran the aircraft's climb performance
 * and scored every legal altitude. This endpoint turns that into advice a pilot
 * can read — and nothing more.
 *
 * Two rules are enforced here rather than trusted to the prompt:
 *   1. The model may only choose from the candidate altitudes supplied. The
 *      illegal ones (below MEA, above ceiling, in cloud under VFR, in official
 *      severe icing) were removed before it ever saw them, and the client
 *      re-checks the answer against the same list.
 *   2. Every figure it may quote is in the payload. It is told not to compute,
 *      estimate or introduce numbers, and the app renders the engine's own
 *      values beside the prose so a drifted number is visible.
 */

const MODEL = process.env.ALTITUDE_BRIEF_MODEL || 'gpt-4o-mini'

const SYSTEM = `You are briefing a general-aviation pilot on cruise altitude selection for a flight they have already planned.

An analysis engine has done the work. You are given the route, the aircraft, the forecast profile, the hazards, and every legal cruise altitude with its computed block time, fuel, wind component and a scored list of reasons. Your job is to explain the choice like an experienced instructor sitting next to them.

Operating philosophy, in order:
- The highest practical altitude is usually best: better glide range, better true airspeed, better radio and radar coverage, cooler engine.
- Weather beats altitude. Icing, cloud that would put a VFR flight in IMC, and turbulence are reasons to come down or stay down.
- Performance beats ambition. A short leg cannot pay back a long climb, and a heavily loaded aircraft near its ceiling has no margin.
- Regulation is not negotiable: hemispheric rules, oxygen above 12,500 ft, Class A above FL180.

Hard rules for your answer:
- Choose ONLY from the candidate altitudes given. Never suggest one that is not in the list.
- Use ONLY the numbers in the payload. Do not calculate, estimate, round differently, or introduce any figure that is not there. If something is not in the payload, say it was not available rather than filling it in.
- Where a hazard is marked "modelled", call it modelled or derived — never a forecast.
- Be brief: 3-5 short sentences of reasoning, then the trade-off the pilot is accepting.
- End by noting the pilot has final authority.

Return JSON: { "altFt": <number from the candidate list>, "briefing": "<the advice>", "watchFor": "<one short sentence on the main thing to watch, or empty>" }`

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { payload } = req.body ?? {}
  if (!payload?.candidates?.length) {
    return res.status(400).json({ error: 'payload with candidates is required' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return res.status(503).json({ error: 'briefing not configured' })

  try {
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: JSON.stringify(payload) },
        ],
      }),
      signal: AbortSignal.timeout(25000),
    })

    if (!upstream.ok) {
      const detail = await upstream.text()
      return res.status(502).json({ error: 'briefing upstream failed', detail: detail.slice(0, 300) })
    }

    const data = await upstream.json()
    const text = data.choices?.[0]?.message?.content
    if (!text) return res.status(502).json({ error: 'empty briefing' })

    let parsed
    try { parsed = JSON.parse(text) } catch { return res.status(502).json({ error: 'unparseable briefing' }) }

    // Server-side half of rule 1. The client checks again — this is the cheap
    // place to catch it, not the only place.
    const legal = payload.candidates.map(c => c.altFt)
    if (!legal.includes(parsed.altFt)) {
      return res.status(200).json({
        altFt: null,
        briefing: parsed.briefing || '',
        watchFor: parsed.watchFor || '',
        rejected: `model chose ${parsed.altFt} ft, which was not among the legal candidates`,
      })
    }

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({
      altFt: parsed.altFt,
      briefing: String(parsed.briefing || '').slice(0, 2000),
      watchFor: String(parsed.watchFor || '').slice(0, 300),
      model: MODEL,
    })
  } catch (err) {
    res.status(502).json({ error: 'briefing failed', detail: err.message })
  }
}
