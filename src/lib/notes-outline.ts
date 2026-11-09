// ─────────────────────────────────────────────────────────────
// Canvix speaker-notes outline (Wave 4 — AI Power-Up).
//
// Pure transform: design pages → a compact, text-only outline the
// notes model can reason about (page titles from the largest text
// elements, bullets from the rest, one line per chart/table/sticker).
// The model never sees element ids, coordinates or JSON — just the
// words, in reading order, so the notes it writes are about CONTENT.
// ─────────────────────────────────────────────────────────────

import type { PageData } from './types'

/** One page's outline — the /api/ai/notes request shape. */
export interface PageOutline {
  index: number
  title: string
  bullets: string[]
  /** non-text element counts, one summary line each */
  media: string[]
}

/** Cap so a 50-page deck cannot blow the prompt budget. */
export const MAX_OUTLINE_PAGES = 40
const MAX_BULLET_LEN = 160
const MAX_TITLE_LEN = 120

function textOf(el: unknown): string {
  const t = el as { text?: unknown } | undefined
  return typeof t?.text === 'string' ? t.text.replace(/\s+/g, ' ').trim() : ''
}

/** fontSize when present (text elements); 0 otherwise. */
function fontSizeOf(el: unknown): number {
  const t = el as { fontSize?: unknown } | undefined
  return typeof t?.fontSize === 'number' ? t.fontSize : 0
}

/**
 * Extract the outline of every page. Deterministic and total — hostile
 * or empty pages yield empty bullets, never a throw.
 */
export function extractOutlines(pages: PageData[]): PageOutline[] {
  const capped = pages.slice(0, MAX_OUTLINE_PAGES)
  return capped.map((page, index) => {
    const elements = Array.isArray(page.elements) ? page.elements : []
    // headline candidates: text elements with a fontSize — the largest
    // non-empty one is the page title
    const texts = elements
      .map((el) => ({ text: textOf(el), size: fontSizeOf(el), type: (el as { type?: string }).type }))
      .filter((t) => t.text.length > 0)
    const title =
      texts
        .filter((t) => t.size > 0)
        .sort((a, b) => b.size - a.size)[0]?.text.slice(0, MAX_TITLE_LEN) ?? `Page ${index + 1}`

    const titleTaken = new Set<string>()
    if (title !== `Page ${index + 1}`) titleTaken.add(title)

    const bullets: string[] = []
    const media: string[] = []
    for (const el of elements) {
      const type = (el as { type?: string }).type
      const text = textOf(el)
      if (type === 'text' || type === undefined) {
        if (!text) continue
        if (titleTaken.has(text)) continue
        const line = text.slice(0, MAX_BULLET_LEN)
        if (line) bullets.push(line)
      } else if (type === 'chart') {
        media.push('a chart' + (text ? ` titled "${text.slice(0, 60)}"` : ''))
      } else if (type === 'table') {
        media.push('a data table')
      } else if (type === 'image' || type === 'video') {
        media.push(`an ${type === 'image' ? 'image' : 'video'}`)
      } else if (type === 'sticker') {
        const ch = (el as { char?: unknown }).char
        if (typeof ch === 'string' && ch) media.push(`a ${ch} sticker`)
      }
      // shapes/lines/draws carry no content — skipped
    }
    return { index, title, bullets: bullets.slice(0, 12), media: media.slice(0, 8) }
  })
}

/** Render one outline back to prompt lines. */
export function outlineToPrompt(outlines: PageOutline[]): string {
  return outlines
    .map((p) => {
      const lines = [`PAGE ${p.index + 1}: ${p.title}`]
      for (const b of p.bullets) lines.push(`- ${b}`)
      for (const m of p.media) lines.push(`- contains ${m}`)
      return lines.join('\n')
    })
    .join('\n\n')
}

/** The notes system prompt — shared contract, pinned next to the
 *  transforms so it cannot drift from the response shape. */
export function notesSystemPrompt(count: number, tone: string): string {
  return [
    'You write presenter speaker notes for a design deck. Reply with ONLY a JSON object (no markdown fences):',
    `{"notes":[{"page":1,"text":string}, ... ]} — exactly ${count} entries, one per page in order.`,
    'Each note: 2-3 sentences (max 60 words) a presenter would SAY aloud — context, the point to land, a transition hint. ' +
      `Tone: ${tone}. Never read the slide text verbatim; add what the slide does not say.`,
  ].join('\n')
}

/** Coerce the model reply into page-indexed notes; invalid entries are
 *  dropped, page numbers clamped to the outline, text trimmed+capped. */
export function normalizeNotes(
  raw: unknown,
  pageCount: number,
): { page: number; text: string }[] {
  const obj = (raw ?? {}) as { notes?: unknown }
  const list = Array.isArray(obj.notes) ? obj.notes : []
  const out: { page: number; text: string }[] = []
  const seen = new Set<number>()
  for (const item of list) {
    const n = (item ?? {}) as { page?: unknown; text?: unknown }
    const page = Math.round(Number(n.page))
    const text = typeof n.text === 'string' ? n.text.replace(/\s+/g, ' ').trim().slice(0, 600) : ''
    if (!Number.isInteger(page) || page < 1 || page > pageCount || !text || seen.has(page)) continue
    seen.add(page)
    out.push({ page, text })
  }
  return out
}
