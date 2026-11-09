// ─────────────────────────────────────────────────────────────
// Canvix v0.18 (Wave 3) — text auto-fit
//
// Pure helper: find the largest font size ≤ the authored size at
// which the text fits its element box (width AND height). Binary
// search over the same measure the renderers use, so the editor,
// the SVG export and the video export agree to the pixel.
//
// Design notes:
//  • shrink-only — Canva's Auto-fit never grows past the authored
//    size, so resizing a box up keeps the user's type scale.
//  • min 6 px — below that the text is unreadable; the caller
//    shows an overflow indicator instead of shrinking to nothing.
//  • the authored `fontSize` is NEVER mutated; the fit is derived
//    at render time (pure function of text + style + box).
// ─────────────────────────────────────────────────────────────

export interface TextFitStyle {
  text: string
  fontFamily: string
  bold: boolean
  italic: boolean
  letterSpacing: number
  lineHeight: number
  /** authored size — the upper bound of the search */
  fontSize: number
}

export interface TextFitBox {
  width: number
  height: number
}

export type MeasureFn = (text: string, style: Omit<TextFitStyle, 'lineHeight' | 'fontSize'> & { fontSize: number }) => number

/** Wrap `text` into lines that fit `maxWidth` (greedy, word-wrap). */
export function wrapLines(text: string, maxWidth: number, style: TextFitStyle, measure: MeasureFn): string[] {
  const paragraphs = text.split('\n')
  const out: string[] = []
  for (const para of paragraphs) {
    if (para === '') {
      out.push('')
      continue
    }
    const words = para.split(/(\s+)/).filter((w) => w !== '')
    let line = ''
    for (const word of words) {
      const candidate = line + word
      if (line !== '' && measure(candidate.trimEnd(), style) > maxWidth && !/^\s+$/.test(word)) {
        out.push(line.trimEnd())
        line = word.trimStart()
      } else {
        line = candidate
      }
    }
    if (line !== '') out.push(line.trimEnd())
  }
  return out
}

/**
 * The effective font size for an auto-fit text element.
 * Returns the authored size unchanged when it already fits (or when
 * any input is degenerate) — the common fast path.
 */
export function fitFontSize(style: TextFitStyle, box: TextFitBox, measure: MeasureFn): number {
  const authored = style.fontSize
  if (!Number.isFinite(box.width) || !Number.isFinite(box.height) || box.width < 4 || box.height < 4) return authored
  if (!style.text) return authored

  const fits = (size: number): boolean => {
    const s = { ...style, fontSize: size }
    const lines = wrapLines(style.text, box.width, s, measure)
    if (lines.length === 0) return true
    const blockH = lines.length * size * style.lineHeight
    if (blockH > box.height + 0.5) return false
    // a single unbreakable token wider than the box still overflows
    for (const line of lines) {
      if (line !== '' && measure(line, s) > box.width + 0.5) return false
    }
    return true
  }

  if (fits(authored)) return authored

  let lo = 6
  let hi = authored
  // 20 iterations converge well below a 0.05 px delta for any sane size
  for (let i = 0; i < 20 && hi - lo > 0.1; i++) {
    const mid = (lo + hi) / 2
    if (fits(mid)) lo = mid
    else hi = mid
  }
  return Math.max(6, Math.floor(lo * 10) / 10)
}
