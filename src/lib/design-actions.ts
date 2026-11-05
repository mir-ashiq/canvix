// ─────────────────────────────────────────────────────────────
// DesignActions — validated, undoable editor mutations for the
// AI Assistant 2.0. The assistant returns structured actions;
// this module double-validates them client-side and executes
// each through store actions (which push undo history + emit
// collab ops). AI output is NEVER trusted raw.
// ─────────────────────────────────────────────────────────────

import {
  createImageElement,
  createPluginElement,
  createTextElement,
  type AnyElement,
  type Background,
  type PluginElement,
  type TextElement,
} from '@/lib/types'
import { checkCloneSafe } from '@/lib/plugins/data-caps'
import { useEditorStore } from '@/store/editor-store'

/** Who is calling applyDesignAction. Present ONLY when a plugin's
 *  broker drives an action — the plugin identity is stamped from the
 *  install row (never from the wire payload), so one plugin can
 *  never forge elements in another plugin's namespace. */
export interface ActionCaller {
  pluginId: string
  pluginVersion: string
  /** kinds the install's manifest declared (elements[].kind) */
  elementKinds: readonly string[]
}

/** Byte cap for one plugin element's data — matches the plugin
 *  storage value cap so a single element can never out-grow the
 *  RPC/autosave budgets that carry it (§4.7). */
const PLUGIN_ELEMENT_DATA_MAX_BYTES = 64 * 1024

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

/** Execute one action. Returns a human-readable result message.
 *  `caller` is set when a plugin broker drives the action. */
export async function applyDesignAction(action: DesignAction, caller?: ActionCaller): Promise<string> {
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

    // v0.13 (P3): plugin panels may add images — the §4.3 whitelist
    // ("dataURL ≤ 4 MB or /api/media id"). Same clamps the AI image
    // path applies; nothing about the plugin is trusted raw.
    case 'addImage': {
      const src = String(action.src ?? '')
      const isMediaRef = /^\/api\/media\/[A-Za-z0-9_-]{1,64}$/.test(src)
      const isDataUrl = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(src)
      if (!isMediaRef && !isDataUrl) return 'src must be a /api/media id or a png/jpeg/gif/webp data URL'
      if (isDataUrl && src.length > 4 * 1024 * 1024) return 'Image is larger than 4 MB'
      const naturalWidth = Math.min(8000, Math.max(16, Number(action.naturalWidth) || 800))
      const naturalHeight = Math.min(8000, Math.max(16, Number(action.naturalHeight) || 600))
      const scale = Math.min(1, (width * 0.7) / naturalWidth)
      const el = createImageElement(src, naturalWidth, naturalHeight, {
        width: Math.max(8, Math.round(naturalWidth * scale)),
        height: Math.max(8, Math.round(naturalHeight * scale)),
        x: Math.round(width * 0.15),
        y: Math.round(height * 0.15),
      })
      useEditorStore.getState().addElement(el)
      return 'Image added'
    }

    // v0.13 (P4): plugin-owned canvas elements (§4.3 whitelist).
    // Everything plugin-supplied is re-validated here — the caller
    // identity comes from the install row, the kind from the manifest,
    // the data from the collab caps. The element then rides the normal
    // addElement path: undoable, HLC-stamped, collab-broadcast.
    case 'addPluginElement': {
      if (!caller) return 'Plugin elements can only be added by installed apps'
      const kind = String(action.kind ?? '')
      if (!caller.elementKinds.includes(kind)) {
        return `This app does not declare an element kind "${kind.slice(0, 40)}"`
      }
      const data = (action.data ?? {}) as Record<string, unknown>
      const dataErr = checkCloneSafe(data, { maxBytes: PLUGIN_ELEMENT_DATA_MAX_BYTES })
      if (dataErr) return `Element data ${dataErr.replace(/^value /, '')}`
      const width = Math.min(8000, Math.max(16, Math.round(Number(action.width) || 480)))
      const height = Math.min(8000, Math.max(16, Math.round(Number(action.height) || 320)))
      const el = createPluginElement(caller.pluginId, kind, caller.pluginVersion, data, {
        width,
        height,
        x: Number.isFinite(Number(action.x)) ? Math.round(Number(action.x)) : Math.round(width * 0.1),
        y: Number.isFinite(Number(action.y)) ? Math.round(Number(action.y)) : Math.round(height * 0.1),
        ...(typeof action.name === 'string' && action.name.trim() ? { name: action.name.slice(0, 60) } : {}),
      })
      useEditorStore.getState().addElement(el)
      return 'Element added'
    }

    // v0.13 (P4): restyle in place — only elements OWNED by the calling
    // plugin, only a data patch. The broker refuses foreign pluginIds
    // before this runs; this is the second, structural check.
    case 'updatePluginElementData': {
      if (!caller) return 'Plugin elements can only be edited by installed apps'
      const ids = resolveIds(action.ids)
      if (!ids.length) return 'No matching elements'
      const patch = (action.patch ?? {}) as Record<string, unknown>
      const patchErr = checkCloneSafe(patch, { maxBytes: PLUGIN_ELEMENT_DATA_MAX_BYTES })
      if (patchErr) return `Element data ${patchErr.replace(/^value /, '')}`
      const page = currentPageElements()
      const mine: PluginElement[] = []
      for (const el of flatElements(page)) {
        if (ids.includes(el.id) && el.type === 'plugin' && el.pluginId === caller.pluginId) mine.push(el)
      }
      if (!mine.length) return 'No elements from this app match'
      for (const el of mine) {
        const merged = { ...el.data, ...patch }
        const mergedErr = checkCloneSafe(merged, { maxBytes: PLUGIN_ELEMENT_DATA_MAX_BYTES })
        if (mergedErr) return `Merged element data ${mergedErr.replace(/^value /, '')}`
        useEditorStore.getState().updateElements([el.id], { data: merged } as Partial<PluginElement>)
      }
      return `Updated ${mine.length} element${mine.length > 1 ? 's' : ''}`
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
      // v0.14 (D3): one store action = one undo step + one collab
      // broadcast, sharing the same pure geometry as the toolbar
      // tiles. The old inline loop did N updateElements (N undo
      // steps), computed the span against the last box's LEADING
      // edge (off by its size) and refused overlapping selections —
      // Canva/Figma distribute those; now we do too.
      useEditorStore.getState().distributeElements(ids, axis)
      const page = currentPageElements()
      const moved = page.filter((e) => ids.includes(e.id)).length
      return moved < 3 ? 'Needs at least 3 elements on this page' : `Distributed ${moved} elements evenly`
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
    case 'addImage': return `Add image (${String(action.src ?? '').startsWith('data:') ? 'embedded' : 'media library'})`
    case 'addPluginElement': return `Add ${String(action.kind ?? 'plugin')} element`
    case 'updatePluginElementData': return `Update ${action.ids?.length ?? 0} plugin element${(action.ids?.length ?? 0) === 1 ? '' : 's'}`
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
