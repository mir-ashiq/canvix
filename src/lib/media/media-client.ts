// ─────────────────────────────────────────────────────────────
// media-client — chunked upload to the media store (v0.11).
//
// Serverless platforms cap request bodies (Vercel: 4.5 MB), so uploads
// are chunked: POST /api/media (init) → PATCH append (offset-guarded,
// resumable) → PUT finalize. 3 MB chunks keep every platform happy.
// ─────────────────────────────────────────────────────────────

export const CHUNK_SIZE = 3 * 1024 * 1024

export interface UploadHandle {
  id: string
  size: number
  mime: string
}

async function jsonFetch(url: string, init: RequestInit): Promise<{ status: number; json: any }> {
  const res = await fetch(url, init)
  let json: any = null
  try {
    json = await res.json()
  } catch {
    /* non-JSON error body */
  }
  return { status: res.status, json }
}

/** Upload a media file in chunks; onProgress reports 0..1. */
export async function uploadMediaFile(
  file: File,
  onProgress?: (ratio: number) => void,
): Promise<UploadHandle> {
  const init = await jsonFetch('/api/media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mime: file.type || 'application/octet-stream', size: file.size, name: file.name }),
  })
  if (init.status !== 201 || !init.json?.id) {
    throw new Error(init.json?.error ?? `Upload rejected (${init.status})`)
  }
  const id = init.json.id as string

  let offset = 0
  while (offset < file.size) {
    const chunk = file.slice(offset, Math.min(offset + CHUNK_SIZE, file.size))
    const res = await fetch(`/api/media/${id}?offset=${offset}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: chunk,
    })
    if (res.status !== 200) {
      let msg = `chunk failed (${res.status})`
      try {
        msg = (await res.json())?.error ?? msg
      } catch {
        /* keep default */
      }
      throw new Error(msg)
    }
    offset += chunk.size
    onProgress?.(Math.min(1, offset / Math.max(1, file.size)))
  }

  const fin = await jsonFetch(`/api/media/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedSize: file.size }),
  })
  if (fin.status !== 200) throw new Error(fin.json?.error ?? 'Finalize failed')

  return { id, size: file.size, mime: file.type || 'application/octet-stream' }
}

/** The element-facing src for a media id (same-origin, immutable cache). */
export function mediaSrc(id: string): string {
  return `/api/media/${id}`
}
