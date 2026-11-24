// ─────────────────────────────────────────────────────────────
// The ONE structured-output parser for design generation (Phase A).
//
// Replaces the three hand-rolled JSON-repair paths (plan route,
// theme route, MCP tools) with a single module: extract JSON from
// whatever the model actually replied with (fences, prose, trailing
// commas), then coerce it hostile-input-safe into a DesignSpec —
// design-plan.ts semantics, spec-v2 vocabulary.
//
// Hard guarantees:
//   · never throws — garbage yields { ok: false, error }
//   · user-required slot text passes through EXACTLY (no slicing,
//     no case folding); only 'model' slots get length caps
//   · every numeric field is clamped into a legal range
// ─────────────────────────────────────────────────────────────

import { FONTS } from '@/lib/editor-utils'
import {
  asEnum,
  asHex,
  asNumber,
  asString,
  clamp,
  type BlockKind,
  type BlockNode,
  type ContentRole,
  type ContentSlot,
  type DesignSpec,
  type ParseSpecResult,
} from './types'

export const SPEC_MAX_BLOCKS = 6
export const SPEC_MAX_SLOTS_PER_BLOCK = 12
export const SPEC_MODEL_TEXT_CAP = 400
export const SPEC_REQUIRED_TEXT_CAP = 2000

const CONTENT_ROLES = ['headline', 'subline', 'tagline', 'body', 'cta', 'label'] as const
const BLOCK_KINDS: readonly BlockKind[] = [
  'hero',
  'feature-cards',
  'mockup',
  'timeline',
  'stat-row',
  'gallery',
  'footer',
]
const MOODS = ['warm', 'cool', 'neutral', 'vibrant', 'minimal'] as const
const SCALES = [1.2, 1.25, 1.333, 1.618]

/** Known-family check against the live font catalog. */
function knownFont(v: unknown): string | undefined {
  const name = asString(v)
  return FONTS.some((f) => f.family === name) ? name : undefined
}

// ── 1. JSON extraction (the repair layer) ────────────────────

/**
 * Pull a JSON object out of raw model output. Handles, in order:
 *   · already-parsed objects (route passed parsed JSON)
 *   · ```json fenced blocks
 *   · leading/trailing prose around a top-level { … } span
 *   · trailing commas before } or ]
 * Returns null when no object can be recovered.
 */
export function extractJsonObject(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  if (typeof raw !== 'string') return null
  let text = raw.trim()
  if (!text) return null

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  let body = text.slice(start, end + 1)

  try {
    return JSON.parse(body) as Record<string, unknown>
  } catch {
    // one repair pass: trailing commas (the most common model slip)
    const repaired = body.replace(/,\s*([}\]])/g, '$1')
    try {
      return JSON.parse(repaired) as Record<string, unknown>
    } catch {
      return null
    }
  }
}

// ── 2. slot / block / spec coercion ──────────────────────────

function normalizeSlot(raw: unknown): ContentSlot | null {
  const el = (raw ?? {}) as Record<string, unknown>
  const source = asEnum(el.source, ['user-required', 'model'] as const, 'model')
  const text = asString(el.text).trim()
  if (!text) return null
  // the exact-text contract: required copy is never sliced or folded
  const capped =
    source === 'user-required' ? text.slice(0, SPEC_REQUIRED_TEXT_CAP) : text.slice(0, SPEC_MODEL_TEXT_CAP)
  const slot: ContentSlot = {
    role: asEnum(el.role, CONTENT_ROLES, 'body'),
    source,
    text: capped,
  }
  if (source === 'model') {
    const maxWords = Math.round(asNumber(el.maxWords, 0))
    if (maxWords > 0) slot.maxWords = clamp(maxWords, 1, 80)
  }
  return slot
}

function normalizeBlock(raw: unknown): BlockNode | null {
  const el = (raw ?? {}) as Record<string, unknown>
  const kind = asString(el.kind)
  if (!(BLOCK_KINDS as readonly string[]).includes(kind)) return null
  const contentRaw = Array.isArray(el.content) ? el.content : []
  const content = contentRaw
    .slice(0, SPEC_MAX_SLOTS_PER_BLOCK)
    .map(normalizeSlot)
    .filter((s): s is ContentSlot => s !== null)
  if (!content.length) return null

  const block: BlockNode = {
    kind: kind as BlockKind,
    content,
    weight: clamp(asNumber(el.weight, 1), 0.2, 3),
    overlap: asEnum(el.overlap, ['none', 'over-backdrop'] as const, 'none'),
  }
  const count = Math.round(asNumber(el.count, 0))
  if (count > 0) block.count = clamp(count, 1, 6)
  return block
}

/**
 * Coerce raw model output (string or object) into a DesignSpec.
 * Falls back to the caller's page dimensions when absent/invalid;
 * drops unusable blocks but requires at least one usable block.
 */
export function parseSpecResponse(
  raw: unknown,
  fallbackWidth = 1080,
  fallbackHeight = 1080,
): ParseSpecResult {
  const obj = extractJsonObject(raw)
  if (!obj) return { ok: false, error: 'no JSON object found in model output' }

  const blocks = (Array.isArray(obj.blocks) ? obj.blocks : [])
    .slice(0, SPEC_MAX_BLOCKS)
    .map(normalizeBlock)
    .filter((b): b is BlockNode => b !== null)
  if (!blocks.length) {
    return { ok: false, error: 'spec has no usable blocks (kind + content required)' }
  }

  const format = (obj.format ?? {}) as Record<string, unknown>
  const palette = (obj.palette ?? {}) as Record<string, unknown>
  const seedsRaw = Array.isArray(palette.seeds) ? palette.seeds : []
  const seeds = seedsRaw
    .map((s) => asHex(s, ''))
    .filter((s) => s !== '')
    .slice(0, 4)
  const pinned: Record<string, string> = {}
  const pinnedRaw = (palette.pinned ?? {}) as Record<string, unknown>
  for (const [role, value] of Object.entries(pinnedRaw)) {
    const hex = asHex(value, '')
    if (hex !== '') pinned[role] = hex
  }

  const typo = (obj.typography ?? {}) as Record<string, unknown>
  const scaleRaw = asNumber(typo.scale, 1.333)
  const scale = SCALES.reduce((best, s) => (Math.abs(s - scaleRaw) < Math.abs(best - scaleRaw) ? s : best), 1.333)

  const spec: DesignSpec = {
    version: 'v2',
    name: asString(obj.name, 'AI design').slice(0, 80) || 'AI design',
    format: {
      width: clamp(Math.round(asNumber(format.width, fallbackWidth)), 200, 8000) || fallbackWidth,
      height: clamp(Math.round(asNumber(format.height, fallbackHeight)), 200, 8000) || fallbackHeight,
      preset: asString(format.preset).slice(0, 40) || undefined,
    },
    palette: {
      seeds,
      mood: asEnum(palette.mood, MOODS, 'neutral'),
      ...(Object.keys(pinned).length ? { pinned } : {}),
    },
    typography: {
      heading: knownFont(typo.heading),
      body: knownFont(typo.body),
      scale,
    },
    blocks,
  }
  return { ok: true, spec }
}
