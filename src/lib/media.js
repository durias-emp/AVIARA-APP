// Photos in and out of Supabase Storage.
//
// One public bucket, `aviara-media`, created in
// supabase/migrations/0004_stories_and_media.sql — that file explains why
// public, and what it costs. Everything that stores an image in this app
// goes through here so the path convention stays in one place: the storage
// policies key ownership off the folder structure, so a path built any other
// way is rejected by the database rather than quietly landing somewhere
// nobody owns.
//
//   <kind>/<user-uuid>/<random>.jpg
//
// Phone photos are downscaled first. A modern phone camera produces 4-8 MB
// per shot; a 1600 px JPEG is a fraction of that, indistinguishable in a
// feed, and the difference is entirely the pilot's mobile data.

import { supabase } from './supabase'
import { resizeImageToBlob } from './imageResize'

export const BUCKET = 'aviara-media'

// Long enough that a photo is fetched once and then never again — object
// names contain a uuid and are never reused, so a cached copy cannot go
// stale.
const CACHE_CONTROL = '31536000'

const uuid = () => (crypto.randomUUID
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`)

// Uploads one image. Returns { path, url }; throws with a readable message.
export async function uploadImage(file, { kind, userId, maxDim = 1600, quality = 0.82 }) {
  if (!userId) throw new Error('Not signed in')
  if (!file) throw new Error('No image given')

  const blob = await resizeImageToBlob(file, { maxDim, quality })
  const path = `${kind}/${userId}/${uuid()}.jpg`

  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: 'image/jpeg',
    cacheControl: CACHE_CONTROL,
    upsert: false,
  })
  if (error) throw new Error(error.message || 'Upload failed')

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return { path, url: data.publicUrl }
}

// Uploads several in sequence rather than in parallel.
//
// Parallel would be faster on a desk; on a phone uploading five 400 KB
// photos over a marginal connection it makes every one of them slower and
// fail together. Sequential also makes onProgress meaningful.
export async function uploadImages(files, { kind, userId, onProgress } = {}) {
  const out = []
  for (let i = 0; i < files.length; i++) {
    onProgress?.(i, files.length)
    out.push(await uploadImage(files[i], { kind, userId }))
  }
  onProgress?.(files.length, files.length)
  return out
}

// The object path inside a public URL, or null if it isn't one of ours.
// Public URLs look like:
//   https://<project>.supabase.co/storage/v1/object/public/aviara-media/<path>
const PUBLIC_MARKER = `/storage/v1/object/public/${BUCKET}/`
export function pathFromUrl(url) {
  const i = (url || '').indexOf(PUBLIC_MARKER)
  return i === -1 ? null : decodeURIComponent(url.slice(i + PUBLIC_MARKER.length))
}

// Best-effort cleanup. Deleting the row that references an image matters;
// leaving the bytes behind costs a little quota and nothing else, so this
// never throws and never blocks the delete that prompted it.
export async function removeByUrls(urls) {
  const paths = (urls || []).map(pathFromUrl).filter(Boolean)
  if (!paths.length) return
  try { await supabase.storage.from(BUCKET).remove(paths) } catch { /* quota, not correctness */ }
}

export async function removeByPaths(paths) {
  const list = (paths || []).filter(Boolean)
  if (!list.length) return
  try { await supabase.storage.from(BUCKET).remove(list) } catch { /* as above */ }
}
