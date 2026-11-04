// ─────────────────────────────────────────────────────────────
// library-client — the uploads library API surface (v0.14, D1).
// Thin typed fetchers; the panel owns all state. Never touches the
// bytes — listing is projection-only by design.
// ─────────────────────────────────────────────────────────────

export interface LibraryItem {
  id: string
  mime: string
  name: string | null
  size: number
  createdAt: string
}

export interface LibraryResponse {
  items: LibraryItem[]
  usedBytes: number
  quotaBytes: number
}

export async function fetchLibrary(): Promise<LibraryResponse> {
  const res = await fetch('/api/media/library', { cache: 'no-store' })
  if (!res.ok) throw new Error(`Library unavailable (${res.status})`)
  return (await res.json()) as LibraryResponse
}

export async function renameLibraryItem(id: string, name: string): Promise<void> {
  const res = await fetch(`/api/media/library/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error('Could not rename.')
}

export async function removeLibraryItem(id: string): Promise<void> {
  const res = await fetch(`/api/media/library/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Could not remove.')
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
