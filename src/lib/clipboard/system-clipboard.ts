// ─────────────────────────────────────────────────────────────
// system-clipboard — cross-tab copy & OS paste (v0.14, D2).
//
// The in-editor clipboard stays the same-tab fast path (the store's
// module-level array, zero latency, no permissions). This module adds
// the SYSTEM side: copying writes a Canvix envelope to the OS
// clipboard (custom MIME + text/plain fallback so Firefox — which
// only supports writeText — still round-trips), and the paste path
// accepts the envelope back, OS image files, or falls back to the
// internal clipboard.
//
// Pasting is an UNTRUSTED INPUT surface: anything on the other side
// of the OS clipboard can hand us JSON. sanitizePastedElements keeps
// only known element types, caps every string/array/depth, forces
// finite geometry, and drops dangerous keys — the document pipeline
// only ever sees shapes it could have produced itself.
// ─────────────────────────────────────────────────────────────

import type { AnyElement, ElementType } from '@/lib/types'

export const CANVIX_MIME = 'application/x-canvix'

const KNOWN_TYPES: ReadonlySet<string> = new Set([
  'text', 'rect', 'ellipse', 'triangle', 'star', 'line', 'path', 'stroke',
  'image', 'sticker', 'group', 'table', 'frame', 'embed', 'audio', 'video', 'plugin',
])

export const MAX_PASTE_ELEMENTS = 50
const MAX_STRING = 20_000
const MAX_ARRAY = 600
const MAX_DEPTH = 8
const MAX_FILED_KEYS = 80

interface Envelope {
  app: 'canvix'
  v: 1
  elements: unknown[]
}

/** The JSON envelope written to the OS clipboard. */
export function serializeEnvelope(elements: AnyElement[]): string {
  const env: Envelope = { app: 'canvix', v: 1, elements }
  return JSON.stringify(env)
}

/** deep-sanitize one pasted value; returns null when it must be dropped */
function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return null
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.length > MAX_STRING ? null : value
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY) return null
    const out: unknown[] = []
    for (const v of value as unknown[]) {
      const s = sanitizeValue(v, depth + 1)
      if (s !== null) out.push(s)
    }
    return out
  }
  if (typeof value === 'object') {
    const src = value as Record<string, unknown>
    const keys = Object.keys(src)
    if (keys.length > MAX_FILED_KEYS) return null
    const out: Record<string, unknown> = {}
    for (const k of keys) {
      // prototype-pollution & dunder keys never survive a paste
      if (k === '__proto__' || k === 'constructor' || k === 'prototype' || k.startsWith('_')) continue
      const s = sanitizeValue(src[k], depth + 1)
      if (s !== null) out[k] = s
    }
    return out
  }
  return null
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? (v as number) : fallback
  return Math.min(max, Math.max(min, Math.round(n * 100) / 100))
}

/**
 * Validate + sanitize pasted elements. Only known types survive; ids
 * are NOT trusted (the store remaps them); geometry is clamped to a
 * sane canvas range; every nested value is capped. Returns at most
 * MAX_PASTE_ELEMENTS elements.
 */
export function sanitizePastedElements(raw: unknown): AnyElement[] {
  if (!Array.isArray(raw)) return []
  const out: AnyElement[] = []
  for (const item of raw.slice(0, MAX_PASTE_ELEMENTS)) {
    if (!item || typeof item !== 'object') continue
    const el = item as Record<string, unknown>
    if (typeof el.type !== 'string' || !KNOWN_TYPES.has(el.type)) continue
    const s = sanitizeValue(el, 0) as Record<string, unknown> | null
    if (!s || typeof s.type !== 'string') continue
    // geometry: finite, clamped to a generous canvas space
    s.x = clampNum(s.x, -50_000, 50_000, 60)
    s.y = clampNum(s.y, -50_000, 50_000, 60)
    s.width = clampNum(s.width, 1, 50_000, 300)
    s.height = clampNum(s.height, 1, 50_000, 200)
    if (typeof s.visible !== 'boolean') s.visible = true
    if (typeof s.locked !== 'boolean') s.locked = false
    const opacity = typeof s.opacity === 'number' ? s.opacity : 1
    s.opacity = Math.min(1, Math.max(0, opacity))
    // groups carry children through the same gauntlet
    if (s.type === 'group' && Array.isArray(s.children)) {
      s.children = sanitizePastedElements(s.children)
    }
    out.push(s as unknown as AnyElement)
  }
  return out
}

/** Parse a text payload as a Canvix envelope (custom MIME or fallback). */
export function parseEnvelope(text: string): AnyElement[] {
  try {
    const env = JSON.parse(text) as Partial<Envelope>
    if (!env || env.app !== 'canvix' || !Array.isArray(env.elements)) return []
    return sanitizePastedElements(env.elements)
  } catch {
    return []
  }
}

/**
 * Copy elements to the SYSTEM clipboard. Custom MIME when the browser
 * supports ClipboardItem (Chromium/WebKit); text/plain envelope always
 * (Firefox's writeText round-trips through the same parser). Returns
 * false when neither path works (e.g. no permissions) — the internal
 * clipboard still covers the same-tab case.
 */
export async function copySelectionToSystem(elements: AnyElement[]): Promise<boolean> {
  if (!elements.length || typeof navigator === 'undefined' || !navigator.clipboard) return false
  const envelope = serializeEnvelope(elements)
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          [CANVIX_MIME]: new Blob([envelope], { type: CANVIX_MIME }),
          'text/plain': new Blob([envelope], { type: 'text/plain' }),
        }),
      ])
      return true
    }
  } catch {
    // fall through to writeText
  }
  try {
    await navigator.clipboard.writeText(envelope)
    return true
  } catch {
    return false
  }
}

/** Read Canvix elements from a paste event's clipboardData (MIME, then text). */
export function readPastedElements(dt: DataTransfer): AnyElement[] {
  try {
    const custom = dt.getData(CANVIX_MIME)
    if (custom) {
      const els = parseEnvelope(custom)
      if (els.length) return els
    }
    const text = dt.getData('text/plain')
    if (text) {
      const els = parseEnvelope(text)
      if (els.length) return els
    }
  } catch {
    // clipboard read blocked — the internal fallback still applies
  }
  return []
}

/** A synchronously-captured clipboard image: the byte read is STARTED
 *  inside the event handler (the DataTransfer and its files are
 *  neutered the moment the handler returns — a File handed to an async
 *  continuation reads as empty), the File is rebuilt later. */
export interface ClipboardImageCapture {
  name: string
  type: string
  bytes: Promise<ArrayBuffer>
}

/** Capture the first image on a paste DataTransfer (OS screenshot etc.).
 *  MUST be called synchronously inside the paste handler. */
export function capturePastedImage(dt: DataTransfer): ClipboardImageCapture | null {
  try {
    for (const item of Array.from(dt.items ?? [])) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          return {
            name: file.name || 'image',
            type: file.type || 'image/png',
            // the read starts NOW — before the event handler returns
            bytes: file.arrayBuffer(),
          }
        }
      }
    }
  } catch {
    // non-file paste
  }
  return null
}

/** Rebuild a real File from a capture (safe to await anywhere). */
export async function fileFromClipboard(capture: ClipboardImageCapture): Promise<File> {
  return new File([await capture.bytes], capture.name, { type: capture.type })
}
