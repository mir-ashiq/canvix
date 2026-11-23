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
  createShapeElement,
  createStickerElement,
  createTableElement,
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
      // v0.27 (agent): explicit geometry wins over the y-band default —
      // the agent computes exact boxes; the chip path keeps the band
      const yMode = action.y === 'top' ? 0.08 : action.y === 'bottom' ? 0.78 : 0.4
      const hasX = Number.isFinite(Number(action.x))
      const hasY = typeof action.y === 'number' && Number.isFinite(action.y)
      const el = createTextElement({
        text,
        fontSize,
        bold: action.bold === true,
        width: Math.round(Math.min(width * 1.5, Math.max(40, Number(action.width) || width * 0.8))),
        x: Math.round(hasX ? Math.max(-width, Math.min(width, Number(action.x))) : width * 0.1),
        y: Math.round(hasY ? Math.max(-height, Math.min(height, Number(action.y))) : height * yMode),
      })
      el.align = (action.align as 'left' | 'center' | 'right') ?? 'center'
      if (typeof action.font === 'string' && action.font) el.fontFamily = action.font
      if (typeof action.color === 'string' && HEX.test(action.color)) el.fill = action.color
      useEditorStore.getState().addElement(el)
      return 'Text added — fully editable'
    }

    // v0.27 (agent): addShape — the agent's add_shape tool compiles here.
    case 'addShape': {
      const shape = String(action.shape ?? '')
      const w = Number(action.width) || 0
      const h = Number(action.height) || 0
      const x = Number(action.x)
      const y = Number(action.y)
      if (!['rect', 'ellipse', 'triangle', 'star', 'line'].includes(shape)) return 'Unknown shape'
      if (!Number.isFinite(x) || !Number.isFinite(y) || w < 4 || h < 4) return 'Bad geometry'
      const el = createShapeElement(shape as 'rect', {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(w),
        height: Math.round(h),
        ...(typeof action.fill === 'string' && HEX.test(action.fill) ? { fill: action.fill } : {}),
        ...(Number.isFinite(Number(action.cornerRadius)) ? { cornerRadius: Math.round(Number(action.cornerRadius)) } : {}),
        ...(Number.isFinite(Number(action.rotation)) ? { rotation: Number(action.rotation) } : {}),
      })
      useEditorStore.getState().addElement(el)
      return `${shape} added`
    }

    // v0.27 (agent): addSticker — one emoji glyph as a canvas sticker.
    case 'addSticker': {
      const emoji = String(action.emoji ?? '').trim().slice(0, 8)
      if (!emoji) return 'Nothing to add'
      const size = Math.min(400, Math.max(24, Number(action.size) || 96))
      const x = Number.isFinite(Number(action.x)) ? Number(action.x) : width / 2 - size / 2
      const y = Number.isFinite(Number(action.y)) ? Number(action.y) : height / 2 - size / 2
      const el = createStickerElement(emoji, {
        x: Math.round(x),
        y: Math.round(y),
        width: size,
        height: size,
      })
      useEditorStore.getState().addElement(el)
      return `Sticker ${emoji} added`
    }

    // v0.27 (agent): addTable — header + rows on a clamped grid.
    case 'addTable': {
      const header = Array.isArray(action.header) ? action.header.map((c) => String(c).slice(0, 60)).slice(0, 6) : []
      const rows = Array.isArray(action.rows)
        ? action.rows.slice(0, 12).map((r: unknown[]) => (Array.isArray(r) ? r.map((c: unknown) => String(c).slice(0, 60)) : []))
        : []
      if (!header.length || !rows.length) return 'Table needs header and rows'
      const tableWidth = Math.min(width, Math.max(160, Number(action.width) || width * 0.8))
      const el = createTableElement({
        x: Math.round(Number.isFinite(Number(action.x)) ? Number(action.x) : (width - tableWidth) / 2),
        y: Math.round(Number.isFinite(Number(action.y)) ? Number(action.y) : height * 0.3),
        width: Math.round(tableWidth),
        header,
        rows: rows.length,
        cols: header.length,
        cells: rows.flat().map((text) => ({ text: String(text ?? '') })),
      })
      useEditorStore.getState().addElement(el)
      return `Table ${header.length}×${rows.length + 1} added`
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

    // v0.27.3: the agent's goto_page tool — switching pages is what
    // makes add_page useful (before this, the agent could append a
    // page and then had no way to edit it). Bounds-checked here, not
    // in the tool: the model's page count may be stale.
    case 'gotoPage': {
      const s = useEditorStore.getState()
      const page = Math.round(Number(action.page))
      if (!Number.isFinite(page) || page < 1 || page > s.pages.length) {
        return `Page out of range — the design has ${s.pages.length} page(s)`
      }
      if (page - 1 === s.currentPage) return `Already on page ${page}`
      s.setCurrentPage(page - 1)
      s.clearSelection()
      return `Switched to page ${page}`
    }

    // v0.27.3 (agent): search licensed stock photography and place the
    // best match. Runs the SAME client path PhotosPanel uses — the
    // server's /api/stock-photo/search (provider keys stay server-side,
    // results sanitized + credited) and addStockPhoto's download →
    // media-store → credited element pipeline. No new trust surface.
    case 'addStockPhoto': {
      const query = String(action.query ?? '').trim().slice(0, 120)
      if (!query) return 'No photo query given'
      const res = await fetch('/api/stock-photo/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, count: 12 }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        results?: { id: string; provider: string; width: number; height: number; download: string; alternates: string[]; credit: { provider: string; author: string; license: string; url: string } }[]
        error?: string
      }
      if (!res.ok || !Array.isArray(data.results) || data.results.length === 0) {
        return `No stock photo matched "${query}"${data.error ? ` (${data.error})` : ''} — try add_image to generate one`
      }
      // pick by orientation when asked, else the first (provider-ranked)
      const orientation = String(action.orientation ?? '')
      const wanted =
        orientation === 'portrait'
          ? (ratio) => ratio < 1
          : orientation === 'square'
            ? (ratio) => ratio >= 0.8 && ratio <= 1.25
            : orientation === 'landscape'
              ? (ratio) => ratio >= 1
              : null
      const pick =
        (wanted && data.results.find((r) => wanted(r.width / Math.max(1, r.height)))) ?? data.results[0]
      const { addStockPhoto: place } = await import('@/components/editor/add-element')
      await place(pick)
      return `Stock photo "${query}" added (credit: ${pick.credit.author}/${pick.credit.provider})`
    }

    case 'generateImage': {      const prompt = String(action.prompt ?? '').slice(0, 400).trim()
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

    case 'fixOverlaps': {
      const msg = fixOverlaps()
      return msg
    }

    // ───────────────────────────────────────────────────────────
    // v0.28 (Phase 3): the full capability bridge — every editor
    // surface the audit found (docs/AI-CAPABILITY-MATRIX.md) gets a
    // validated, undoable action here. All of them ride the store's
    // existing history + collab path; none bypass validation.
    // ───────────────────────────────────────────────────────────

    case 'addLine': {
      const variant = ['solid', 'dashed', 'arrow', 'arrowBoth'].includes(String(action.variant)) ? String(action.variant) : 'solid'
      const x = Number(action.x)
      const y = Number(action.y)
      const length = Number(action.length) || 320
      if (!Number.isFinite(x) || !Number.isFinite(y) || length < 8) return 'Bad line geometry (need x, y, length ≥ 8)'
      const { createLineElement } = await import('@/lib/types')
      const el = createLineElement({
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(Math.min(length, width * 1.2)),
        stroke: typeof action.stroke === 'string' && HEX.test(action.stroke) ? action.stroke : '#1F2226',
        strokeWidth: Math.min(40, Math.max(1, Number(action.strokeWidth) || 4)),
        dashed: variant === 'dashed',
        arrowStart: variant === 'arrowBoth',
        arrowEnd: variant === 'arrow' || variant === 'arrowBoth',
        rotation: Math.min(359, Math.max(0, Number(action.rotation) || 0)),
      })
      useEditorStore.getState().addElement(el)
      return `Line added (${variant})`
    }

    case 'addIcon': {
      // server-side search of the same offline pack the Icons app uses
      const { searchIcons } = await import('@/lib/assets/icon-pack')
      const query = String(action.query ?? '').trim().slice(0, 60)
      if (!query) return 'No icon query given'
      const matches = searchIcons(query, 1)
      if (!matches.length) return `No icon matches "${query}" — try a simpler noun (arrow, star, check, heart…)`
      const icon = matches[0]
      const size = Math.min(600, Math.max(24, Number(action.size) || 96))
      const { addIconPath } = await import('@/components/editor/add-element')
      addIconPath(icon.d, typeof action.stroke === 'string' && HEX.test(action.stroke) ? action.stroke : '#1F2226')
      return `Icon "${icon.name}" added (${size}px nominal)`
    }

    case 'addIllustration': {
      const { ILLUSTRATIONS } = await import('@/lib/assets/illustrations')
      const query = String(action.query ?? '').trim().toLowerCase().slice(0, 60)
      if (!query) return 'No illustration query given'
      const hit =
        ILLUSTRATIONS.find((i) => i.name.toLowerCase() === query) ??
        ILLUSTRATIONS.find((i) => i.name.toLowerCase().includes(query) || i.tags.some((t) => t.includes(query)))
      if (!hit) return `No illustration matches "${query}" — the packs cover abstract/nature/business/decoration scenes`
      const { addIllustration } = await import('@/components/editor/add-element')
      addIllustration(hit.svg)
      return `Illustration "${hit.name}" added`
    }

    case 'addGraphic': {
      const { GRAPHICS } = await import('@/lib/editor-utils')
      const id = String(action.graphicId ?? '').trim()
      const hit = GRAPHICS.find((g) => g.id === id) ?? GRAPHICS.find((g) => g.name.toLowerCase().includes(id.toLowerCase()))
      if (!hit) return `Unknown graphic "${id}"`
      const { addGraphic } = await import('@/components/editor/add-element')
      addGraphic(hit.id, typeof action.fill === 'string' && HEX.test(action.fill) ? action.fill : undefined)
      return `Graphic "${hit.name}" added`
    }

    case 'addChart': {
      const kind = ['bar', 'line', 'donut', 'scatter'].includes(String(action.kind)) ? (String(action.kind) as 'bar') : null
      if (!kind) return 'kind must be bar | line | donut | scatter'
      const labels = Array.isArray(action.labels) ? (action.labels as unknown[]).map((l) => String(l).slice(0, 24)).slice(0, 24) : null
      // series: [{name, color, values[]}] — validated shape, clamped
      let series: { name: string; color: string; values: number[] }[] | null = null
      if (Array.isArray(action.series)) {
        series = (action.series as unknown[])
          .filter((s): s is { name?: unknown; color?: unknown; values?: unknown } => !!s && typeof s === 'object')
          .slice(0, 6)
          .map((s) => ({
            name: String(s.name ?? 'Series').slice(0, 24),
            color: typeof s.color === 'string' && HEX.test(s.color) ? s.color : '#7630D7',
            values: Array.isArray(s.values) ? (s.values as unknown[]).map((v) => Number(v) || 0).slice(0, 24) : [],
          }))
          .filter((s) => s.values.length >= 2)
      }
      const { createChartElement } = await import('@/lib/types')
      const el = createChartElement(kind, {
        x: Math.round(Math.min(Math.max(Number(action.x) || width * 0.14, 0), width - 100)),
        y: Math.round(Math.min(Math.max(Number(action.y) || height * 0.2, 0), height - 100)),
        ...(labels?.length ? { labels } : {}),
        ...(series?.length ? { series } : {}),
      })
      useEditorStore.getState().addElement(el)
      return `Chart added (${kind}${series?.length ? `, ${series.length} series` : ', sample data — editable'})`
    }

    case 'addQr': {
      const value = String(action.value ?? '').trim().slice(0, 500)
      if (!value) return 'No QR value given'
      const size = Math.min(800, Math.max(96, Number(action.size) || 288))
      try {
        const QRCode = (await import('qrcode')).default
        const dataUrl = await QRCode.toDataURL(value, {
          width: size,
          margin: 1,
          color: {
            dark: typeof action.dark === 'string' && HEX.test(action.dark) ? action.dark : '#000000',
            light: typeof action.light === 'string' && HEX.test(action.light) ? action.light : '#FFFFFF',
          },
        })
        useEditorStore.getState().addElement(
          createImageElement(dataUrl, size, size, {
            x: Math.round(Number.isFinite(Number(action.x)) ? Number(action.x) : (width - size) / 2),
            y: Math.round(Number.isFinite(Number(action.y)) ? Number(action.y) : (height - size) / 2),
            width: size,
            height: size,
            radius: 12,
          }),
        )
        return `QR code added (${size}×${size})`
      } catch {
        return 'QR generation failed for this value'
      }
    }

    case 'addFrame': {
      const frameShape = ['rect', 'rounded', 'circle', 'star', 'polygon'].includes(String(action.frameShape))
        ? (String(action.frameShape) as 'rect')
        : 'rect'
      const { createFrameElement } = await import('@/lib/types')
      const size = Math.min(1200, Math.max(80, Number(action.width) || 320))
      const el = createFrameElement(frameShape, {
        x: Math.round(Number.isFinite(Number(action.x)) ? Number(action.x) : (width - size) / 2),
        y: Math.round(Number.isFinite(Number(action.y)) ? Number(action.y) : (height - size) / 2),
        width: size,
        height: Math.round(Math.min(1200, Math.max(80, Number(action.height) || Math.round(size * 0.66)))),
      })
      useEditorStore.getState().addElement(el)
      return `Frame added (${frameShape}) — fill it with fill_frame`
    }

    case 'addEmbed': {
      const url = String(action.url ?? '').trim().slice(0, 400)
      if (!/^https?:\/\//.test(url)) return 'url must be a http(s) link'
      const { createEmbedElement } = await import('@/lib/types')
      useEditorStore.getState().addElement(
        createEmbedElement(url, {
          x: Math.round((width - 320) / 2),
          y: Math.round((height - 200) / 2),
        }),
      )
      return 'Embed card added'
    }

    case 'duplicateElements': {
      const ids = resolveIds(action.ids)
      if (!ids.length) return 'No matching elements'
      const s = useEditorStore.getState()
      const page = currentPageElements()
      const clones = ids
        .map((id) => page.find((e) => e.id === id))
        .filter((e): e is NonNullable<typeof e> => !!e && !e.locked)
        .map((e) => ({
          ...structuredClone(e),
          id: `${e.type}-${Math.random().toString(36).slice(2, 9)}`,
          x: e.x + 24,
          y: e.y + 24,
        }))
      if (!clones.length) return 'Nothing duplicable (locked?)'
      s.addElementsBulk(clones)
      return `Duplicated ${clones.length} element${clones.length > 1 ? 's' : ''} (offset 24px)`
    }

    case 'groupElements': {
      const ids = resolveIds(action.ids)
      if (ids.length < 2) return 'Grouping needs 2+ element ids'
      const s = useEditorStore.getState()
      s.setSelection(ids)
      s.groupSelection()
      s.clearSelection()
      return `Grouped ${ids.length} elements`
    }

    case 'ungroupElements': {
      const ids = resolveIds(action.ids)
      const s = useEditorStore.getState()
      const page = currentPageElements()
      const groups = ids.filter((id) => page.find((e) => e.id === id)?.type === 'group')
      if (!groups.length) return 'No group elements among the ids'
      for (const gid of groups) {
        s.setSelection([gid])
        s.ungroupSelection()
      }
      s.clearSelection()
      return `Ungrouped ${groups.length} group${groups.length > 1 ? 's' : ''}`
    }

    case 'reorderLayers': {
      // ids in the desired z order; dir is a shortcut for single moves
      const s = useEditorStore.getState()
      if (typeof action.dir === 'string' && ['up', 'down', 'front', 'back'].includes(action.dir)) {
        const ids = resolveIds(action.ids)
        if (!ids.length) return 'No matching elements'
        for (const id of ids) s.moveLayer(id, action.dir as 'up')
        return `Moved ${ids.length} element(s) ${action.dir}`
      }
      if (Array.isArray(action.ids) && action.ids.length >= 2) {
        const order = (action.ids as unknown[]).map(String)
        // apply from the bottom up so relative order is preserved
        for (const id of [...order].reverse()) s.reorderLayer(id, 0)
        // simpler: park each at front in reverse → final z equals `order`
        return `Reordered ${order.length} elements`
      }
      return 'Give ids + dir (up|down|front|back), or ≥2 ids for an explicit z order'
    }

    case 'animateElements': {
      const ids = resolveIds(action.ids)
      if (!ids.length) return 'No matching elements'
      const kinds = ['none', 'fade', 'rise', 'pan', 'pop', 'wipe', 'zoom', 'rotate', 'breathe'] as const
      const rawKind = String(action.kind)
      if (!(kinds as readonly string[]).includes(rawKind)) return `kind must be one of ${kinds.join(', ')}`
      const kind = rawKind as (typeof kinds)[number]
      if (kind === 'none') {
        const s = useEditorStore.getState()
        s.setElementAnimation(ids, null)
        return `Cleared animation on ${ids.length} element(s)`
      }
      const s = useEditorStore.getState()
      s.setElementAnimation(ids, {
        kind,
        duration: Math.min(5, Math.max(0.2, Number(action.duration) || 0.6)),
        delay: Math.min(10, Math.max(0, Number(action.delay) || 0)),
        easing: ['linear', 'easeIn', 'easeOut', 'easeInOut', 'spring'].includes(String(action.easing))
          ? (String(action.easing) as 'easeOut')
          : 'easeOut',
        ...(['left', 'right', 'up', 'down'].includes(String(action.direction)) ? { direction: String(action.direction) as 'left' } : {}),
      })
      return `Animated ${ids.length} element(s): ${kind}`
    }

    case 'setPageTransition': {
      const kinds = ['none', 'fade', 'slide', 'zoom', 'flip'] as const
      const rawKind = String(action.kind)
      if (!(kinds as readonly string[]).includes(rawKind)) return `kind must be one of ${kinds.join(', ')}`
      const kind = rawKind as (typeof kinds)[number]
      if (kind === 'none') {
        useEditorStore.getState().setPageTransition(null)
        return 'Page transition cleared'
      }
      const s = useEditorStore.getState()
      s.setPageTransition({ kind, duration: Math.min(2, Math.max(0.2, Number(action.duration) || 0.5)) } as Parameters<typeof s.setPageTransition>[0])
      return `Page transition set: ${kind}`
    }

    case 'deletePage': {
      const s = useEditorStore.getState()
      if (s.pages.length <= 1) return 'Cannot delete the only page'
      const page = Math.round(Number(action.page))
      const target = Number.isFinite(page) ? page - 1 : s.currentPage
      if (target < 0 || target >= s.pages.length) return `Page out of range (1–${s.pages.length})`
      if (s.pages[target].elements.length > 0 && !action.confirmed) {
        return `Page ${target + 1} has ${s.pages[target].elements.length} elements — confirm:true is required to delete it`
      }
      s.deletePage(target)
      return `Deleted page ${target + 1}`
    }

    case 'setBrandKit': {
      const s = useEditorStore.getState()
      const colors = Array.isArray(action.colors)
        ? (action.colors as unknown[]).filter((c): c is string => typeof c === 'string' && HEX.test(c)).slice(0, 10)
        : undefined
      const headingFont = typeof action.headingFont === 'string' ? action.headingFont.slice(0, 60) : undefined
      const bodyFont = typeof action.bodyFont === 'string' ? action.bodyFont.slice(0, 60) : undefined
      if (!colors?.length && !headingFont && !bodyFont) return 'Nothing to set (colors[], headingFont, bodyFont)'
      s.setBrand({
        ...s.brand,
        ...(colors?.length ? { colors } : {}),
        ...(headingFont ? { headingFont } : {}),
        ...(bodyFont ? { bodyFont } : {}),
      })
      return 'Brand kit updated — the agent will respect it in this and later runs'
    }

    case 'resizeDesign': {
      const w = Math.round(Number(action.width))
      const h = Math.round(Number(action.height))
      if (!(w >= 50 && w <= 10000 && h >= 50 && h <= 10000)) return 'width/height must be 50–10000 px'
      const s = useEditorStore.getState()
      if (s.width === w && s.height === h) return `Already ${w}×${h}`
      s.resizeDesign(w, h)
      return `Canvas resized to ${w}×${h} (elements re-laid out proportionally)`
    }

    case 'maskImage': {
      const ids = resolveIds(action.ids)
      const masks = ['none', 'circle', 'rounded', 'star', 'polygon', 'heart', 'hexagon']
      const mask = masks.includes(String(action.mask)) ? String(action.mask) : null
      if (!mask) return `mask must be one of ${masks.join(', ')}`
      const page = currentPageElements()
      const images = ids.filter((id) => page.find((e) => e.id === id)?.type === 'image')
      if (!images.length) return 'No image elements among the ids'
      const s = useEditorStore.getState()
      for (const id of images) {
        s.updateElements([id], { maskShape: mask === 'none' ? undefined : mask, ...(mask === 'polygon' ? { maskSides: Math.min(12, Math.max(3, Number(action.sides) || 6)) } : {}) })
      }
      return `Masked ${images.length} image(s): ${mask}`
    }

    case 'adjustImage': {
      const ids = resolveIds(action.ids)
      const page = currentPageElements()
      const images = ids.filter((id) => page.find((e) => e.id === id)?.type === 'image')
      if (!images.length) return 'No image elements among the ids'
      const clampAdj = (v: unknown) => Math.min(100, Math.max(-100, Math.round(Number(v) || 0)))
      const s = useEditorStore.getState()
      for (const id of images) {
        const patch: Record<string, unknown> = {}
        if (action.brightness !== undefined) patch.brightness = clampAdj(action.brightness)
        if (action.contrast !== undefined) patch.contrast = clampAdj(action.contrast)
        if (action.saturation !== undefined) patch.saturation = clampAdj(action.saturation)
        if (typeof action.filter === 'string') patch.filter = action.filter === 'none' ? undefined : action.filter
        if (Object.keys(patch).length) s.updateElements([id], patch)
      }
      return `Adjusted ${images.length} image(s)`
    }

    case 'measureText': {
      // real metrics — the same canvas measureText the renderer uses
      const text = String(action.text ?? '')
      if (!text) return 'No text given'
      const fontSize = Math.min(400, Math.max(6, Number(action.fontSize) || 48))
      const style = `${String(action.bold) === 'true' || action.bold === true ? 'bold ' : ''}${fontSize}px ${String(action.fontFamily ?? 'Poppins')}`
      let w = fontSize * 0.6 * text.length
      let lineHeight = Math.round(fontSize * 1.25)
      try {
        const c = document.createElement('canvas')
        const ctx = c.getContext('2d')
        if (ctx) {
          ctx.font = style
          w = Math.max(1, ctx.measureText(text).width)
          lineHeight = Math.round(fontSize * (Number(action.lineHeight) || 1.25))
        }
      } catch {
        /* headless fallback: 0.6 estimate */
      }
      return `width=${Math.round(w)}px lineHeight=${lineHeight}px (text ${text.length} chars @ ${fontSize}px)`
    }

    case 'setTextSpans': {
      const ids = resolveIds(action.ids)
      if (!ids.length) return 'No matching elements'
      // spans must concatenate to the element text — validated
      const spans = Array.isArray(action.spans)
        ? (action.spans as unknown[]).filter((s): s is Record<string, unknown> => !!s && typeof s === 'object' && typeof (s as { text?: unknown }).text === 'string')
        : []
      if (!spans.length) return 'spans must be [{text, bold?, italic?, color?…}]'
      const { normalizeSpans } = await import('@/lib/rich-text')
      const page = currentPageElements()
      const s = useEditorStore.getState()
      let applied = 0
      for (const id of ids) {
        const el = page.find((e) => e.id === id)
        if (el?.type !== 'text') continue
        const joined = spans.map((sp) => String(sp.text)).join('')
        if (joined.replace(/\s+/g, ' ').trim() !== (el as { text: string }).text.replace(/\s+/g, ' ').trim()) {
          return `Spans must concatenate exactly to the element text ("${(el as { text: string }).text.slice(0, 40)}…") — got "${joined.slice(0, 40)}…"`
        }
        const norm = normalizeSpans(spans as unknown as import('@/lib/types').TextSpan[], (el as { text: string }).text)
        if (norm) {
          s.updateElements([id], { spans: norm })
          applied++
        }
      }
      return applied ? `Styled ${applied} text element(s)` : 'No text elements styled'
    }

    case 'exportDesign': {
      // the agent's export path: current page → PNG data URL → download
      const format = ['png', 'jpg'].includes(String(action.format)) ? (String(action.format) as 'png') : 'png'
      const { captureStage } = await import('@/components/editor/canvas/canvas-bridge')
      try {
        const url = await captureStage({ pixelScale: 1, mimeType: format === 'png' ? 'image/png' : 'image/jpeg', quality: 0.92 })
        const a = document.createElement('a')
        a.href = url
        a.download = `${(useEditorStore.getState().designName || 'canvix-design').replace(/[^a-z0-9-_]+/gi, '-')}.${format}`
        a.click()
        return `Exported the current page as ${format.toUpperCase()} (download started)`
      } catch {
        return 'Export failed — the canvas is not ready'
      }
    }

    case 'addStockVideo': {
      const query = String(action.query ?? '').trim().slice(0, 120)
      if (!query) return 'No video query given'
      const res = await fetch('/api/stock-video/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, count: 6 }),
      })
      const data = (await res.json().catch(() => ({}))) as { results?: { id: string; mp4: string; alternates: string[]; width: number; height: number; credit: { provider: string; author: string; license: string; url: string } }[]; error?: string }
      if (!res.ok || !Array.isArray(data.results) || data.results.length === 0) {
        return `No stock video matched "${query}"${data.error ? ` (${data.error})` : ''}`
      }
      const pick = data.results[0]
      const { addStockVideo: place } = await import('@/components/editor/add-element')
      await place(pick)
      return `Stock video "${query}" added (credit: ${pick.credit.author}/${pick.credit.provider})`
    }

    case 'addSfx': {
      const { sfxById } = await import('@/lib/assets/sfx-pack')
      const id = String(action.sfxId ?? '').trim()
      if (!sfxById(id)) return 'Unknown sound id — ask the user to pick sounds from the Audio panel, or use an animation sfxId'
      const { addSfxToCanvas } = await import('@/components/editor/add-element')
      await addSfxToCanvas(id)
      return `Sound "${id}" added to the canvas`
    }

    default:
      return 'Unsupported action'
  }
}

/** v0.26: separate overlapping elements + pull off-canvas elements back.
 *  Deterministic geometry pass over the current page:
 *  1. Off-canvas boxes snap back inside the safe margin.
 *  2. True overlaps (both boxes substantive, neither a text-on-card
 *     pattern — the text-inside-frame composition is legitimate) get
 *     pushed apart along the axis with the smallest required shift,
 *     iterating until stable (or a bounded pass count).
 *  All moves ride the ordinary updateElements store action → one undo
 *  step each, collab ops included. */
function fixOverlaps(): string {
  const s = useEditorStore.getState()
  const page = s.pages[s.currentPage]
  if (!page) return 'No page to fix'
  const { width, height } = s
  const margin = Math.round(Math.min(width, height) * 0.04)
  // working copies (mutated, then committed in one batch at the end)
  const boxes = flatElements(page.elements)
    .filter((e) => !e.locked)
    .map((e) => ({ id: e.id, type: e.type, x: e.x, y: e.y, w: e.width, h: e.height }))
  if (!boxes.length) return 'Nothing to fix'

  let moved = 0

  // 1. off-canvas → clamp back inside the safe area
  for (const b of boxes) {
    const nx = Math.min(Math.max(b.x, margin), Math.max(margin, width - margin - b.w))
    const ny = Math.min(Math.max(b.y, margin), Math.max(margin, height - margin - b.h))
    if (nx !== b.x || ny !== b.y) {
      b.x = nx
      b.y = ny
      moved++
    }
  }

  // 2. iterative overlap separation (max 4 sweeps)
  const overlapArea = (a: typeof boxes[number], b: typeof boxes[number]) => {
    const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
    const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
    return ix > 0 && iy > 0 ? ix * iy : 0
  }
  const smallArea = (a: typeof boxes[number], b: typeof boxes[number]) => Math.min(a.w * a.h, b.w * b.h)

  for (let sweep = 0; sweep < 4; sweep++) {
    let touched = false
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        const inter = overlapArea(a, b)
        if (inter <= 0) continue
        const small = smallArea(a, b)
        if (small <= 0 || inter / small < 0.1) continue // touching edges are fine
        // skip the legitimate text-on-card composition: one box mostly
        // inside the other AND the smaller is a text element
        const smaller = a.w * a.h <= b.w * b.h ? a : b
        if (inter / small > 0.55 && smaller.type === 'text') continue

        // push apart along the cheaper axis (smallest shift), then clamp
        const shiftX = Math.min(a.x + a.w - b.x, b.x + b.w - a.x) + 12
        const shiftY = Math.min(a.y + a.h - b.y, b.y + b.h - a.y) + 12
        if (shiftX <= shiftY) {
          // a goes left, b goes right (keep order stable)
          a.x = Math.max(margin, a.x - shiftX / 2)
          b.x = Math.min(width - margin - b.w, b.x + shiftX / 2)
        } else {
          a.y = Math.max(margin, a.y - shiftY / 2)
          b.y = Math.min(height - margin - b.h, b.y + shiftY / 2)
        }
        touched = true
        moved++
      }
    }
    if (!touched) break
  }

  if (!moved) return 'No overlaps or off-canvas elements found — the layout is clean'

  // commit: one update per element (undo-friendly, collab-synced)
  const update = useEditorStore.getState().updateElements
  for (const b of boxes) update([b.id], { x: Math.round(b.x), y: Math.round(b.y) })
  return `Layout fixed — ${moved} placement${moved > 1 ? 's' : ''} adjusted (overlaps separated, everything back on the page). Ctrl+Z to undo.`
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
    case 'addShape': return `Add ${String(action.shape ?? 'shape')}`
    case 'addSticker': return `Add sticker ${String(action.emoji ?? '')}`
    case 'addTable': return `Add table (${(action.header as string[] | undefined)?.length ?? 0} cols)`
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
    case 'gotoPage': return `Go to page ${action.page}`
    case 'addStockPhoto': return `Stock photo: ${String(action.query ?? '').slice(0, 40)}`
    case 'generateImage': return `Generate image: ${String(action.prompt ?? '').slice(0, 42)}…`
    case 'suggestPalette': return 'Use this palette'
    case 'translate': return `Translate to ${action.language}`
    case 'magicAnimate': return 'Magic Animate this page'
    case 'fixOverlaps': return 'Fix overlaps & off-canvas elements'
    case 'balanceLayout':
    case 'magicLayout': return 'Balance the layout'
    default: return action.type
  }
}
