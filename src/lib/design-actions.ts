// ─────────────────────────────────────────────────────────────
// DesignActions — validated, undoable editor mutations for the
// AI Assistant 2.0. The assistant returns structured actions;
// this module double-validates them client-side and executes
// each through store actions (which push undo history + emit
// collab ops). AI output is NEVER trusted raw.
// ─────────────────────────────────────────────────────────────

import {
  createImageElement,
  createTextElement,
  type AnyElement,
  type Background,
  type TextElement,
} from '@/lib/types'
import { useEditorStore } from '@/store/editor-store'

export interface DesignAction {
  type: string
  ids?: string[]
  text?: string
  fontSize?: number
  bold?: boolean
  color?: string
  fill?: string
  to?: string
  dx?: number
  dy?: number
  factor?: number
  patch?: Record<string, unknown>
  fontFamily?: string
  targets?: string
  kind?: string
  from?: string
  to2?: string
  to2Color?: string
  angle?: number
  mode?: string
  axis?: string
  prompt?: string
  colors?: string[]
  language?: string
  [key: string]: unknown
}

const HEX = /^#[0-9a-fA-F]{6}$/

/** Flatten elements (groups included) for id-based lookups. */
function flatElements(els: AnyElement[], out: AnyElement[] = []): AnyElement[] {
  for (const el of els) {
    out.push(el)
    if (el.type === 'group') flatElements(el.children, out)
  }
  return out
}

function currentPageElements(): AnyElement[] {
  const s = useEditorStore.getState()
  return s.pages[s.currentPage]?.elements ?? []
}

function resolveIds(ids: string[] | undefined): string[] {
  const page = currentPageElements()
  const valid = new Set(flatElements(page).map((e) => e.id))
  return (ids ?? []).filter((id) => typeof id === 'string' && valid.has(id))
}

/** Execute one action. Returns a human-readable result message. */
export async function applyDesignAction(action: DesignAction): Promise<string> {
  const store = useEditorStore.getState()
  const { width, height } = store

  switch (action.type) {
    case 'addText': {
      const text = String(action.text ?? '').slice(0, 400).trim()
      if (!text) return 'Nothing to add'
      const fontSize = Math.min(300, Math.max(8, Number(action.fontSize) || 48))
      const yMode = action.y === 'top' ? 0.08 : action.y === 'bottom' ? 0.78 : 0.4
      const el = createTextElement({
        text,
        fontSize,
        bold: action.bold === true,
        width: Math.round(width * 0.8),
        x: Math.round(width * 0.1),
        y: Math.round(height * yMode),
      })
      el.align = (action.align as 'left' | 'center' | 'right') ?? 'center'
      if (typeof action.color === 'string' && HEX.test(action.color)) el.fill = action.color
      useEditorStore.getState().addElement(el)
      return 'Text added — fully editable'
    }

    case 'updateElements': {
      const ids = resolveIds(action.ids)
      if (!ids.length) return 'No matching elements'
      const raw = (action.patch ?? {}) as Record<string, unknown>
      const patch: Record<string, unknown> = {}
      if (typeof raw.fill === 'string' && HEX.test(raw.fill)) patch.fill = raw.fill
      if (typeof raw.text === 'string' && raw.text.length <= 400) patch.text = raw.text
      if (Number.isFinite(Number(raw.fontSize))) patch.fontSize = Math.min(300, Math.max(6, Number(raw.fontSize)))
      if (typeof raw.bold === 'boolean') patch.bold = raw.bold
      if (typeof raw.fontFamily === 'string' && raw.fontFamily.length <= 60) patch.fontFamily = raw.fontFamily
      if (Number.isFinite(Number(raw.x))) patch.x = Number(raw.x)
      if (Number.isFinite(Number(raw.y))) patch.y = Number(raw.y)
      if (Number.isFinite(Number(raw.width))) patch.width = Math.max(8, Number(raw.width))
      if (Number.isFinite(Number(raw.height))) patch.height = Math.max(8, Number(raw.height))
      if (Number.isFinite(Number(raw.lineHeight))) patch.lineHeight = Math.min(3, Math.max(0.8, Number(raw.lineHeight)))
      if (Number.isFinite(Number(raw.letterSpacing))) patch.letterSpacing = Number(raw.letterSpacing)
      if (!Object.keys(patch).length) return 'Nothing to update'
      useEditorStore.getState().updateElements(ids, patch)
      return `Updated ${ids.length} element${ids.length > 1 ? 's' : ''}`
    }

    case 'deleteElements': {
      const ids = resolveIds(action.ids)
      if (!ids.length) return 'No matching elements'
      useEditorStore.getState().setSelection(ids)
      useEditorStore.getState().deleteSelection()
      return `Deleted ${ids.length} element${ids.length > 1 ? 's' : ''}`
    }

    case 'moveElements': {
      const ids = resolveIds(action.ids)
      if (!ids.length) return 'No matching elements'
      if (action.to) {
        const modeMap: Record<string, 'left' | 'cx' | 'right' | 'top' | 'cy' | 'bottom'> = {
          left: 'left', center: 'cx', right: 'right',
          top: 'top', middle: 'cy', bottom: 'bottom',
        }
        const mode = modeMap[String(action.to)]
        if (mode) {
          useEditorStore.getState().alignElements(ids, mode)
          return `Moved to ${String(action.to)}`
        }
      }
      const dx = Number.isFinite(Number(action.dx)) ? Number(action.dx) : 0
      const dy = Number.isFinite(Number(action.dy)) ? Number(action.dy) : 0
      if (!dx && !dy) return 'Nothing to move'
      const page = currentPageElements()
      const patchPerId = new Map<string, { x: number; y: number }>()
      for (const el of page) {
        if (ids.includes(el.id)) patchPerId.set(el.id, { x: el.x + dx, y: el.y + dy })
      }
      for (const [id, patch] of patchPerId) {
        useEditorStore.getState().updateElements([id], patch)
      }
      return `Moved ${ids.length} element${ids.length > 1 ? 's' : ''}`
    }

    case 'scaleElements': {
      const ids = resolveIds(action.ids)
      if (!ids.length) return 'No matching elements'
      const factor = Math.min(5, Math.max(0.1, Number(action.factor) || 1))
      if (Math.abs(factor - 1) < 0.01) return 'No size change'
      const page = currentPageElements()
      for (const el of page) {
        if (!ids.includes(el.id)) continue
        const patch: Record<string, number> = {
          x: Math.round(el.x + el.width * (1 - factor) / 2),
          y: Math.round(el.y + el.height * (1 - factor) / 2),
          width: Math.max(8, Math.round(el.width * factor)),
          height: Math.max(8, Math.round(el.height * factor)),
        }
        if (el.type === 'text' || el.type === 'sticker') patch.fontSize = Math.max(6, Math.round((el as TextElement).fontSize * factor))
        useEditorStore.getState().updateElements([el.id], patch)
      }
      return `Scaled ${ids.length} element${ids.length > 1 ? 's' : ''} by ${factor.toFixed(2)}×`
    }

    case 'setHeadingsColor':
    case 'setTextColor': {
      const color = String(action.color ?? '')
      if (!HEX.test(color)) return 'Invalid colour'
      const page = currentPageElements()
      const isHeading = (el: AnyElement) =>
        el.type === 'text' && ((el as TextElement).bold || (el as TextElement).fontSize / Math.max(1, height) > 0.06)
      const ids = flatElements(page)
        .filter((el) => el.type === 'text')
        .filter((el) => (action.type === 'setHeadingsColor' ? isHeading(el) : true))
        .map((el) => el.id)
      if (!ids.length) return 'No text elements found'
      useEditorStore.getState().updateElements(ids, { fill: color })
      return action.type === 'setHeadingsColor' ? 'Heading colours updated' : 'Text colours updated'
    }

    case 'setFont': {
      const fontFamily = String(action.fontFamily ?? '').slice(0, 60)
      if (!fontFamily) return 'No font specified'
      const page = currentPageElements()
      const targets = String(action.targets ?? 'all')
      const isHeading = (el: AnyElement) =>
        el.type === 'text' && ((el as TextElement).bold || (el as TextElement).fontSize / Math.max(1, height) > 0.06)
      const ids = flatElements(page)
        .filter((el) => el.type === 'text')
        .filter((el) => (targets === 'all' ? true : targets === 'headings' ? isHeading(el) : !isHeading(el)))
        .map((el) => el.id)
      if (!ids.length) return 'No text elements found'
      useEditorStore.getState().updateElements(ids, { fontFamily })
      return `Font set to ${fontFamily} (${targets})`
    }

    case 'setBackground': {
      const kind = String(action.kind ?? 'solid')
      const from = String(action.from ?? '')
      if (!HEX.test(from)) return 'Invalid colour'
      let bg: Background = { type: 'solid', color: from }
      if (kind === 'gradient') {
        const to = String((action.to as string) ?? (action as { to?: string }).to ?? '')
        if (HEX.test(to)) {
          bg = { type: 'gradient', from, to, angle: Math.min(360, Math.max(0, Number(action.angle) || 135)) }
        }
      }
      useEditorStore.getState().setPageBackground(bg)
      return 'Background updated'
    }

    case 'alignElements': {
      const ids = resolveIds(action.ids)
      const modeMap: Record<string, 'left' | 'cx' | 'right' | 'top' | 'cy' | 'bottom'> = {
        left: 'left', cx: 'cx', right: 'right', top: 'top', cy: 'cy', bottom: 'bottom',
      }
      const mode = modeMap[String(action.mode)]
      if (!ids.length || !mode) return 'Nothing to align'
      useEditorStore.getState().alignElements(ids, mode)
      return 'Elements aligned'
    }

    case 'distributeElements': {
      const ids = resolveIds(action.ids)
      if (ids.length < 3) return 'Needs at least 3 elements'
      const axis = String(action.axis) === 'y' ? 'y' : 'x'
      const page = currentPageElements()
      const els = page.filter((e) => ids.includes(e.id)).sort((a, b) => (axis === 'x' ? a.x - b.x : a.y - b.y))
      const first = els[0]
      const last = els[els.length - 1]
      const start = axis === 'x' ? first.x : first.y
      const end = axis === 'x' ? last.x : last.y
      const sizes = els.reduce((sum, e) => sum + (axis === 'x' ? e.width : e.height), 0)
      const gap = (end - start - sizes) / (els.length - 1)
      if (gap < 0) return 'Elements overlap — no distribution applied'
      let cursor = start
      for (const el of els) {
        const patch = axis === 'x' ? { x: Math.round(cursor) } : { y: Math.round(cursor) }
        useEditorStore.getState().updateElements([el.id], patch)
        cursor += (axis === 'x' ? el.width : el.height) + gap
      }
      return `Distributed ${els.length} elements evenly`
    }

    case 'addPage':
      useEditorStore.getState().addPage()
      return 'Page added'

    case 'duplicatePage': {
      const s = useEditorStore.getState()
      s.duplicatePage(s.currentPage)
      return 'Page duplicated'
    }

    case 'generateImage': {
      const prompt = String(action.prompt ?? '').slice(0, 400).trim()
      if (!prompt) return 'No image prompt'
      const res = await fetch('/api/ai/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      const data = (await res.json()) as { dataUrl?: string; width?: number; height?: number; error?: string; code?: string }
      if (!res.ok || !data.dataUrl) throw new Error(data.error ?? 'Image generation failed')
      const iw = data.width ?? 1024
      const ih = data.height ?? 1024
      const scale = Math.min((width * 0.7) / iw, (height * 0.7) / ih, 1)
      useEditorStore.getState().addElement(
        createImageElement(data.dataUrl, iw, ih, {
          x: Math.round((width - iw * scale) / 2),
          y: Math.round((height - ih * scale) / 2),
          width: Math.round(iw * scale),
          height: Math.round(ih * scale),
        })
      )
      return 'AI image generated and added'
    }

    case 'suggestPalette': {
      const colors = (action.colors ?? []).filter((c) => typeof c === 'string' && HEX.test(c)).slice(0, 5) as string[]
      if (colors.length < 3) return 'Palette too small'
      const brand = { ...useEditorStore.getState().brand, palettes: [colors, ...(useEditorStore.getState().brand.palettes ?? [])].slice(0, 4) }
      useEditorStore.getState().setBrand(brand)
      return 'Palette saved to your Brand Kit'
    }

    case 'translate': {
      const language = String(action.language ?? '').slice(0, 40)
      if (!language) return 'No language given'
      const texts: TextElement[] = []
      for (const p of useEditorStore.getState().pages) {
        for (const el of flatElements(p.elements)) {
          if (el.type === 'text') texts.push(el as TextElement)
        }
      }
      if (!texts.length) return 'No text to translate'
      const res = await fetch('/api/ai/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language, texts: texts.map((t) => t.text) }),
      })
      const data = (await res.json()) as { translations?: string[]; error?: string }
      if (!res.ok || !Array.isArray(data.translations) || data.translations.length !== texts.length) {
        throw new Error(data.error ?? 'Translation failed')
      }
      useEditorStore.getState().translateTexts(texts.map((t, i) => ({ id: t.id, text: data.translations![i] })))
      return `Translated ${texts.length} texts to ${language}`
    }

    case 'magicAnimate':
      useEditorStore.getState().magicAnimateCurrentPage()
      return 'Magic Animate applied — open Preview to watch'

    case 'balanceLayout':
    case 'magicLayout': {
      const msg = balanceLayout()
      return msg
    }

    default:
      return 'Unsupported action'
  }
}

/** Deterministic layout balance: margins, centering, spacing (no AI needed). */
function balanceLayout(): string {
  const s = useEditorStore.getState()
  const page = s.pages[s.currentPage]
  if (!page || page.elements.length < 2) return 'Not enough elements to balance'

  const { width, height } = s
  const margin = Math.round(Math.min(width, height) * 0.06)
  const els = page.elements.filter((e) => !e.locked)
  if (els.length < 2) return 'Not enough movable elements'

  // 1. snap elements that are nearly centered to exact center
  let fixed = 0
  for (const el of els) {
    const cx = el.x + el.width / 2
    const cy = el.y + el.height / 2
    if (Math.abs(cx - width / 2) < width * 0.04) {
      useEditorStore.getState().updateElements([el.id], { x: Math.round((width - el.width) / 2) })
      fixed += 1
    }
    if (Math.abs(cy - height / 2) < height * 0.04) {
      useEditorStore.getState().updateElements([el.id], { y: Math.round((height - el.height) / 2) })
      fixed += 1
    }
    // 2. pull near-margin elements to the safe margin
    if (Math.abs(el.x - margin) < margin * 0.35) {
      useEditorStore.getState().updateElements([el.id], { x: margin })
      fixed += 1
    }
    if (Math.abs(el.x + el.width - (width - margin)) < margin * 0.35) {
      useEditorStore.getState().updateElements([el.id], { x: width - margin - el.width })
      fixed += 1
    }
  }
  return fixed
    ? `Layout balanced — ${fixed} alignment${fixed > 1 ? 's' : ''} cleaned up (safe margins + centering)`
    : 'Layout already looks balanced'
}

/** Human label for the action chip UI. */
export function describeAction(action: DesignAction): string {
  switch (action.type) {
    case 'addText': return `Add text: “${String(action.text ?? '').slice(0, 40)}${String(action.text ?? '').length > 40 ? '…' : ''}”`
    case 'updateElements': return `Update ${action.ids?.length ?? 0} element${(action.ids?.length ?? 0) === 1 ? '' : 's'}`
    case 'deleteElements': return `Delete ${action.ids?.length ?? 0} element${(action.ids?.length ?? 0) === 1 ? '' : 's'}`
    case 'moveElements': return action.to ? `Move to ${action.to}` : 'Move elements'
    case 'scaleElements': return `Scale by ${Number(action.factor ?? 1).toFixed(2)}×`
    case 'setHeadingsColor': return `Headings → ${action.color}`
    case 'setTextColor': return `Text colour → ${action.color}`
    case 'setFont': return `Font: ${action.fontFamily}`
    case 'setBackground': return `Background → ${action.kind}`
    case 'alignElements': return 'Align elements'
    case 'distributeElements': return 'Distribute evenly'
    case 'addPage': return 'Add a page'
    case 'duplicatePage': return 'Duplicate this page'
    case 'generateImage': return `Generate image: ${String(action.prompt ?? '').slice(0, 42)}…`
    case 'suggestPalette': return 'Use this palette'
    case 'translate': return `Translate to ${action.language}`
    case 'magicAnimate': return 'Magic Animate this page'
    case 'balanceLayout':
    case 'magicLayout': return 'Balance the layout'
    default: return action.type
  }
}
