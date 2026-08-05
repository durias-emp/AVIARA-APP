/* global process */
// Same AI-photo-extraction pattern as api/extract-poh-chart.js — read that
// file's header comment for why the prompt/logic is hand-duplicated here
// and again in vite.config.js's logbookPageDevProxy() rather than shared:
// client, dev-server, and serverless run in separate bundling contexts.
//
// Unlike a POH chart (fixed two-axis grid), a paper logbook page is N rows
// of a pilot's own column layout, which varies logbook to logbook — so the
// prompt asks the model to read whatever columns the page actually has and
// map them to this app's own field names, rather than assuming a fixed
// schema. Field key names here match src/lib/logbookFields.js.

const PROMPT = `You are reading a page photographed from a pilot's paper flight logbook. It has one row per flight, with column headers at the top — these vary between logbooks and pilots, so read whatever headers this specific page actually uses.

For each row, extract as many of these fields as the page has columns for (map the page's own column headers to these — e.g. a column labeled "A/C" or "Tail #" maps to aircraftReg; a column labeled "Total" or "Total Time" maps to totalTime):
- date (YYYY-MM-DD if the year is legible on the page, otherwise MM-DD)
- aircraftReg (tail number, e.g. N12345)
- from, to (departure/destination airport identifiers)
- route
- totalTime, pic, sic, night, solo, crossCountry (decimal hours or nm, exactly as printed)
- dayTakeoffs, nightTakeoffs, dayLandings, nightLandings (integer counts)
- actualInstrument, simulatedInstrument, holds, dualGiven, dualReceived, groundTraining (decimal hours or counts, exactly as printed)
- comments (any remarks column)

Read only what's actually legible and printed on the page — never invent or guess a value you can't clearly read, and never fill in a zero for a blank cell. If a cell is blank, illegible, or the page has no column for a field, omit that field from that row entirely.

Respond with strict JSON in exactly this shape, and nothing else:
{ "entries": [ { "date": "...", "aircraftReg": "...", "from": "...", ... }, ... ] }
Every entry in the array is one row/flight from the page, in the order they appear top to bottom.`

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { imageDataUrl } = req.body ?? {}
  if (!imageDataUrl?.startsWith('data:image/')) {
    return res.status(400).json({ error: 'imageDataUrl is required' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY not configured' })
  }

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        }],
      }),
    })

    if (!openaiRes.ok) {
      const err = await openaiRes.json().catch(() => ({}))
      return res.status(openaiRes.status).json({ error: err.error?.message ?? 'OpenAI request failed' })
    }

    const data = await openaiRes.json()
    const content = data.choices?.[0]?.message?.content

    let parsed
    try {
      parsed = JSON.parse(content)
    } catch {
      return res.status(502).json({ error: 'AI response was not valid JSON — try again' })
    }

    return res.status(200).json({ entries: Array.isArray(parsed.entries) ? parsed.entries : [] })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
