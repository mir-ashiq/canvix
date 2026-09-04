'use client'

import type { Collaborator, CollabOp, CollabStatus, DesignEventRow, OpEnvelope, StreamFrame } from './protocol'

/**
 * CollabSession — one per open design.
 *
 * Transport: SSE downstream (Postgres event log), POST upstream (batched).
 * - local ops queue and flush every 400 ms (≤ 20 per flush)
 * - cursor updates throttled (~120 ms), presence heartbeat every 5 s
 * - reconnect with exponential backoff (0.5 s → 8 s), gap-free replay via ?since
 *
 * Zustand stays the local rendering truth; collab never blocks input.
 */
export class CollabSession {
  readonly designId: string
  readonly pid: string
  readonly name: string
  readonly color: string

  status: CollabStatus = 'offline'
  lastSeq = 0

  private queue: OpEnvelope[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private es: EventSource | null = null
  private backoff = 500
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private processedEventIds = new Set<string>()
  private lastCursorSent = 0
  private pendingCursor: { page: number; x: number; y: number; selection?: string[] } | null = null

  // callbacks
  onStatus: ((s: CollabStatus) => void) | null = null
  onEvents: ((events: DesignEventRow[]) => void) | null = null
  onPresence: ((collaborators: Collaborator[]) => void) | null = null

  constructor(designId: string, pid: string, name: string, color: string) {
    this.designId = designId
    this.pid = pid
    this.name = name
    this.color = color
  }

  // ── lifecycle ─────────────────────────────────────────────

  start() {
    if (this.disposed) return
    this.connect()
    this.flushTimer = setInterval(() => void this.flush(), 400)
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), 5_000)
  }

  dispose() {
    this.disposed = true
    this.setStatus('offline')
    if (this.flushTimer) clearInterval(this.flushTimer)
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.es?.close()
    this.es = null
  }

  private setStatus(s: CollabStatus) {
    if (this.status === s) return
    this.status = s
    this.onStatus?.(s)
  }

  private connect() {
    if (this.disposed) return
    this.setStatus('connecting')
    this.es?.close()
    const url = `/api/collab/${encodeURIComponent(this.designId)}/stream?since=${this.lastSeq}&pid=${encodeURIComponent(this.pid)}`
    const es = new EventSource(url)
    this.es = es

    es.onopen = () => {
      this.backoff = 500
      this.setStatus('live')
    }
    es.onmessage = (ev) => {
      try {
        const frame = JSON.parse(ev.data) as StreamFrame
        this.handleFrame(frame)
      } catch {
        /* malformed frame — ignore, the log replays on reconnect */
      }
    }
    es.onerror = () => {
      // EventSource auto-retries, but our since-param is stale in its retry URL
      // → close and reconnect manually with the fresh lastSeq
      es.close()
      if (this.es === es) this.es = null
      if (this.disposed) return
      this.setStatus('connecting')
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    if (this.disposed || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, this.backoff)
    this.backoff = Math.min(this.backoff * 1.8, 8_000)
  }

  private handleFrame(frame: StreamFrame) {
    if (typeof frame.seq === 'number' && frame.seq >= this.lastSeq) {
      // only advance on the server's max seq when we have consumed everything
    }
    const events = (frame.events ?? []).filter((e) => e.actorId !== this.pid && !this.processedEventIds.has(e.id))
    for (const e of frame.events ?? []) {
      this.processedEventIds.add(e.id)
    }
    // bound the dedupe set (old ids can never replay after log pruning)
    if (this.processedEventIds.size > 5_000) {
      this.processedEventIds = new Set([...this.processedEventIds].slice(-2_000))
    }
    if (events.length) {
      this.lastSeq = Math.max(this.lastSeq, ...events.map((e) => e.seq))
      this.onEvents?.(events)
    }
    if (typeof frame.seq === 'number') {
      // server max seq — safe to track even without events (ids are monotonic)
      if (frame.seq > this.lastSeq && (frame.events ?? []).length === 0) this.lastSeq = frame.seq
    }
    const now = Date.now()
    this.onPresence?.(
      (frame.presence ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        cursor: p.cursor ?? null,
        lastSeen: now,
      }))
    )
  }

  // ── upstream ──────────────────────────────────────────────

  /** Queue a local op (deduped by eventId, applied optimistically locally). */
  emit(op: CollabOp, eventId: string) {
    if (this.disposed) return
    // coalesce consecutive elements:update patches for the same ids (drags/typing) —
    // keeps the event log small and the fan-out cheap
    if (op.kind === 'elements:update') {
      const last = this.queue[this.queue.length - 1]
      if (last && last.op.kind === 'elements:update') {
        const prev = last.op
        if (
          prev.pageId === op.pageId &&
          prev.ids.length === op.ids.length &&
          op.ids.every((id) => prev.ids.includes(id))
        ) {
          last.op = { kind: 'elements:update', pageId: prev.pageId, ids: prev.ids, patch: { ...prev.patch, ...op.patch } }
          return
        }
      }
    }
    this.queue.push({ eventId, op })
    if (this.queue.length >= 20) void this.flush()
  }

  private async flush() {
    if (this.disposed || !this.queue.length) return
    const batch = this.queue.splice(0, 20)
    try {
      const res = await fetch(`/api/collab/${encodeURIComponent(this.designId)}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pid: this.pid, name: this.name, color: this.color, events: batch }),
      })
      if (!res.ok && (res.status === 404 || res.status === 503)) {
        // design gone / db down — drop the queue (local editor still works)
        this.queue = []
      }
    } catch {
      /* offline — re-queue once for a retry on the next tick, else drop */
      if (this.queue.length < 40) this.queue = [...batch.slice(0, 5), ...this.queue]
      else this.queue = []
    }
  }

  private async heartbeat() {
    if (this.disposed) return
    try {
      await fetch(`/api/collab/${encodeURIComponent(this.designId)}/presence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pid: this.pid,
          name: this.name,
          color: this.color,
          cursor: this.pendingCursor,
        }),
      })
    } catch {
      /* offline — heartbeat retries on the next interval */
    }
  }

  /** Throttled cursor broadcast (page coords + current selection). */
  sendCursor(cursor: { page: number; x: number; y: number; selection?: string[] }) {
    this.pendingCursor = cursor
    const now = Date.now()
    if (now - this.lastCursorSent < 120) return
    this.lastCursorSent = now
    void fetch(`/api/collab/${encodeURIComponent(this.designId)}/presence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pid: this.pid,
        name: this.name,
        color: this.color,
        cursor,
      }),
    }).catch(() => {
      /* offline */
    })
  }
}
