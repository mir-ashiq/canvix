'use client'

import type { Collaborator, CollabOp, CollabStatus, DesignEventRow, OpEnvelope, StreamFrame } from './protocol'
import { getClock } from './hlc'
import {
  MAX_QUEUE,
  getQueue as loadPersistedQueue,
  putQueue as persistQueue,
} from './offline-store'

/**
 * CollabSession — one per open design.
 *
 * Transport: SSE downstream (Postgres event log), POST upstream (batched).
 * - local ops queue and flush every 400 ms (≤ 20 per flush)
 * - cursor updates throttled (~300 ms), presence heartbeat every 15 s
 *   (v0.9.2: was 120 ms / 5 s — each write is a remote-DB upsert, and
 *   the old rates let a single moving mouse generate ~8 writes/s)
 * - reconnect with exponential backoff (0.5 s → 8 s), gap-free replay via ?since
 * - v0.10 offline merge: the op queue and the replay cursor persist
 *   (IndexedDB / localStorage) — edits made offline survive reloads and
 *   flush on reconnect; nothing is dropped while the network is down
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
  private persistTimer: ReturnType<typeof setTimeout> | null = null
  private booted = false

  // callbacks
  onStatus: ((s: CollabStatus) => void) | null = null
  onEvents: ((events: DesignEventRow[]) => void) | null = null
  onPresence: ((collaborators: Collaborator[]) => void) | null = null
  /** v0.10: pending-op count changes (offline badge) */
  onQueueDepth: ((n: number) => void) | null = null

  constructor(designId: string, pid: string, name: string, color: string) {
    this.designId = designId
    this.pid = pid
    this.name = name
    this.color = color
    // v0.10: resume the replay cursor from the last frame we consumed —
    // a reload must not replay the whole retained log over a fresh document
    try {
      const stored = Number(localStorage.getItem(`canvix-seq-${designId}`))
      if (Number.isFinite(stored) && stored > 0) this.lastSeq = stored
    } catch {
      /* storage unavailable — since=0 (gate-protected) */
    }
  }

  // ── lifecycle ─────────────────────────────────────────────

  // v0.11.1 fix: the browser's online/offline events are the only reliable
  // signal for a hard network cut — a silent SSE socket (server drop, NAT
  // timeout, emulated offline) never errors, so the status used to stay
  // "live" while every flush failed and queued. Listen and reflect it:
  // offline → honest 'offline' badge ("edits save locally"); online →
  // reconnect immediately instead of waiting out the backoff.
  private onOffline = () => this.setStatus('offline')
  private onOnline = () => {
    if (this.disposed) return
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.connect()
  }

  start() {
    if (this.disposed) return
    this.connect()
    this.flushTimer = setInterval(() => void this.flush(), 400)
    // v0.9.2: 15 s heartbeat — the server treats presence as live for 30 s,
    // so this still tolerates one lost beat before a collaborator fades out.
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), 15_000)
    if (typeof window !== 'undefined') {
      window.addEventListener('offline', this.onOffline)
      window.addEventListener('online', this.onOnline)
    }
    // v0.10: restore ops persisted while offline and flush them as soon as
    // we have a connection (they carry HLC stamps, so they merge safely no
    // matter what happened on the server meanwhile)
    if (!this.booted) {
      this.booted = true
      void loadPersistedQueue(this.designId).then((restored) => {
        if (this.disposed) return
        if (restored.length) {
          // persisted ops are older than anything typed this session —
          // front of the queue, flushed first
          this.queue = [...restored, ...this.queue].slice(0, MAX_QUEUE) as OpEnvelope[]
          this.scheduleQueuePersist()
          void this.flush()
        }
        this.onQueueDepth?.(this.queue.length)
      })
    }
  }

  dispose() {
    this.disposed = true
    this.setStatus('offline')
    if (this.flushTimer) clearInterval(this.flushTimer)
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.persistTimer) clearTimeout(this.persistTimer)
    if (typeof window !== 'undefined') {
      window.removeEventListener('offline', this.onOffline)
      window.removeEventListener('online', this.onOnline)
    }
    // v0.10: flush what we can one last time, then durably persist the rest
    void this.flush().finally(() => this.scheduleQueuePersist(0))
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
    // v0.10: persist the replay cursor (tiny; survives reloads/crashes)
    if (this.lastSeq > 0) {
      try {
        localStorage.setItem(`canvix-seq-${this.designId}`, String(this.lastSeq))
      } catch {
        /* storage unavailable */
      }
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
    // v0.10: every emitted write carries an HLC stamp — replicas (and the
    // server's PUT merge) arbitrate by it, so replay order never matters
    const hlc = getClock(this.pid).nowHlc()
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
          last.hlc = hlc
          return
        }
      }
    }
    this.queue.push({ eventId, hlc, op })
    if (this.queue.length > MAX_QUEUE) this.queue = this.queue.slice(-MAX_QUEUE)
    this.onQueueDepth?.(this.queue.length)
    this.scheduleQueuePersist()
    if (this.queue.length >= 20) void this.flush()
  }

  /** debounced durable persist of the pending queue (offline survival) */
  private scheduleQueuePersist(delay = 500) {
    if (this.persistTimer) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      void persistQueue(
        this.designId,
        this.queue as unknown as Array<{ eventId: string; hlc?: string; op: Record<string, unknown> }>,
      )
    }, delay)
  }

  private async flush() {
    if (!this.queue.length) return
    const batch = this.queue.splice(0, 20)
    try {
      const res = await fetch(`/api/collab/${encodeURIComponent(this.designId)}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pid: this.pid, name: this.name, color: this.color, events: batch }),
      })
      if (res.ok) {
        this.onQueueDepth?.(this.queue.length)
        this.scheduleQueuePersist(100)
      } else if (res.status === 404 || res.status === 503) {
        // design gone / db down — drop the queue (local editor still works)
        this.queue = []
        this.onQueueDepth?.(0)
        this.scheduleQueuePersist(0)
      } else {
        // transient server error — keep the batch for the next tick
        this.queue = [...batch, ...this.queue].slice(0, MAX_QUEUE)
      }
    } catch {
      // v0.10: OFFLINE — retain the batch at the front of the queue; the
      // next tick retries. Editing continues and nothing is dropped while
      // the network is down (bounded by MAX_QUEUE; queue + doc also persist).
      this.queue = [...batch, ...this.queue].slice(0, MAX_QUEUE)
      this.onQueueDepth?.(this.queue.length)
      this.scheduleQueuePersist(0)
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

  /** Throttled cursor broadcast (page coords + current selection).
   *  v0.9.2: 300 ms floor — ~3 updates/s is plenty for remote cursors and
   *  cuts the presence-write storm (each write is a remote-DB upsert). */
  sendCursor(cursor: { page: number; x: number; y: number; selection?: string[] }) {
    this.pendingCursor = cursor
    const now = Date.now()
    if (now - this.lastCursorSent < 300) return
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
