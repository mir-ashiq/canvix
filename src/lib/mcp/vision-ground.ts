// ─────────────────────────────────────────────────────────────
// Canvix MCP canvas-screenshot vision grounding (Wave 4 — AI Power-Up).
//
// The `vision_ground` tool takes a screenshot of a canvas page, sends
// it through the vision slot, and returns a GROUNDED element inventory:
// what is on the page, where (normalized 0..1 boxes, mapped to page
// pixels), in what colors — so an agent can reason about layout and
// then act with the existing edit tools (update_element, add_text…).
//
// This module holds the pure parts (system prompt + normalizer) so
// they are unit-testable without a provider.
// ─────────────────────────────────────────────────────────────

/** One grounded element the vision model reported. */
export interface GroundedElement {
  label: string
  role: string
  /** normalized 0..1 box (fractions of the screenshot) */
  box: { x: number; y: number; w: number; h: number }
  /** mapped to page pixels (same numbers when no page size given) */
  px: { x: number; y: number; w: number; h: number }
  color?: string
}

export interface Grounding {
  description: string
  elements: GroundedElement[]
}

/** Cap the inventory — screenshots can be busy, prompts can't. */
export const MAX_GROUNDED = 40

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

function asRecord(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>
}

function asBox(v: unknown): { x: number; y: number; w: number; h: number } | null {
  const b = asRecord(v)
  const n = (x: unknown): number => {
    const num = typeof x === 'number' ? x : typeof x === 'string' ? Number(x) : NaN
    return Number.isFinite(num) ? num : NaN
  }
  const x = n(b.x)
  const y = n(b.y)
  const w = n(b.w ?? b.width)
  const h = n(b.h ?? b.height)
  if ([x, y, w, h].some((c) => Number.isNaN(c))) return null
  return {
    x: clamp01(x),
    y: clamp01(y),
    w: clamp01(w),
    h: clamp01(h),
  }
}

/**
 * Coerce the model reply into a Grounding. Fractions are clamped to
 * 0..1, pixel boxes derived, junk dropped — never throws.
 */
export function normalizeGrounding(raw: unknown, width: number, height: number): Grounding {
  const spec = asRecord(raw)
  const elementsRaw = Array.isArray(spec.elements) ? spec.elements : []
  const elements: GroundedElement[] = []
  for (const item of elementsRaw.slice(0, MAX_GROUNDED)) {
    const e = asRecord(item)
    const box = asBox(e.bounds ?? e.box)
    const label = typeof e.label === 'string' ? e.label.replace(/\s+/g, ' ').trim().slice(0, 80) : ''
    if (!box || !label) continue
    const color = typeof e.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(e.color) ? e.color.toUpperCase() : undefined
    elements.push({
      label,
      role: typeof e.role === 'string' && e.role ? e.role.slice(0, 24) : 'element',
      box,
      px: {
        x: Math.round(box.x * width),
        y: Math.round(box.y * height),
        w: Math.round(box.w * width),
        h: Math.round(box.h * height),
      },
      ...(color ? { color } : {}),
    })
  }
  return {
    description:
      typeof spec.description === 'string' ? spec.description.replace(/\s+/g, ' ').trim().slice(0, 500) : '',
    elements,
  }
}

/** The vision_ground system prompt — pinned next to the normalizer. */
export function visionGroundPrompt(question?: string): string {
  return [
    'You analyze SCREENSHOTS of a design canvas for a graphic-design agent. Reply with ONLY a JSON object (no markdown fences):',
    '{"description":string,"elements":[{"label":string,"role":"headline|body-text|image|photo|shape|logo|chart|table|button|decoration|other","bounds":{x,y,w,h},"color":"#RRGGBB"}]}',
    'RULES:',
    '1. bounds are FRACTIONS of the screenshot size (0..1), x/y = top-left.',
    '2. label = what it says/shows (exact visible text for text elements, short subject for images).',
    '3. color: dominant color of the element (omit when unclear).',
    '4. Ground truth only — report what is VISIBLE, never infer hidden structure. Max 40 elements.',
    '5. description: one or two sentences on the overall layout (reading order, visual hierarchy).',
    question ? `6. Pay special attention to: ${question.slice(0, 200)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}
