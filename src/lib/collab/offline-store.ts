/**
 * offline-store — durable local state for offline editing (v0.10).
 *
 * Two things must survive a reload / crash while offline:
 *   1. the working document (the editor's pages — autosave can't run)
 *   2. the queue of collab ops that never reached the server
 *
 * IndexedDB (not localStorage — full page JSON with thumbnails runs to
 * megabytes, and localStorage is a synchronous 5 MB string slot). The
 * wrapper is intentionally tiny: two object stores, key-value access,
 * structured-clone storage. Every method degrades to a no-op when IDB is
 * unavailable (SSR, private mode, ancient browsers) — offline durability
 * is best-effort, never a crash.
 */

import type { PageData } from '@/lib/types'

const DB_NAME = 'canvix-offline'
const DB_VERSION = 1
const DOCS = 'docs'
const QUEUES = 'queues'

/** persisted working document per design */
export interface OfflineDoc {
  designId: string
  name: string
  width: number
  height: number
  pages: PageData[]
  /** server `updatedAt` this doc was last known to be based on */
  baseUpdatedAt: string | null
  /** last server seq the local doc has absorbed (event replay cursor) */
  seq: number
  /** walltime of the last local persist (restore arbitration) */
  savedAt: number
}

/** persisted op queue per design (envelopes exactly as emitted) */
export interface QueuedEnvelope {
  eventId: string
  hlc?: string
  op: Record<string, unknown>
}

/** hard caps — a runaway offline session must not wedge the browser */
export const MAX_QUEUE = 500
export const MAX_DOC_PAGES = 200

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      return resolve(null)
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(DOCS)) db.createObjectStore(DOCS, { keyPath: 'designId' })
      if (!db.objectStoreNames.contains(QUEUES)) db.createObjectStore(QUEUES, { keyPath: 'designId' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
    req.onblocked = () => resolve(null)
  })
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null)
        try {
          const t = db.transaction(store, mode)
          const req = run(t.objectStore(store)) as IDBRequest<T>
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => resolve(null)
          t.onabort = () => resolve(null)
        } catch {
          resolve(null)
        }
      }),
  )
}

// ── working document ──────────────────────────────────────────

export async function putDoc(doc: OfflineDoc): Promise<boolean> {
  if (doc.pages.length > MAX_DOC_PAGES) return false
  const r = await tx<unknown>(DOCS, 'readwrite', (s) => s.put(doc))
  return r !== null
}

export async function getDoc(designId: string): Promise<OfflineDoc | null> {
  const r = await tx<OfflineDoc | undefined>(DOCS, 'readonly', (s) => s.get(designId))
  return r ?? null
}

// ── op queue ──────────────────────────────────────────────────

export async function putQueue(designId: string, queue: QueuedEnvelope[]): Promise<boolean> {
  const r = await tx<unknown>(QUEUES, 'readwrite', (s) =>
    s.put({ designId, queue: queue.slice(0, MAX_QUEUE) }),
  )
  return r !== null
}

export async function getQueue(designId: string): Promise<QueuedEnvelope[]> {
  const r = await tx<{ designId: string; queue: QueuedEnvelope[] } | undefined>(QUEUES, 'readonly', (s) =>
    s.get(designId),
  )
  return Array.isArray(r?.queue) ? r.queue : []
}

// ── purge (design deleted / permanently synced) ───────────────

export async function purge(designId: string): Promise<void> {
  await Promise.all([
    tx(DOCS, 'readwrite', (s) => s.delete(designId)),
    tx(QUEUES, 'readwrite', (s) => s.delete(designId)),
  ])
}

// ── restore arbitration (pure — unit tested) ──────────────────

export interface RestoreDecision {
  restore: boolean
  reason: 'queue' | 'newer-doc' | 'none'
}

/**
 * Decide whether the locally persisted document should replace the
 * freshly fetched server document on editor open.
 *
 *   - queue non-empty → we hold ops the server never accepted → restore
 *   - local doc persisted after the server's last save → our autosave
 *     failed (offline) → restore
 *   - otherwise the server document is authoritative → discard local
 *
 * `serverUpdatedAt` absent (legacy/mocked fetch) → only a non-empty
 * queue restores (conservative).
 */
export function decideRestore(
  local: OfflineDoc | null,
  serverUpdatedAt: string | undefined,
  queueLength: number,
): RestoreDecision {
  if (queueLength > 0 && local) return { restore: true, reason: 'queue' }
  if (!local) return { restore: false, reason: 'none' }
  if (serverUpdatedAt) {
    const serverMs = Date.parse(serverUpdatedAt)
    if (Number.isFinite(serverMs) && local.savedAt - serverMs > 2_000) {
      return { restore: true, reason: 'newer-doc' }
    }
  }
  return { restore: false, reason: 'none' }
}
