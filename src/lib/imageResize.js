// Downscales a photo before it's sent to the POH-chart extraction API.
// Phone camera photos run several MB — sending that raw as a base64 JSON
// payload is slow, and vision models don't benefit from resolution far
// beyond what's needed to read printed chart text. Caps the longest edge
// and re-encodes as JPEG at a still-legible quality.
export async function resizeImageToDataUrl(file, { maxDim = 1600, quality = 0.85 } = {}) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()

  return canvas.toDataURL('image/jpeg', quality)
}
