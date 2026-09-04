// ─────────────────────────────────────────────────────────────
// Magic Layers — server-side region validation & normalization
//
// The vision model's JSON is NEVER trusted raw: every field is
// validated, clamped and sanitized here before it reaches the
// client reconstruction.
// ─────────────────────────────────────────────────────────────

import type {
  MagicBackground,
  MagicBounds,
  MagicFontClass,
  MagicLayerAnalysis,
  MagicRegion,
  MagicRegionType,
} from './types'

const HEX = /^#[0-9a-fA-F]{6}$/

function clamp01(n: unknown): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.min(1, Math.max(0, v))
}

function clampRange(n: unknown, min: number, max: number, fallback: number): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, v))
}

function sanitizeHex(input: unknown, fallback: string): string {
  if (typeof input !== 'string') return fallback
  const s = input.trim()
  if (HEX.test(s)) return s.toUpperCase()
  // 3-digit hex → expand
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toUpperCase()
  }
  return fallback
}

function sanitizeBounds(input: unknown): MagicBounds {
  const b = (input ?? {}) as Record<string, unknown>
  const x = clamp01(b.x)
  const y = clamp01(b.y)
  const w = clamp01(b.w ?? b.width)
  const h = clamp01(b.h ?? b.height)
  // degenerate regions are dropped upstream (w/h >= 0.005)
  return { x, y, w, h }
}

const REGION_TYPES: MagicRegionType[] = ['text', 'photo', 'shape', 'decoration']
const FONT_CLASSES: MagicFontClass[] = ['sans', 'serif', 'script', 'mono']
const SHAPES = ['rect', 'rounded-rect', 'ellipse'] as const

/**
 * Parse + validate a raw model reply into a trusted MagicLayerAnalysis.
 * Returns null when the reply contains no usable structure.
 */
export function validateAnalysis(raw: string): MagicLayerAnalysis | null {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
  const start = cleaned.indexOf('{')
  if (start === -1) return null
  let end = cleaned.lastIndexOf('}')
  while (end > start) {
    let candidate: Record<string, unknown> | null = null
    try {
      candidate = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
    } catch {
      candidate = null
    }
    if (candidate && typeof candidate === 'object' && Array.isArray(candidate.regions)) {
      return normalizeAnalysis(candidate)
    }
    end = cleaned.lastIndexOf('}', end - 1)
  }
  return null
}

function normalizeAnalysis(obj: Record<string, unknown>): MagicLayerAnalysis {
  // background
  const bgRaw = (obj.background ?? {}) as Record<string, unknown>
  const kindRaw = String(bgRaw.kind ?? 'solid')
  const background: MagicBackground =
    kindRaw === 'gradient'
      ? {
          kind: 'gradient',
          from: sanitizeHex(bgRaw.from, '#1F142E'),
          to: sanitizeHex(bgRaw.to, '#7630D7'),
          angle: clampRange(bgRaw.angle, 0, 360, 135),
        }
      : kindRaw === 'photo'
        ? { kind: 'photo' }
        : { kind: 'solid', from: sanitizeHex(bgRaw.from ?? bgRaw.color, '#FFFFFF') }

  // regions
  const seenIds = new Set<string>()
  const regions: MagicRegion[] = []
  const list = (obj.regions as unknown[]) ?? []
  for (const r of list.slice(0, 40)) {
    if (!r || typeof r !== 'object') continue
    const rr = r as Record<string, unknown>
    const typeRaw = String(rr.type ?? '')
    const type = (REGION_TYPES as string[]).includes(typeRaw) ? (typeRaw as MagicRegionType) : null
    if (!type) continue
    const bounds = sanitizeBounds(rr.bounds)
    if (bounds.w < 0.005 || bounds.h < 0.005) continue
    if (bounds.x + bounds.w < 0.005 || bounds.y + bounds.h < 0.005) continue

    let id = String(rr.id ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24)
    if (!id || seenIds.has(id)) id = `r${regions.length + 1}`
    seenIds.add(id)

    const region: MagicRegion = {
      id,
      type,
      bounds,
      confidence: clampRange(rr.confidence, 0, 1, 0.5),
      z: Math.round(clampRange(rr.z, 0, 40, regions.length)),
    }

    if (type === 'text') {
      const text = String(rr.text ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, 400).trim()
      if (!text) continue // text region without text is useless
      region.text = text
      region.color = sanitizeHex(rr.color ?? (rr.textStyle as Record<string, unknown>)?.color, '#1F2226')
      const fcRaw = String(rr.fontClass ?? 'sans')
      region.fontClass = (FONT_CLASSES as string[]).includes(fcRaw) ? (fcRaw as MagicFontClass) : 'sans'
      region.bold = rr.bold === true
      region.italic = rr.italic === true
      region.fontSize = clampRange(rr.fontSize, 0.008, 0.25, 0.05)
      const alignRaw = String(rr.align ?? 'center')
      region.align = (['left', 'center', 'right'] as string[]).includes(alignRaw)
        ? (alignRaw as 'left' | 'center' | 'right')
        : 'center'
    } else if (type === 'shape' || type === 'decoration') {
      region.color = sanitizeHex(rr.color, '#00C4CC')
      const shapeRaw = String(rr.shape ?? 'rect')
      region.shape = (SHAPES as readonly string[]).includes(shapeRaw)
        ? (shapeRaw as (typeof SHAPES)[number])
        : 'rect'
    } else if (type === 'photo') {
      region.subject = String(rr.subject ?? '').slice(0, 120)
    }

    regions.push(region)
  }

  // dedupe overlapping identical text regions (models sometimes double-report)
  const texts = regions.filter((r) => r.type === 'text')
  const dedupe = new Set<string>()
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i]
      const b = texts[j]
      if (a.text !== b.text) continue
      const overlap =
        Math.min(a.bounds.x + a.bounds.w, b.bounds.x + b.bounds.w) - Math.max(a.bounds.x, b.bounds.x)
      const overlapY =
        Math.min(a.bounds.y + a.bounds.h, b.bounds.y + b.bounds.h) - Math.max(a.bounds.y, b.bounds.y)
      if (overlap > 0 && overlapY > 0) {
        const key = b.confidence < a.confidence ? b.id : a.id
        dedupe.add(key)
      }
    }
  }

  const notes = typeof obj.notes === 'string' ? obj.notes.slice(0, 300) : undefined

  return {
    background,
    regions: regions
      .filter((r) => !dedupe.has(r.id))
      .sort((a, b) => (a.z ?? 0) - (b.z ?? 0)),
    notes,
  }
}
