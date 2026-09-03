// ─────────────────────────────────────────────────────────────
// Canvix "Magic" engine — pure functions for Magic Resize
// (Canva Magic Switch: resize one design into many channels)
// ─────────────────────────────────────────────────────────────
import type { AnyElement, GroupElement, PageData, ImageElement } from './types'

export interface ResizePreset {
  name: string
  short: string
  w: number
  h: number
  group: 'story' | 'post' | 'doc' | 'print'
}

/** Canva Magic-Resize channel presets (2026 set). */
export const RESIZE_PRESETS: ResizePreset[] = [
  { name: 'Instagram Story', short: 'Story', w: 1080, h: 1920, group: 'story' },
  { name: 'YouTube Short', short: 'Short', w: 1080, h: 1920, group: 'story' },
  { name: 'TikTok', short: 'TikTok', w: 1080, h: 1920, group: 'story' },
  { name: 'Instagram Post', short: 'Post', w: 1080, h: 1080, group: 'post' },
  { name: 'Instagram Portrait', short: 'Portrait', w: 1080, h: 1350, group: 'post' },
  { name: 'Facebook Post', short: 'Facebook', w: 1200, h: 630, group: 'post' },
  { name: 'X / Twitter Post', short: 'X post', w: 1600, h: 900, group: 'post' },
  { name: 'Presentation 16:9', short: 'Deck', w: 1920, h: 1080, group: 'doc' },
  { name: 'A4 Document', short: 'A4', w: 1240, h: 1754, group: 'doc' },
  { name: 'Poster A3', short: 'Poster', w: 1587, h: 2245, group: 'print' },
  { name: 'Business Card', short: 'Card', w: 1050, h: 600, group: 'print' },
  { name: 'YouTube Thumbnail', short: 'Thumb', w: 1280, h: 720, group: 'post' },
]

const relCenter = (pos: number, size: number, oldTotal: number) => (pos + size / 2) / oldTotal

/** Re-layout a single element for a new canvas size. */
export function magicRelayoutElement<T extends AnyElement>(el: T, oldW: number, oldH: number, newW: number, newH: number): T {
  const s = Math.min(newW / oldW, newH / oldH)
  const next: AnyElement = { ...el }

  // size scales by the conservative factor
  next.width = Math.max(4, Math.round(el.width * s))
  next.height = Math.max(4, Math.round(el.height * s))

  // position: preserve the element's RELATIVE centre on the page —
  // same-aspect resizes behave like a plain scale, orientation flips
  // keep content anchored at its relative position instead of overflowing.
  const cx = relCenter(el.x, el.width, oldW)
  const cy = relCenter(el.y, el.height, oldH)
  next.x = Math.round(cx * newW - next.width / 2)
  next.y = Math.round(cy * newH - next.height / 2)

  switch (el.type) {
    case 'text':
    case 'sticker': {
      const t = el as { fontSize: number; letterSpacing?: number }
      const scaled = next as { fontSize: number; letterSpacing?: number }
      scaled.fontSize = Math.max(6, Math.round(t.fontSize * s))
      if (el.type === 'text') scaled.letterSpacing = Math.round((t.letterSpacing ?? 0) * s)
      break
    }
    case 'rect':
    case 'ellipse':
    case 'triangle':
    case 'star':
    case 'path': {
      const sh = el as { strokeWidth: number; cornerRadius: number }
      const scaled = next as { strokeWidth: number; cornerRadius: number }
      scaled.strokeWidth = Math.max(0, Math.round(sh.strokeWidth * s * 100) / 100)
      scaled.cornerRadius = Math.max(0, Math.round(sh.cornerRadius * s))
      break
    }
    case 'line': {
      const ln = el as { strokeWidth: number }
      const scaled = next as { strokeWidth: number }
      scaled.strokeWidth = Math.max(0.5, Math.round(ln.strokeWidth * s * 100) / 100)
      next.height = 0
      break
    }
    case 'stroke': {
      const st = el as { strokeWidth: number; points: number[] }
      const scaled = next as { strokeWidth: number; points: number[] }
      scaled.strokeWidth = Math.max(0.5, Math.round(st.strokeWidth * s * 100) / 100)
      const pts = st.points ?? []
      const out: number[] = []
      for (let i = 0; i < pts.length; i += 2) {
        out.push(Math.round(pts[i] * s), Math.round(pts[i + 1] * s))
      }
      scaled.points = out
      break
    }
    case 'group': {
      const g = el as GroupElement
      // children are stored in page coords — relayout each, then rebuild the bbox
      const children = g.children.map((c) => magicRelayoutElement(c, oldW, oldH, newW, newH))
      const x1 = Math.min(...children.map((c) => c.x))
      const y1 = Math.min(...children.map((c) => c.y))
      const x2 = Math.max(...children.map((c) => c.x + c.width))
      const y2 = Math.max(...children.map((c) => c.y + c.height))
      ;(next as GroupElement).children = children
      next.x = x1
      next.y = y1
      next.width = Math.max(4, x2 - x1)
      next.height = Math.max(4, y2 - y1)
      break
    }
    case 'image': {
      // keep aspect from natural size after box scaling
      const im = el as ImageElement
      const ratio = im.naturalHeight / Math.max(1, im.naturalWidth)
      next.height = Math.max(4, Math.round(next.width * ratio))
      break
    }
    default:
      break
  }
  return next as T
}

/** Re-layout every page of a design for a new canvas size. */
export function magicRelayoutPages(pages: PageData[], oldW: number, oldH: number, newW: number, newH: number): PageData[] {
  return pages.map((p) => ({
    ...p,
    elements: p.elements.map((el) => magicRelayoutElement(el, oldW, oldH, newW, newH)),
  }))
}
