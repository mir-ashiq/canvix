/**
 * Collaboration wire protocol (v0.5) — shared by server routes and client.
 *
 * Architecture: server-authoritative event log in Postgres (DesignEvent,
 * global monotonic seq) + SSE downstream + POST upstream. See
 * research/COLLABORATION-ARCHITECTURE.md for the decision record.
 */

import type { AnyElement, Background, PageData } from '@/lib/types'

// ── upstream (client → server) operations ─────────────────────

export type CollabOp =
  | { kind: 'elements:update'; pageId: string; ids: string[]; patch: Record<string, unknown> }
  | { kind: 'element:add'; pageId: string; element: AnyElement }
  | { kind: 'elements:add'; pageId: string; elements: AnyElement[] }
  | { kind: 'element:delete'; pageId: string; ids: string[] }
  | { kind: 'elements:reorder'; pageId: string; orderedIds: string[] }
  | { kind: 'page:add'; page: PageData; afterId?: string }
  | { kind: 'page:delete'; pageId: string }
  | { kind: 'page:dup'; pageId: string; newPageId: string }
  | { kind: 'page:background'; pageId: string; background: Background }
  | { kind: 'page:replace'; pageId: string; page: PageData }
  | { kind: 'pages:replace'; pages: PageData[]; width?: number; height?: number }
  | { kind: 'design:rename'; name: string }

export interface OpEnvelope {
  /** client-generated unique id — dedupe on replay */
  eventId: string
  op: CollabOp
}

// ── downstream (server → client) frames ───────────────────────

export interface DesignEventRow {
  seq: number
  id: string
  designId: string
  actorId: string
  kind: string
  payload: unknown
  createdAt: string
}

export interface PresenceRow {
  id: string
  name: string
  color: string
  cursor: {
    page: number
    x: number
    y: number
    selection?: string[]
  } | null
  lastSeen: string
}

/** One SSE data frame. */
export interface StreamFrame {
  /** events after the client's lastSeq (empty array = nothing new) */
  events: DesignEventRow[]
  /** live collaborators (lastSeen < 30 s), excluding the requesting pid */
  presence: PresenceRow[]
  /** current server seq (so clients can persist lastSeq even on empty frames) */
  seq: number
}

// ── client state ──────────────────────────────────────────────

export type CollabStatus = 'offline' | 'connecting' | 'live'

export interface Collaborator {
  id: string
  name: string
  color: string
  cursor: { page: number; x: number; y: number; selection?: string[] } | null
  lastSeen: number
}

// ── server-side op validation (mirrors the client's store ops) ─

export const OP_KINDS = new Set([
  'elements:update',
  'element:add',
  'elements:add',
  'element:delete',
  'elements:reorder',
  'page:add',
  'page:delete',
  'page:background',
  'page:replace',
  'pages:replace',
  'design:rename',
])

/** Hard payload cap per event — 256 KB (see security audit). */
export const MAX_EVENT_BYTES = 256 * 1024
/** Max events per POST flush. */
export const MAX_EVENTS_PER_FLUSH = 20

const FINITE_NUM_KEYS = new Set(['x', 'y', 'width', 'height', 'rotation', 'opacity', 'fontSize', 'lineHeight', 'letterSpacing', 'strokeWidth', 'cornerRadius', 'radius'])

/** Recursively validate that a payload contains only finite numbers & plain data (no functions/huge strings). */
export function validateOpPayload(op: CollabOp): boolean {
  try {
    const json = JSON.stringify(op)
    if (json.length > MAX_EVENT_BYTES) return false
    const walk = (v: unknown, depth: number): boolean => {
      if (depth > 12) return false
      if (v === null || v === undefined) return true
      if (typeof v === 'number') return Number.isFinite(v)
      if (typeof v === 'string') return v.length <= 100_000
      if (typeof v === 'boolean') return true
      if (Array.isArray(v)) return v.length <= 500 && v.every((x) => walk(x, depth + 1))
      if (typeof v === 'object') {
        const entries = Object.entries(v as Record<string, unknown>)
        if (entries.length > 60) return false
        for (const [k, val] of entries) {
          if (typeof val === 'number' && FINITE_NUM_KEYS.has(k) && !Number.isFinite(val)) return false
          if (!walk(val, depth + 1)) return false
        }
        return true
      }
      return false // functions, symbols, bigints — reject
    }
    return walk(op, 0)
  } catch {
    return false
  }
}
