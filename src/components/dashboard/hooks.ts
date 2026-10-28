'use client'

import { useCallback, useEffect, useState } from 'react'
import type { DesignRecord, PageData } from '@/lib/types'

export interface DesignMeta {
  id: string
  name: string
  width: number
  height: number
  thumbnail: string | null
  source: string
  ownerId: string | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
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

export function useDesigns() {
  const [designs, setDesigns] = useState<DesignMeta[] | null>(null)
  const [loading, setLoading] = useState(true)
  // v0.8: null = healthy; otherwise an error code/message from the API
  const [dbIssue, setDbIssue] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/designs', { cache: 'no-store' })
      if (res.ok) {
        setDesigns(await res.json())
      } else {
        // v0.8: surface DB setup trouble (host switch, missing migration…)
        const err = await readApiError(res)
        setDbIssue(err.code ?? err.message)
        setDesigns([])
      }
    } catch {
      setDbIssue('NETWORK')
      setDesigns([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // kick the fetch off in a microtask so the effect body itself never
    // calls setState synchronously (react-hooks/set-state-in-effect);
    // refresh() only sets state after its awaits resolve anyway.
    void Promise.resolve().then(() => refresh())
  }, [refresh])

  return { designs, loading, refresh, dbIssue, clearDbIssue: () => setDbIssue(null) }
}

export async function createDesign(opts: {
  name: string
  width: number
  height: number
  pages: PageData[]
  source?: string
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

export async function duplicateDesign(id: string): Promise<DesignRecord> {
  const source = await fetchDesign(id)
  return createDesign({
    name: `${source.name} copy`,
    width: source.width,
    height: source.height,
    pages: source.pages,
    source: `duplicate:${id}`,
  })
}

export async function deleteDesign(id: string): Promise<void> {
  const res = await fetch(`/api/designs/${id}`, { method: 'DELETE' }) // soft delete -> Trash
  if (!res.ok) throw new Error('Failed to delete design')
}

/** v0.4: trash list / restore / permanent delete */
export async function listTrash(): Promise<DesignMeta[]> {
  const res = await fetch('/api/designs?trash=1', { cache: 'no-store' })
  if (!res.ok) throw new Error('Failed to list trash')
  return res.json()
}

export async function restoreDesign(id: string): Promise<void> {
  const res = await fetch(`/api/designs/${id}/restore`, { method: 'POST' })
  if (!res.ok) throw new Error('Failed to restore design')
}

export async function deleteDesignForever(id: string): Promise<void> {
  const res = await fetch(`/api/designs/${id}?permanent=1`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete design permanently')
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
