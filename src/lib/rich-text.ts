import type { TextAlign, TextElement, TextSpan } from './types'

// ─────────────────────────────────────────────────────────────
// v0.15 (R1): rich text — per-span styling on the text element.
//
// THE MODEL
//   `TextElement.spans` is an OPTIONAL array of style runs laid
//   over `el.text`. The concatenated span text must equal `el.text`
//   (character-for-character, UTF-16 units — the same units the
//   editing textarea's selectionStart/End report). The flat
//   element fields (bold/italic/fill/…) stay the BASE style:
//   a span key that is absent/undefined INHERITS the base.
//
//   Legacy elements simply have no spans — every renderer's
//   existing flat path is untouched, which makes the migration
//   lossless by construction: nothing to migrate until a user
//   styles a range, and "clear styling" drops spans back to null
//   with the base fields never having been touched.
//
//   A malformed spans array (text mismatch, over the run cap) is
//   normalized to `null` — renderers fall back to the flat path
//   and the text itself is NEVER corrupted by styling data.
//
//   This module is the "one geometry module for all renderers"
//   (the D7 charts pattern): the editor's Konva nodes, the SVG
//   serializer and the video-export frame builder all consume
//   `layoutRichLines` and never re-derive run positions.
//
// HONEST LIMITS (documented in README · R1)
//   - Collab merge stays whole-box LWW: two offline editors of
//     one text box still last-writer-win the ENTIRE element
//     (text + spans ride together). Per-span stamps are a
//     post-1.0 evaluation, on real usage.
//   - Curved text (curve ≠ 0) ignores spans in all three
//     renderers — the arc path is single-style by design.
// ─────────────────────────────────────────────────────────────

/** Hard cap on style runs per element — beyond this the editor
 *  refuses new styling ops and normalize falls back to flat. */
export const MAX_SPANS = 128
/** Longest sanitized link href stored on a span. */
export const MAX_LINK_LENGTH = 512
/** Rendering colour for a run that carries a link (and no explicit
 *  colour override): the classic document hyperlink blue. */
export const LINK_COLOR = '#1155CC'
/** Longest colour string accepted on a span (CSS colours, incl.
 *  rgb()/hsl() functional notation, stay well under this). */
const MAX_COLOR_LENGTH = 64

export type MeasureText = (text: string, style: SpanMeasureStyle) => number

export interface SpanMeasureStyle {
  bold: boolean
  italic: boolean
  fontSize: number
  fontFamily: string
  letterSpacing: number
}

/** A span's style fully resolved against the element's base. */
export interface ResolvedSpanStyle {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  color: string
  link: string | null
}

/** What a renderer actually draws: one coalesced styled run at an
 *  exact position inside the element's local box (x from the
 *  align-resolved line start; y = lineIndex · fontSize · lineHeight;
 *  baseline ≈ y + 0.8 · fontSize — the same Konva ascent
 *  approximation the flat SVG serializer already uses). */
export interface PositionedRun {
  x: number
  y: number
  text: string
  width: number
  style: ResolvedSpanStyle
}

/** Style patch for `applyStyleToRange`. Absent = untouched;
 *  `false`/`null` = strip back to inherit. */
export interface SpanStylePatch {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  color?: string | null
  link?: string | null
}

/** Toolbar state for the current selection. */
export interface RangeStyleState {
  bold: 'all' | 'none' | 'mixed'
  italic: 'all' | 'none' | 'mixed'
  underline: 'all' | 'none' | 'mixed'
  strike: 'all' | 'none' | 'mixed'
  color: 'mixed' | string | null
  link: 'mixed' | string | null
}

// ── link hygiene ──────────────────────────────────────────────

/** Only http(s) URLs survive (trimmed, control chars stripped,
 *  length-capped). Everything else — javascript:, data:, vbscript:,
 *  relative paths — returns null. Fail closed, like every other
 *  hostile-input path in this codebase. */
export function sanitizeLink(url: string | null | undefined): string | null {
  if (typeof url !== 'string') return null
  // strip control characters (incl. \n/\r — no header/attr injection)
  const cleaned = url.replace(/[\x00-\x1f\x7f]/g, '').trim()
  if (!cleaned || cleaned.length > MAX_LINK_LENGTH) return null
  if (!/^https?:\/\//i.test(cleaned)) return null
  return cleaned
}

// ── normalization ─────────────────────────────────────────────

/** Run one span through the inherit-semantics wringer:
 *  falsy booleans → undefined (inherit), '' colour/link → drop,
 *  link sanitized, colour length-capped. */
function cleanSpan(span: TextSpan): TextSpan {
  const out: TextSpan = { text: span.text }
  if (span.bold) out.bold = true
  if (span.italic) out.italic = true
  if (span.underline) out.underline = true
  if (span.strike) out.strike = true
  if (typeof span.color === 'string' && span.color && span.color.length <= MAX_COLOR_LENGTH) out.color = span.color
  const link = sanitizeLink(span.link)
  if (link) out.link = link
  return out
}

function sameStyle(a: TextSpan, b: TextSpan): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.strike === b.strike && a.color === b.color && a.link === b.link
}

function isPlain(span: TextSpan): boolean {
  return !span.bold && !span.italic && !span.underline && !span.strike && !span.color && !span.link
}

/** Clean + merge runs, collapse to null when flat/mismatched — WITHOUT
 *  the run-cap check (callers that need to distinguish "flat again" from
 *  "over cap" use this and apply the cap themselves). */
function mergeSpans(spans: TextSpan[] | null | undefined, text: string): TextSpan[] | null {
  if (!spans || spans.length === 0) return null
  const cleaned: TextSpan[] = []
  for (const raw of spans) {
    if (typeof raw?.text !== 'string' || raw.text === '') continue
    const span = cleanSpan(raw)
    const prev = cleaned[cleaned.length - 1]
    if (prev && sameStyle(prev, span)) {
      prev.text += span.text
    } else {
      cleaned.push(span)
    }
  }
  if (cleaned.length === 0) return null
  if (cleaned.length === 1 && isPlain(cleaned[0])) return null
  let total = 0
  for (const s of cleaned) total += s.text.length
  if (total !== text.length) return null
  return cleaned
}

/**
 * Canonicalize a spans array. Returns `null` when the element
 * should render flat: absent/empty spans, a single unstyled run,
 * a text-length mismatch (fail-safe — never corrupt `el.text`),
 * or a run count over the cap. Never mutates its input.
 */
export function normalizeSpans(spans: TextSpan[] | null | undefined, text: string): TextSpan[] | null {
  const merged = mergeSpans(spans, text)
  if (merged && merged.length > MAX_SPANS) return null
  return merged
}

/** Concatenated length of the span texts (pre-normalize). */
export function spanStringLength(spans: TextSpan[] | null | undefined): number {
  if (!spans) return 0
  let n = 0
  for (const s of spans) n += typeof s?.text === 'string' ? s.text.length : 0
  return n
}

// ── style resolution ──────────────────────────────────────────

/** Resolve a span against the element base: absent keys inherit
 *  `el.bold`/`el.italic`/… and the fill colour; a link colours the
 *  run (link blue) unless the span carries its own colour. */
export function resolveSpanStyle(el: TextElement, span: TextSpan): ResolvedSpanStyle {
  const link = sanitizeLink(span.link)
  return {
    bold: span.bold ?? el.bold ?? false,
    italic: span.italic ?? el.italic ?? false,
    underline: span.underline ?? (link ? true : el.underline ?? false),
    strike: span.strike ?? el.strike ?? false,
    color: span.color ?? (link ? LINK_COLOR : el.fill),
    link,
  }
}

// ── range editing (the textarea drives these) ─────────────────

/** Split runs so that `offset` is a run boundary (UTF-16 units).
 *  Returns a fresh array — never mutates. */
function splitAt(spans: TextSpan[], offset: number): TextSpan[] {
  const out: TextSpan[] = []
  let pos = 0
  for (const span of spans) {
    const start = pos
    const end = pos + span.text.length
    pos = end
    if (offset > start && offset < end) {
      out.push({ ...span, text: span.text.slice(0, offset - start) })
      out.push({ ...span, text: span.text.slice(offset - start) })
    } else {
      out.push({ ...span })
    }
  }
  return out
}

function runBounds(spans: TextSpan[]): Array<{ start: number; end: number }> {
  const bounds: Array<{ start: number; end: number }> = []
  let pos = 0
  for (const s of spans) {
    bounds.push({ start: pos, end: pos + s.text.length })
    pos += s.text.length
  }
  return bounds
}

/** Query the SPAN-LEVEL state of [start, end) for toolbar chips:
 *  `'all'` = every covered run sets it, `'none'` = none do,
 *  `'mixed'` = some do. `color`/`link` report the shared value,
 *  `null` when unstyled, `'mixed'` when they disagree. */
export function styleStateInRange(
  spans: TextSpan[] | null | undefined,
  text: string,
  start: number,
  end: number,
): RangeStyleState {
  const state: RangeStyleState = {
    bold: 'none', italic: 'none', underline: 'none', strike: 'none',
    color: null, link: null,
  }
  const s = Math.max(0, Math.min(start, end))
  const e = Math.max(0, Math.min(Math.max(start, end), text.length))
  if (s >= e) return state
  const runs = spans ?? [{ text }]
  const flags: Record<'bold' | 'italic' | 'underline' | 'strike', 'none' | 'all' | 'mixed'> = {
    bold: 'none', italic: 'none', underline: 'none', strike: 'none',
  }
  const colors = new Set<string>()
  const links = new Set<string>()
  let colorless = 0
  let linkless = 0
  let covered = 0
  for (const run of runs) {
    const b = { start: covered, end: covered + run.text.length }
    covered = b.end
    if (b.end <= s || b.start >= e) continue
    for (const key of ['bold', 'italic', 'underline', 'strike'] as const) {
      const on = Boolean(run[key])
      if (flags[key] === 'none' && on) flags[key] = 'all'
      else if (flags[key] === 'all' && !on) flags[key] = 'mixed'
      else if (flags[key] === 'mixed') { /* sticky */ }
    }
    if (run.color) colors.add(run.color)
    else colorless++
    if (run.link) {
      const clean = sanitizeLink(run.link)
      if (clean) links.add(clean)
      else linkless++
    } else linkless++
  }
  return {
    ...flags,
    color: colors.size === 0 ? null : colorless > 0 || colors.size > 1 ? 'mixed' : Array.from(colors)[0],
    link: links.size === 0 ? null : linkless > 0 || links.size > 1 ? 'mixed' : Array.from(links)[0],
  }
}

/**
 * Apply a style patch to the character range [start, end) of the
 * element's text. `spans === null` (flat) means one implicit
 * inherit-run covers everything — styling a range of a flat
 * element is what CREATES the spans array (the migration moment).
 * The link value is sanitized here (fail closed: an invalid href
 * strips the link instead of storing it). Returns the new spans
 * (possibly `null` when everything normalized back to flat).
 * Refuses to exceed MAX_SPANS runs (returns the input unchanged).
 */
export function applyStyleToRange(
  spans: TextSpan[] | null | undefined,
  text: string,
  start: number,
  end: number,
  patch: SpanStylePatch,
): TextSpan[] | null {
  const s = Math.max(0, Math.min(start, end))
  const e = Math.max(0, Math.min(Math.max(start, end), text.length))
  if (s >= e) return spans ?? null
  const base: TextSpan[] = spans && spans.length > 0 ? spans.map((r) => ({ ...r })) : [{ text }]
  // safety: caller's spans might not cover the full text — pad/truncate is
  // normalize's job; here just guard the invariant cheaply
  let total = 0
  for (const r of base) total += r.text.length
  if (total !== text.length) return spans ?? null

  let runs = splitAt(base, s)
  runs = splitAt(runs, e)
  const bounds = runBounds(runs)
  const next = runs.map((run, i) => {
    if (bounds[i].start < s || bounds[i].end > e) return run // not fully covered
    const out = { ...run }
    if (patch.bold !== undefined) out.bold = patch.bold || undefined
    if (patch.italic !== undefined) out.italic = patch.italic || undefined
    if (patch.underline !== undefined) out.underline = patch.underline || undefined
    if (patch.strike !== undefined) out.strike = patch.strike || undefined
    if (patch.color !== undefined) out.color = patch.color || undefined
    if (patch.link !== undefined) {
      const clean = sanitizeLink(patch.link)
      out.link = clean ?? undefined
    }
    return out
  })
  const normalized = mergeSpans(next, text)
  if (normalized === null) return null // everything styled back to plain — flat again
  if (normalized.length > MAX_SPANS) return spans ?? null // refused: would exceed the run cap
  return normalized
}

/**
 * Keep spans aligned with the text while the user types: diff the
 * old/new textarea value (common prefix + suffix) and splice the
 * runs. Handles insert, delete, cut, paste and replace in one
 * path. Returns `null` when the result is flat (e.g. everything
 * was deleted).
 */
export function reconcileSpans(
  spans: TextSpan[] | null | undefined,
  oldText: string,
  newText: string,
): TextSpan[] | null {
  if (!spans || spans.length === 0) return null
  if (oldText === newText) return spans
  // normalize first so the run math below can trust the invariant
  const runs = normalizeSpans(spans, oldText)
  if (!runs) return null

  const minLen = Math.min(oldText.length, newText.length)
  let p = 0
  while (p < minLen && oldText[p] === newText[p]) p++
  let s = 0
  while (s < minLen - p && oldText[oldText.length - 1 - s] === newText[newText.length - 1 - s]) s++

  const removed = oldText.length - p - s
  const inserted = newText.slice(p, newText.length - s)

  let working = runs.map((r) => ({ ...r }))
  if (removed > 0) {
    // split at both boundaries first — after this no run straddles
    // p or p+removed, so each run is fully inside or fully outside
    working = splitAt(working, p)
    working = splitAt(working, p + removed)
    let pos = 0
    const kept: TextSpan[] = []
    for (const r of working) {
      const start = pos
      const end = pos + r.text.length
      pos = end
      if (end <= p || start >= p + removed) kept.push(r)
      // runs fully inside [p, p+removed) are dropped on the floor
    }
    working = kept
  }
  if (inserted) {
    // insert at offset p, in priority order: prepend to the first run
    // (p === 0), append to the run ENDING at p (typing extends the span
    // you're inside), splice the run containing p — never fall through
    // to the end-of-array safety unless coverage is empty
    let pos = 0
    let placed = false
    const out: TextSpan[] = []
    for (const r of working) {
      const start = pos
      const end = pos + r.text.length
      pos = end
      if (!placed) {
        if (p === 0 && start === 0) {
          out.push({ ...r, text: inserted + r.text })
          placed = true
          continue
        }
        if (end === p) {
          out.push({ ...r, text: r.text + inserted })
          placed = true
          continue
        }
        if (start < p && p < end) {
          out.push({ ...r, text: r.text.slice(0, p - start) + inserted + r.text.slice(p - start) })
          placed = true
          continue
        }
      }
      out.push({ ...r })
    }
    if (!placed) out.push({ text: inserted })
    working = out
  }
  return normalizeSpans(working, newText)
}

// ── layout (the shared geometry for all three renderers) ──────

/** Line x-offset for a wrapped line of `lineWidth` inside a box of
 *  `boxWidth` (justify renders left-aligned, matching the flat
 *  paths' documented behaviour). */
export function resolveLineX(align: TextAlign, boxWidth: number, lineWidth: number): number {
  if (align === 'center') return Math.max(0, (boxWidth - lineWidth) / 2)
  if (align === 'right') return Math.max(0, boxWidth - lineWidth)
  return 0
}

interface Fragment {
  text: string
  style: ResolvedSpanStyle
  width: number
  kind: 'word' | 'ws' | 'nl'
}

/**
 * Greedy word-wrap layout of the spans into positioned runs.
 *
 *   - `measure` is INJECTED so each renderer stays consistent with
 *     its own glyph metrics: the editor & video-export pass a
 *     canvas-2d measure, the SVG serializer passes its own
 *     (svg-export) measureText adapted to include letterSpacing.
 *     Unit tests pass a deterministic fake.
 *   - The measure contract: advance width of `text` in the given
 *     style INCLUDING `letterSpacing × text.length` (the Konva
 *     per-character model).
 *   - Words split across spans lay out as per-fragment runs and
 *     coalesce back when adjacent fragments share a resolved style.
 *   - Trailing whitespace at a line break is not rendered and does
 *     not count toward the line width (Konva `wrap="word"` parity).
 *   - A word wider than the box hard-breaks by character (at least
 *     one glyph per line — never an infinite loop).
 */
export function layoutRichLines(
  el: TextElement,
  spans: TextSpan[],
  measure: MeasureText,
): PositionedRun[] {
  const maxWidth = Math.max(1, el.width)
  const measureStyle = (style: ResolvedSpanStyle): SpanMeasureStyle => ({
    bold: style.bold,
    italic: style.italic,
    fontSize: el.fontSize,
    fontFamily: el.fontFamily,
    letterSpacing: el.letterSpacing,
  })

  // fragment the spans into word / whitespace / newline chunks — the
  // textarea's Enter key produces real '\n' characters (Konva's flat
  // path treats them as hard line breaks, so the rich path must too)
  const fragments: Fragment[] = []
  for (const span of spans) {
    const style = resolveSpanStyle(el, span)
    const rendered = el.uppercase ? span.text.toUpperCase() : span.text
    for (const seg of rendered.split(/(\n)/)) {
      if (seg === '') continue
      if (seg === '\n') {
        fragments.push({ text: '\n', style, width: 0, kind: 'nl' })
        continue
      }
      for (const token of seg.split(/([ \t]+)/)) {
        if (!token) continue
        fragments.push({ text: token, style, width: measure(token, measureStyle(style)), kind: /^[ \t]+$/.test(token) ? 'ws' : 'word' })
      }
    }
  }

  // greedy wrap into lines of fragments (trailing ws dropped at breaks)
  const lines: Fragment[][] = []
  let line: Fragment[] = []
  let lineW = 0
  const pushLine = () => {
    while (line.length && line[line.length - 1].kind === 'ws') {
      lineW -= line.pop()!.width
    }
    lines.push(line)
    line = []
    lineW = 0
  }
  for (const frag of fragments) {
    if (frag.kind === 'nl') {
      pushLine()
      continue
    }
    if (frag.kind === 'ws') {
      line.push(frag)
      lineW += frag.width
      continue
    }
    const overflow = lineW + frag.width > maxWidth
    if (overflow && line.length > 0) pushLine()
    if (frag.width > maxWidth) {
      // hard-break the over-wide word by character — at least one
      // glyph per line, so the loop can never spin forever
      let chunk = ''
      let chunkW = 0
      for (const ch of frag.text) {
        const chW = measure(ch, measureStyle(frag.style))
        if (chunkW + chW > maxWidth && chunk) {
          line.push({ text: chunk, style: frag.style, width: chunkW, kind: 'word' })
          lines.push(line)
          line = []
          chunk = ''
          chunkW = 0
        }
        chunk += ch
        chunkW += chW
      }
      if (chunk) {
        line.push({ text: chunk, style: frag.style, width: chunkW, kind: 'word' })
        lineW = chunkW
      }
      continue
    }
    line.push(frag)
    lineW += frag.width
  }
  pushLine()

  // position runs (coalescing same-style neighbours on a line)
  const out: PositionedRun[] = []
  const lineHeight = el.fontSize * el.lineHeight
  lines.forEach((frags, i) => {
    let w = 0
    for (const f of frags) w += f.width
    let x = resolveLineX(el.align === 'justify' ? 'left' : el.align, maxWidth, w)
    for (const f of frags) {
      const prev = out[out.length - 1]
      if (
        prev &&
        Math.abs(prev.y - i * lineHeight) < 1e-9 &&
        Math.abs(prev.x + prev.width - x) < 1e-9 &&
        prev.style.bold === f.style.bold &&
        prev.style.italic === f.style.italic &&
        prev.style.underline === f.style.underline &&
        prev.style.strike === f.style.strike &&
        prev.style.color === f.style.color &&
        prev.style.link === f.style.link
      ) {
        prev.text += f.text
        prev.width += f.width
      } else {
        out.push({ x, y: i * lineHeight, text: f.text, width: f.width, style: f.style })
      }
      x += f.width
    }
  })
  return out
}

// ── the browser-side measure (editor + video export) ──────────

let canvasCtx: CanvasRenderingContext2D | null = null

/**
 * Canvas-2d measure with the codebase's graceful fallback (the
 * svg-export measureText pattern): when no 2d context exists
 * (SSR, jsdom without the canvas API) fall back to the
 * 0.55 × fontSize per-character approximation.
 */
export function createCanvasMeasure(): MeasureText {
  return (text, style) => {
    try {
      if (!canvasCtx) {
        const canvas = document.createElement('canvas')
        canvasCtx = canvas.getContext('2d')
      }
      if (!canvasCtx) return text.length * style.fontSize * 0.55 + style.letterSpacing * text.length
      canvasCtx.font = `${style.italic ? 'italic ' : ''}${style.bold ? 700 : 400} ${style.fontSize}px ${style.fontFamily}`
      return canvasCtx.measureText(text).width + style.letterSpacing * text.length
    } catch {
      return text.length * style.fontSize * 0.55 + style.letterSpacing * text.length
    }
  }
}
