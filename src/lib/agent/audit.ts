/**
 * v0.29 QUALITY AUDIT — local design heuristics the agent runs on its
 * own canvas before accepting completion. No model calls, no vision:
 * WCAG 2.x contrast math, the client-computed overlaps/off-canvas from
 * the design ctx, and a text-overflow estimate. The loop consumes the
 * returned issues in ONE auto-fix round (see loop.ts); empty = clean.
 */
import type { AgentDesignCtx } from './context'

const HEX = /^#?[0-9a-f]{6}$/i

/** WCAG 2.x relative luminance of a #RRGGBB color (0..1); -1 unparseable. */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim())
  if (!m) return -1
  const n = parseInt(m[1], 16)
  const channel = (v: number) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

/** WCAG contrast ratio (1..21); 0 when either color is unparseable. */
export function contrastRatio(fg: string, bg: string): number {
  const lf = luminance(fg)
  const lb = luminance(bg)
  if (lf < 0 || lb < 0) return 0
  return (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05)
}

/** Worst N issues, human-readable and FIXABLE (the model acts on these). */
export function auditDesign(d: AgentDesignCtx): string[] {
  const issues: string[] = []
  const texts = (d.elements ?? []).filter((e) => e && e.type === 'text')
  // background: explicit ctx field, else the dominant color heuristic
  const bg = typeof d.background === 'string' && HEX.test(d.background)
    ? d.background
    : (d.colorsInUse ?? []).find((c) => HEX.test(c)) ?? null

  // 1. text contrast against the page background (WCAG: 3:1 large, 4.5:1 body)
  if (bg) {
    let contrastHits = 0
    for (const t of texts) {
      const fill = typeof t.fill === 'string' ? t.fill : ''
      if (!HEX.test(fill)) continue
      const ratio = contrastRatio(fill, bg)
      if (ratio <= 0) continue
      const size = typeof t.fontSize === 'number' ? t.fontSize : 0
      const need = size >= 24 ? 3 : 4.5
      if (ratio < need) {
        contrastHits += 1
        if (contrastHits <= 4) {
          issues.push(
            `Low contrast: text "${String(t.text ?? '').slice(0, 30)}" ${fill} on background ${bg} is ${ratio.toFixed(1)}:1 (needs ${need}:1) — change the text fill.`,
          )
        }
      }
    }
    if (contrastHits > 4) issues.push(`…and ${contrastHits - 4} more low-contrast text elements.`)
  }

  // 2. element overlaps (client-computed) — hard readability failures
  for (const o of (d.overlaps ?? []).slice(0, 3)) issues.push(`Elements overlap: ${o} — move or resize one of them.`)
  if ((d.overlaps ?? []).length > 3) issues.push(`…and ${(d.overlaps ?? []).length - 3} more overlapping pairs.`)

  // 3. off-canvas elements
  for (const o of (d.offCanvas ?? []).slice(0, 3)) issues.push(`Element is outside the canvas: ${o} — move it back inside ${d.width ?? '?'}x${d.height ?? '?'}.`)
  if ((d.offCanvas ?? []).length > 3) issues.push(`…and ${(d.offCanvas ?? []).length - 3} more off-canvas elements.`)

  // 4. text overflow estimate: average glyph ~0.55em
  let overflowHits = 0
  for (const t of texts) {
    const text = String(t.text ?? '')
    const size = typeof t.fontSize === 'number' ? t.fontSize : 0
    const width = typeof t.width === 'number' ? t.width : 0
    if (!text || size < 8 || width <= 0) continue
    const est = text.length * 0.55 * size
    if (est > width * 1.06) {
      overflowHits += 1
      if (overflowHits <= 3) {
        issues.push(
          `Text may overflow its box: "${text.slice(0, 30)}" (${text.length} chars at ${size}pt needs ~${Math.round(est)}px, box is ${Math.round(width)}px) — reduce fontSize, shorten the text, or widen the box.`,
        )
      }
    }
  }

  // 5. tiny text — illegible at presentation size
  const tiny = texts.filter((t) => typeof t.fontSize === 'number' && t.fontSize > 0 && t.fontSize < 14)
  if (tiny.length) issues.push(`${tiny.length} text element(s) use fontSize under 14 — too small to read; raise them to at least 14.`)

  return issues.slice(0, 12)
}
