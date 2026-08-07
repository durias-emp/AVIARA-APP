/* global Buffer */

/* One place to ask OpenAI for a picture.

   This exists because both icon endpoints were pinned to dall-e-3, and that
   model was retired from the account without anything failing loudly — the
   feature simply returned an error to whoever pressed the button. Pinning the
   model in two files meant two things to miss. Now it is one constant.

   The newer image models reply with base64 in `b64_json` rather than a URL to
   fetch, so the download step the old code did is gone; `url` is still
   handled in case a future model goes back to it. */

export const IMAGE_MODEL = 'gpt-image-2'

export async function generateImage({ apiKey, prompt, size = '1024x1024' }) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: IMAGE_MODEL, prompt, n: 1, size }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const message = err.error?.message ?? 'Image generation failed'
    const e = new Error(message)
    e.status = res.status
    throw e
  }

  const item = (await res.json()).data?.[0]
  if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`

  if (item?.url) {
    const buf = await (await fetch(item.url)).arrayBuffer()
    return `data:image/png;base64,${Buffer.from(buf).toString('base64')}`
  }

  const e = new Error('The image service returned no image')
  e.status = 502
  throw e
}
