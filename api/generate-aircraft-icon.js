/* global process */
import { generateImage } from './_imageGen.js'
const PROMPT = (name) =>
  `Create a stylized 3D transportation icon of a ${name} in a unified premium mobility-app design language inspired by modern ride-sharing vehicle illustrations.

The aircraft should feature smooth, simplified geometry with rounded edges, clean continuous surfaces, and slightly softened proportions while maintaining its instantly recognizable silhouette. Remove all unnecessary technical details including rivets, panel lines, antennas, registration numbers, warning labels, logos, and surface markings.

Render the aircraft with a matte white body and dark smoked glass windows. Use a monochromatic palette consisting primarily of white, light gray, and black accents. The design should feel modern, premium, approachable, and technologically advanced.

Camera angle: front-left three-quarter view, elevated approximately 20 degrees above the aircraft, rotated approximately 35 degrees horizontally, centered composition, 85mm lens equivalent.

Lighting: soft studio lighting with subtle ambient occlusion, gentle shadows, smooth reflections, and clean product-render quality. No dramatic highlights, no harsh shadows, no environmental reflections.

Style: high-end 3D clay render, industrial design visualization, transportation iconography, minimalistic mobility platform aesthetic, consistent fleet design language, designed as if every aircraft in the world was created by the same artist.

Background: pure black (#000000).

The final image should resemble a premium mobility app vehicle icon rather than a realistic aircraft photograph. Maintain the aircraft's essential silhouette while simplifying forms into a clean, unified visual system.`

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { aircraftName } = req.body ?? {}
  if (!aircraftName?.trim()) {
    return res.status(400).json({ error: 'aircraftName is required' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY not configured' })
  }

  try {
    const image = await generateImage({ apiKey, prompt: PROMPT(aircraftName.trim()) })
    return res.status(200).json({ image })
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
}
