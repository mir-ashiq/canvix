// ─────────────────────────────────────────────────────────────
// Canvix v0.18 (Wave 3) — bullet & numbered list layout
//
// Pure layout: wraps the text (same greedy wrap as text-fit) and
// returns per-line records with the marker string and x offsets.
// Hanging indent: the marker column is `markerCol` wide; every line
// of the item starts at the indent, wrapped continuation lines too —
// the Canva look. RTL mirrors the marker to the right edge.
//
// Shared by the Konva renderer (element-node), the SVG serializer and
// (through them) the video exporter — the rich-text pattern.
// ─────────────────────────────────────────────────────────────

export type ListStyle = 'none' | 'bullet' | 'number'

export interface ListLine {
  /** wrapped line text (already trimmed) */
  text: string
  /** marker glyph ('•' / '1.' / '') — '' on continuation lines */
  marker: string
  /** marker x offset from the element's left edge (px) */
  markerX: number
  /** text x offset from the element's left edge (px) */
  textX: number
  /** text box width for this line (px) — element width minus the marker column */
  textWidth: number
  /** baseline y offset from the element's top edge (px) — line index × lineHeight */
  y: number
}

export interface ListLayoutStyle {
  text: string
  fontFamily: string
  bold: boolean
  italic: boolean
  letterSpacing: number
  lineHeight: number
  fontSize: number
  /** element box width */
  width: number
  listStyle: ListStyle
  direction: 'ltr' | 'rtl'
}

export type ListMeasure = (text: string, style: { fontFamily: string; bold: boolean; italic: boolean; letterSpacing: number; fontSize: number }) => number

const BULLET = '•'

/**
 * Layout a list text. When `listStyle === 'none'` this degrades to a
 * plain wrapped block (marker '' everywhere) so callers have ONE path.
 */
export function layoutListLines(style: ListLayoutStyle, measure: ListMeasure): ListLine[] {
  const m = (t: string) => measure(t, style)
  const markerGap = Math.round(style.fontSize * 0.42)
  const rtl = style.direction === 'rtl'

  // Pass 1 — marker column width (the widest marker + gap)
  const paragraphs = style.text.split('\n')
  let markerCol = 0
  if (style.listStyle !== 'none') {
    const itemCount = paragraphs.filter((p) => p !== '').length || 1
    // worst-case marker width: the last index (widest) — measure it once
    const widest = style.listStyle === 'number' ? `${itemCount}.` : BULLET
    markerCol = m(widest) + markerGap
  }
  const textWidth = Math.max(24, style.width - markerCol)

  // Pass 2 — greedy wrap per paragraph with the reduced width
  const out: ListLine[] = []
  let lineIndex = 0
  let itemCounter = 0
  for (const para of paragraphs) {
    const startsItem = para !== ''
    if (startsItem) itemCounter += 1
    const marker =
      style.listStyle === 'none'
        ? ''
        : style.listStyle === 'bullet'
          ? startsItem
            ? BULLET
            : ''
          : startsItem
            ? `${itemCounter}.`
            : ''
    const markerW = marker ? m(marker) : 0

    if (para === '') {
      out.push({ text: '', marker: '', markerX: 0, textX: 0, textWidth: style.width, y: lineIndex * style.fontSize * style.lineHeight })
      lineIndex += 1
      continue
    }

    const words = para.split(/(\s+)/).filter((w) => w !== '')
    let line = ''
    let isFirst = true
    const pushLine = () => {
      out.push({
        text: line.trimEnd(),
        marker: isFirst ? marker : '',
        markerX: isFirst && rtl ? style.width - markerW : 0,
        textX: rtl ? 0 : markerCol,
        textWidth,
        y: lineIndex * style.fontSize * style.lineHeight,
      })
      lineIndex += 1
      isFirst = false
    }
    for (const word of words) {
      const candidate = line + word
      if (line !== '' && m(candidate.trimEnd()) > textWidth && !/^\s+$/.test(word)) {
        pushLine()
        line = word.trimStart()
      } else {
        line = candidate
      }
    }
    if (line !== '') pushLine()
  }
  return out
}
