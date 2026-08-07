/* global process, Buffer */

/* Turn a photo of a real aeroplane into the app's house-style icon.

   Two steps, because the image models take text, not photographs. First a
   vision pass reads the aircraft off the photo — type, paint scheme, where
   the stripes run, the registration — and writes it down. Then that
   description drives the same generator the by-name path uses, so a photo
   icon and a typed-name icon come out of the same design language.

   The honest limit is the registration: diffusion models letter badly, and a
   tail number is exactly the kind of short precise string they garble. It is
   asked for, and it is often close, but it is not to be trusted as a record.
   The client says as much next to the result. */

const DESCRIBE = `You are looking at a photograph of an aircraft. Describe it for an illustrator who will draw a clean stylized icon of this specific aeroplane and has never seen the photo.

Report only what you can actually see. If something is not visible, say "not visible" rather than guessing a plausible value.

Cover, in this order:
1. Type: manufacturer and model if identifiable, otherwise the configuration (high-wing single, low-wing twin, light helicopter, business jet).
2. Registration exactly as painted, character by character.
3. Base paint colour, then every stripe or accent: its colour, where it starts and ends on the airframe, and its shape (straight, swept, wavy).
4. Distinguishing features: wheel fairings or fixed gear, wingtip shape, tail configuration, engine placement, window count.

Be specific and brief. No preamble.`

const RENDER = (desc, reg) =>
  `Create a stylized 3D transportation icon of this specific aircraft in a unified premium mobility-app design language inspired by modern ride-sharing vehicle illustrations.

THE AIRCRAFT TO DRAW:
${desc}

Follow that description closely. The paint scheme, stripe placement and airframe configuration are the point of this image — they identify one particular aeroplane, not a generic one.${
  reg ? `\n\nPaint the registration "${reg}" on the rear fuselage in clean sans-serif capitals, correctly spelled, at a size that stays legible.` : ''
}

Smooth simplified geometry with rounded edges, clean continuous surfaces, slightly softened proportions, instantly recognizable silhouette. Remove rivets, panel lines, antennas, warning labels and manufacturer logos — but keep the paint scheme and the registration, which are what make this aircraft itself.

Camera angle: front-left three-quarter view, elevated approximately 20 degrees above the aircraft, rotated approximately 35 degrees horizontally, centered composition, 85mm lens equivalent.

Lighting: soft studio lighting with subtle ambient occlusion, gentle shadows, smooth reflections, clean product-render quality. No dramatic highlights, no harsh shadows, no environmental reflections.

Style: high-end 3D clay render, industrial design visualization, transportation iconography, minimalistic mobility platform aesthetic.

Background: pure black (#000000).`

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { imageDataUrl, registration, hint } = req.body ?? {}
  if (!imageDataUrl?.startsWith('data:image/')) {
    return res.status(400).json({ error: 'A photo is required' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY not configured' })
  }

  const authed = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }

  try {
    // ── 1. Read the aeroplane off the photo ──
    const visionRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: authed,
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: hint?.trim() ? `${DESCRIBE}\n\nThe owner says this is a: ${hint.trim()}` : DESCRIBE },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        }],
      }),
    })

    if (!visionRes.ok) {
      const err = await visionRes.json().catch(() => ({}))
      return res.status(visionRes.status).json({ error: err.error?.message ?? 'Could not read the photo' })
    }

    const desc = (await visionRes.json()).choices?.[0]?.message?.content?.trim()
    if (!desc) return res.status(502).json({ error: 'Could not read the photo' })

    // The typed registration wins over whatever the photo pass thought it saw:
    // the pilot knows their own tail number, and the camera may have been at
    // an angle that hid half of it.
    const reg = registration?.trim()?.toUpperCase() || null

    // ── 2. Draw it in the house style ──
    const imgGen = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: authed,
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: RENDER(desc, reg),
        n: 1,
        size: '1024x1024',
        quality: 'standard',
      }),
    })

    if (!imgGen.ok) {
      const err = await imgGen.json().catch(() => ({}))
      return res.status(imgGen.status).json({ error: err.error?.message ?? 'Could not draw the aircraft' })
    }

    const imageUrl = (await imgGen.json()).data[0].url
    const buffer = await (await fetch(imageUrl)).arrayBuffer()

    return res.status(200).json({
      image: `data:image/png;base64,${Buffer.from(buffer).toString('base64')}`,
      description: desc,
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
