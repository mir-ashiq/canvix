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
  createdAt: string
  updatedAt: string
}

function toRecord(row: Record<string, unknown>): DesignRecord {
  const pages = typeof row.pages === 'string' ? JSON.parse(row.pages || '[]') : (row.pages ?? [])
  return { ...(row as unknown as DesignRecord), pages: pages as PageData[] }
}

export function useDesigns() {
  const [designs, setDesigns] = useState<DesignMeta[] | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/designs', { cache: 'no-store' })
      if (res.ok) setDesigns(await res.json())
    } catch {
      setDesigns([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { designs, loading, refresh }
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
  if (!res.ok) throw new Error('Failed to create design')
  return toRecord(await res.json())
}

export async function fetchDesign(id: string): Promise<DesignRecord> {
  const res = await fetch(`/api/designs/${id}`, { cache: 'no-store' })
  if (!res.ok) throw new Error('Failed to fetch design')
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
  const res = await fetch(`/api/designs/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete design')
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
