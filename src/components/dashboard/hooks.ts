'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DesignRecord, PageData } from '@/lib/types'

export interface DesignMeta {
  id: string
  name: string
  width: number
  height: number
  thumbnail: string | null
  source: string
  ownerId: string | null
  /** v0.9.1: ownerless + (this browser's attribution OR legacy) — i.e. the
   *  signed-in account may claim this design. Foreign anonymous designs
   *  are view/share-only and can never be claimed from here. */
  claimable?: boolean
  /** v0.9.1: ownerless AND attributed to this exact browser — the only rows
   *  the bulk "Save my designs" action will claim. */
  mine?: boolean
  /** v0.14 (D6): the folder this design is filed under (null = root). */
  folderId?: string | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

/** v0.14 (D6): one dashboard folder — the caller's own, always. */
export interface FolderMeta {
  id: string
  name: string
  createdAt: string
  designCount: number
}

function toRecord(row: Record<string, unknown>): DesignRecord {
  const pages = typeof row.pages === 'string' ? JSON.parse(row.pages || '[]') : (row.pages ?? [])
  return { ...(row as unknown as DesignRecord), pages: pages as PageData[] }
}

/** v0.8: fetch a JSON error body if the API produced one (server sends
 *  { error, code, fix } for database trouble) so the UI can show the fix. */
async function readApiError(res: Response): Promise<{ message: string; code?: string; fix?: string }> {
  try {
    const body = (await res.json()) as { error?: string; code?: string; fix?: string }
    return { message: body.error ?? 'Request failed', code: body.code, fix: body.fix }
  } catch {
    return { message: `Request failed (${res.status})` }
  }
}

export class ApiError extends Error {
  code?: string
  fix?: string
  constructor(message: string, code?: string, fix?: string) {
    super(message)
    this.code = code
    this.fix = fix
  }
}

/** v0.9.2: /api/designs is keyset-paginated (60 rows/page) — this is the
 * cursor the server hands back for the next page. */
interface DesignsPage {
  designs: DesignMeta[]
  nextCursor: { cursor: string; id: string } | null
}

async function fetchDesignsPage(
  cursor?: { cursor: string; id: string } | null,
  folderId?: string | null
): Promise<DesignsPage> {
  const params = new URLSearchParams()
  if (cursor) {
    params.set('cursor', cursor.cursor)
    params.set('id', cursor.id)
  }
  // v0.14 (D6): a folder filter scopes the list to that folder
  if (folderId) params.set('folder', folderId)
  const qs = params.toString()
  const res = await fetch(`/api/designs${qs ? `?${qs}` : ''}`, { cache: 'no-store' })
  if (!res.ok) {
    const err = await readApiError(res)
    throw new ApiError(err.message, err.code, err.fix)
  }
  const body = (await res.json()) as Partial<DesignsPage>
  return { designs: body.designs ?? [], nextCursor: body.nextCursor ?? null }
}

export function useDesigns(folderId?: string | null) {
  const [designs, setDesigns] = useState<DesignMeta[] | null>(null)
  // v0.14 (D6): the folder the held `designs` page belongs to. When it
  // differs from `folderId` the hook is (re)loading a new view — the
  // DERIVED `loading` below flips true synchronously on the switch,
  // without any setState inside the effect (react-hooks rule).
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  // v0.8: null = healthy; otherwise an error code/message from the API
  const [dbIssue, setDbIssue] = useState<string | null>(null)
  // v0.9.2: pagination state — true when the server says there is another page
  const [hasMore, setHasMore] = useState(false)
  const loadingMoreRef = useRef(false)
  const nextCursorRef = useRef<{ cursor: string; id: string } | null>(null)

  const refresh = useCallback(async () => {
    try {
      const page = await fetchDesignsPage(null, folderId)
      setDesigns(page.designs)
      setHasMore(page.nextCursor !== null)
      nextCursorRef.current = page.nextCursor
    } catch (err) {
      const e = err as ApiError
      setDbIssue(e.code ?? e.message)
      setDesigns([])
      setHasMore(false)
      nextCursorRef.current = null
    } finally {
      setLoadedFor(folderId ?? null)
    }
  }, [folderId])

  /** v0.9.2: append the next page (guard against double-clicks/stale calls). */
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !nextCursorRef.current) return
    loadingMoreRef.current = true
    try {
      const page = await fetchDesignsPage(nextCursorRef.current, folderId)
      nextCursorRef.current = page.nextCursor
      setHasMore(page.nextCursor !== null)
      setDesigns((prev) => (prev ? [...prev, ...page.designs] : page.designs))
    } catch {
      /* transient — the user can click Load more again */
    } finally {
      loadingMoreRef.current = false
    }
  }, [folderId])

  useEffect(() => {
    // kick the fetch off in a microtask so the effect body itself never
    // calls setState synchronously (react-hooks/set-state-in-effect);
    // refresh() only sets state after its awaits resolve anyway.
    // v0.14 (D6): switching folders re-runs this because refresh is
    // keyed on folderId.
    void Promise.resolve().then(() => refresh())
  }, [refresh])

  // loading = nothing loaded yet, OR the held page belongs to a
  // different folder than the one being viewed (mid-switch skeletons)
  const loading = designs === null || loadedFor !== (folderId ?? null)

  return { designs, loading, refresh, dbIssue, clearDbIssue: () => setDbIssue(null), hasMore, loadMore }
}

// ── v0.14 (D6): folders ─────────────────────────────────────

export function useFolders() {
  const [folders, setFolders] = useState<FolderMeta[] | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/folders', { cache: 'no-store' })
      if (!res.ok) throw new Error('failed')
      const body = (await res.json()) as { folders?: FolderMeta[] }
      setFolders(body.folders ?? [])
    } catch {
      setFolders([]) // honest empty tree — folders are never critical-path
    }
  }, [])

  useEffect(() => {
    void Promise.resolve().then(() => refresh())
  }, [refresh])

  return { folders, refresh }
}

export async function createFolder(name: string): Promise<FolderMeta> {
  const res = await fetch('/api/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    const err = await readApiError(res)
    throw new ApiError(err.message, err.code, err.fix)
  }
  const body = (await res.json()) as { folder: FolderMeta }
  return body.folder
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const res = await fetch(`/api/folders/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error('Failed to rename folder')
}

export async function deleteFolder(id: string): Promise<void> {
  const res = await fetch(`/api/folders/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete folder')
}

/** File a design into one of the caller's folders (null = the root). */
export async function moveDesignToFolder(id: string, folderId: string | null): Promise<void> {
  const res = await fetch(`/api/designs/${id}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderId }),
  })
  if (!res.ok) {
    const err = await readApiError(res)
    throw new ApiError(err.message, err.code, err.fix)
  }
}

export async function createDesign(opts: {
  name: string
  width: number
  height: number
  pages: PageData[]
  source?: string
  /** v0.14 (D6): create directly inside one of the caller's folders. */
  folderId?: string | null
}): Promise<DesignRecord> {
  const res = await fetch('/api/designs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: opts.name,
      width: opts.width,
      height: opts.height,
      pages: opts.pages,
      source: opts.source ?? 'blank',
      folderId: opts.folderId ?? null,
    }),
  })
  if (!res.ok) {
    const err = await readApiError(res)
    throw new ApiError(err.message, err.code, err.fix)
  }
  return toRecord(await res.json())
}

export async function fetchDesign(id: string): Promise<DesignRecord> {
  const res = await fetch(`/api/designs/${id}`, { cache: 'no-store' })
  if (!res.ok) {
    const err = await readApiError(res)
    throw new ApiError(err.message, err.code, err.fix)
  }
  return toRecord(await res.json())
}

export async function duplicateDesign(id: string, folderId?: string | null): Promise<DesignRecord> {
  const source = await fetchDesign(id)
  // v0.14 (D6): a duplicate stays in its folder when the caller asks
  // for it (the dashboard passes the design's folder only when it is
  // one of the caller's own — foreign folders 404 at the API).
  return createDesign({
    name: `${source.name} copy`,
    width: source.width,
    height: source.height,
    pages: source.pages,
    source: `duplicate:${id}`,
    folderId: folderId ?? null,
  })
}

export async function deleteDesign(id: string): Promise<void> {
  const res = await fetch(`/api/designs/${id}`, { method: 'DELETE' }) // soft delete -> Trash
  if (!res.ok) throw new Error('Failed to delete design')
  // v0.10: drop any locally persisted offline state for this design
  void purgeOfflineState(id)
}

/** v0.10: remove the IndexedDB offline doc + op queue for a design. */
async function purgeOfflineState(id: string): Promise<void> {
  try {
    const { purge } = await import('@/lib/collab/offline-store')
    await purge(id)
  } catch {
    /* IndexedDB unavailable — nothing persisted */
  }
  try {
    localStorage.removeItem(`canvix-seq-${id}`)
  } catch {
    /* storage unavailable */
  }
}

/** v0.4: trash list / restore / permanent delete */
export async function listTrash(): Promise<DesignMeta[]> {
  const res = await fetch('/api/designs?trash=1', { cache: 'no-store' })
  if (!res.ok) throw new Error('Failed to list trash')
  // v0.9.2: same paginated envelope as the main list — the trash dialog
  // only needs the most recent page.
  const body = (await res.json()) as Partial<DesignsPage>
  return body.designs ?? []
}

export async function restoreDesign(id: string): Promise<void> {
  const res = await fetch(`/api/designs/${id}/restore`, { method: 'POST' })
  if (!res.ok) throw new Error('Failed to restore design')
}

export async function deleteDesignForever(id: string): Promise<void> {
  const res = await fetch(`/api/designs/${id}?permanent=1`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete design permanently')
  void purgeOfflineState(id)
}

export async function renameDesign(id: string, name: string): Promise<void> {
  const res = await fetch(`/api/designs/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error('Failed to rename design')
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} d ago`
  return new Date(iso).toLocaleDateString()
}
