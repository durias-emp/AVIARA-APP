// Downscales a photo before it's sent to the POH-chart extraction API.
// Phone camera photos run several MB — sending that raw as a base64 JSON
// payload is slow, and vision models don't benefit from resolution far
// beyond what's needed to read printed chart text. Caps the longest edge
// and re-encodes as JPEG at a still-legible quality.
async function drawScaled(file, maxDim) {
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
  return canvas
}

export async function resizeImageToDataUrl(file, { maxDim = 1600, quality = 0.85 } = {}) {
  const canvas = await drawScaled(file, maxDim)
  return canvas.toDataURL('image/jpeg', quality)
}

// The same downscale, as a Blob rather than a data URL.
//
// Uploading to storage wants bytes, and going via toDataURL would base64 the
// image first — a third larger, and a needless string the size of the photo
// held in memory on a phone that is already juggling several of them.
export async function resizeImageToBlob(file, { maxDim = 1600, quality = 0.82 } = {}) {
  const canvas = await drawScaled(file, maxDim)
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) throw new Error('Could not read that image')
  return blob
}
