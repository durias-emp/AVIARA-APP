/* global process */
// Axis labels/units/output keys for each chart type, duplicated from
// src/lib/aircraftPerf.js's CHART_TYPES rather than imported — this file
// runs in a separate (Vercel serverless) runtime from the Vite-bundled
// client, same reasoning as the PROMPT template duplication already in
// generate-aircraft-icon.js / iconDevProxy().
const CHART_TYPE_META = {
  takeoff: { label: 'Takeoff Distance', axis1Label: 'Pressure Altitude', axis1Unit: 'ft', axis2Label: 'OAT', axis2Unit: '°C', outputs: [{ key: 'groundRoll', label: 'Ground Roll', unit: 'ft' }, { key: 'over50', label: 'Over 50ft', unit: 'ft' }] },
  landing: { label: 'Landing Distance', axis1Label: 'Pressure Altitude', axis1Unit: 'ft', axis2Label: 'OAT', axis2Unit: '°C', outputs: [{ key: 'groundRoll', label: 'Ground Roll', unit: 'ft' }, { key: 'over50', label: 'Over 50ft', unit: 'ft' }] },
  climb: { label: 'Climb Performance', axis1Label: 'Pressure Altitude', axis1Unit: 'ft', axis2Label: 'OAT', axis2Unit: '°C', outputs: [{ key: 'value', label: 'Rate of Climb', unit: 'fpm' }] },
  cruise: { label: 'Cruise Performance', axis1Label: 'Pressure Altitude', axis1Unit: 'ft', axis2Label: 'RPM / % Power', axis2Unit: '', outputs: [{ key: 'tas', label: 'TAS', unit: 'kt' }, { key: 'ff', label: 'Fuel Flow', unit: 'GPH' }] },
}

function buildPrompt(meta) {
  const outputsDesc = meta.outputs.map(o => `"${o.key}" (${o.label}${o.unit ? `, ${o.unit}` : ''})`).join(' and ')
  const cellShape = meta.outputs.length > 1
    ? `an object like {${meta.outputs.map(o => `"${o.key}": <number>`).join(', ')}}`
    : 'a plain number'

  return `You are reading a page photographed from an aircraft's Pilot Operating Handbook (POH), showing a ${meta.label} performance chart. It may be printed as a table or as a graph with gridlines.

This chart has two axes:
- Axis 1: ${meta.axis1Label} (${meta.axis1Unit}) — the chart's rows (or, on a graph, one set of gridlines)
- Axis 2: ${meta.axis2Label}${meta.axis2Unit ? ` (${meta.axis2Unit})` : ''} — the chart's columns (or the graph's other gridline set)

Each cell holds ${outputsDesc}.

Read the EXACT values printed on the chart's own rows/columns/gridlines — never invent round numbers or interpolate between printed values yourself. If a cell isn't legible or the chart doesn't cover it, omit it (use null) rather than guessing.

Also capture, in a couple of sentences, any correction-factor conditions printed on the chart itself (flaps setting, runway surface, headwind/weight assumptions, etc.) — this is for the pilot's own reference, not for you to apply.

Respond with strict JSON in exactly this shape, and nothing else:
{
  "axis1": { "values": [<numbers, ascending, exactly as printed>] },
  "axis2": { "values": [<numbers, ascending, exactly as printed>] },
  "cells": [ [ <row for axis1.values[0]>, <row for axis1.values[1]>, ... ] ],
  "notes": "<conditions printed on the chart, or an empty string>"
}
Each row in "cells" must have one entry per axis2 value, in the same order as "axis2.values", and each entry is ${cellShape} or null.`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { chartType, imageDataUrl } = req.body ?? {}
  const meta = CHART_TYPE_META[chartType]
  if (!meta) {
    return res.status(400).json({ error: 'chartType must be one of takeoff, landing, climb, cruise' })
  }
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
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: buildPrompt(meta) },
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

    let chart
    try {
      chart = JSON.parse(content)
    } catch {
      return res.status(502).json({ error: 'AI response was not valid JSON — try again' })
    }

    return res.status(200).json({ chart })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
