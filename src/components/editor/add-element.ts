'use client'

import {
  createImageElement,
  createTextElement,
  createShapeElement,
  createStickerElement,
  createLineElement,
  createTableElement,
  createFrameElement,
  createEmbedElement,
  createChartElement,
  type AnyElement,
  type ChartKind,
  type FrameShape,
} from '@/lib/types'
import { useEditorStore } from '@/store/editor-store'
import { GRAPHICS } from '@/lib/editor-utils'

/** center-ish placement with a small cascade so stacked adds are visible */
export function placement(width: number, height: number, count: number) {
  const state = useEditorStore.getState()
  return {
    x: Math.max(0, (state.width - width) / 2 + ((count % 7) - 3) * 18),
    y: Math.max(0, (state.height - height) / 2 + ((count % 7) - 3) * 18),
  }
}

function addCentered(el: AnyElement) {
  const store = useEditorStore.getState()
  const page = store.pages[store.currentPage]
  const pos = placement(el.width, el.height, page.elements.length)
  Object.assign(el, pos)
  store.addElement(el)
}

export function addText(preset: 'heading' | 'subheading' | 'body') {
  const configs = {
    heading: { text: 'Add a heading', fontSize: 96, bold: true, fontFamily: 'Montserrat' },
    subheading: { text: 'Add a subheading', fontSize: 56, bold: true, fontFamily: 'Poppins' },
    body: { text: 'Add a little bit of body text', fontSize: 32, fontFamily: 'Poppins' },
  } as const
  const c = configs[preset]
  addCentered(
    createTextElement({
      ...c,
      width: 760,
      align: 'center',
    })
  )
}

export function addTextStyled(opts: Partial<import('@/lib/types').TextElement>) {
  addCentered(createTextElement({ width: 760, align: 'center', ...opts }))
}

export function addShape(kind: 'rect' | 'rounded' | 'ellipse' | 'triangle' | 'star') {
  const size = 320
  if (kind === 'rect') addCentered(createShapeElement('rect', { width: size, height: size * 0.7, cornerRadius: 0 }))
  else if (kind === 'rounded') addCentered(createShapeElement('rect', { width: size, height: size * 0.7, cornerRadius: 40 }))
  else if (kind === 'ellipse') addCentered(createShapeElement('ellipse', { width: size, height: size }))
  else if (kind === 'triangle') addCentered(createShapeElement('triangle', { width: size, height: size * 0.85 }))
  else addCentered(createShapeElement('star', { width: size, height: size }))
}

/** v0.18 (Wave 3): native parametric polygon — sides 3..12, editable
 *  from the properties bar after insertion. */
export function addPolygon(sides: number) {
  addCentered(createShapeElement('polygon', { width: 320, height: 320, sides }))
}

/** v0.18 (Wave 3): star variant — points 3..16 + spike ratio. */
export function addStarVariant(numPoints: number, innerRatio?: number) {
  addCentered(createShapeElement('star', { width: 320, height: 320, numPoints, innerRatio }))
}

export function addGraphic(graphicId: string, fill?: string) {
  const def = GRAPHICS.find((g) => g.id === graphicId)
  if (!def) return
  addCentered(createShapeElement('path', { width: 300, height: 300, pathData: def.path, ...(fill ? { fill } : {}) }))
}

/**
 * v0.17 (Wave 2): insert an offline-pack icon as a stroke path element.
 * Icon art is authored in the 100×100 box (see lib/assets/icon-pack.ts)
 * — lucide stroke-weight 2 at 24px scales to ≈ 8.3 in that box, and the
 * canvas renderer normalises strokeWidth by width/100, so the icon keeps
 * its stroke at any size. Recolourable from the properties bar.
 */
export function addIconPath(d: string, stroke: string) {
  addCentered(
    createShapeElement('path', {
      width: 240,
      height: 240,
      pathData: d,
      fill: 'transparent',
      stroke,
      strokeWidth: 8.3,
    })
  )
}

/**
 * v0.17 (Wave 2): insert an online Iconify icon (or any small SVG) as an
 * image element from a data URL — full colour fidelity for multi-colour
 * icon sets, same export path as brand logos.
 */
export function addSvgAsImage(svg: string) {
  const url = `data:image/svg+xml;base64,${typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(svg))) : Buffer.from(svg, 'utf8').toString('base64')}`
  addCentered(createImageElement(url, 240, 240, {}))
}

/** v0.17 (Wave 2): insert an illustration-pack SVG on the canvas. */
export function addIllustration(svg: string) {
  const url = `data:image/svg+xml;base64,${typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(svg))) : Buffer.from(svg, 'utf8').toString('base64')}`
  addCentered(createImageElement(url, 420, 420, {}))
}

export function addLine(variant: 'solid' | 'dashed' | 'arrow' | 'arrowBoth') {
  const state = useEditorStore.getState()
  const width = Math.min(420, state.width * 0.6)
  const el = createLineElement({
    x: (state.width - width) / 2,
    y: state.height / 2,
    width,
    ...(variant === 'dashed' ? { dashed: true } : {}),
    ...(variant === 'arrow' ? { arrowEnd: true } : {}),
    ...(variant === 'arrowBoth' ? { arrowStart: true, arrowEnd: true } : {}),
  })
  state.addElement(el)
}

export function addSticker(char: string) {
  addCentered(createStickerElement(char, { width: 200, height: 200, fontSize: 150 }))
}

// ── v0.6: tables, frames, embeds ───────────────────────────

export type TableStyle = 'classic' | 'minimal' | 'bold' | 'soft'

/** Add a native table — every cell stays editable on the canvas. */
export function addTable(style: TableStyle = 'classic') {
  const styles: Record<TableStyle, Partial<import('@/lib/types').TableElement> & { header?: string[] }> = {
    classic: {
      header: ['Header 1', 'Header 2', 'Header 3'],
      rows: 4,
      cols: 3,
      headerFill: '#1F142E',
      borderColor: '#E0E1E6',
      fill: 'transparent',
      textColor: '#1F2226',
    },
    minimal: {
      header: ['Item', 'Qty', 'Price'],
      rows: 4,
      cols: 3,
      headerFill: 'transparent',
      headerTextColor: '#7630D7',
      borderColor: '#EDEFF2',
      borderWidth: 1,
      fill: 'transparent',
      textColor: '#1F2226',
    },
    bold: {
      header: ['Plan', 'Features', 'Price'],
      rows: 4,
      cols: 3,
      headerFill: '#7630D7',
      borderColor: '#7630D7',
      borderWidth: 2,
      fill: '#F6F2FC',
      textColor: '#1F142E',
    },
    soft: {
      header: ['Task', 'Owner', 'Due'],
      rows: 4,
      cols: 3,
      headerFill: '#02C0CC',
      borderColor: '#C8EDF0',
      borderWidth: 1.5,
      fill: '#F2FBFC',
      textColor: '#0E3A40',
    },
  }
  const s = styles[style]
  addCentered(createTableElement({ width: 480, rowHeight: 46, ...s }))
}

export function addFrame(frameShape: FrameShape) {
  const size = 340
  addCentered(
    createFrameElement(frameShape, {
      width: size,
      height: frameShape === 'circle' || frameShape === 'ellipse' ? size : Math.round(size * 0.66),
    })
  )
}

/** Add an embed link card (YouTube / Maps / generic URL). */
export function addEmbed(url: string, title?: string) {
  const trimmed = url.trim()
  if (!trimmed) return
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  addCentered(createEmbedElement(withProto, { width: 340, height: 214, ...(title ? { title } : {}) }))
}

// ── v0.14 (D7): data-bound charts ──────────────────────────

/** Add a native chart — data stays editable from the context toolbar. */
export function addChart(kind: ChartKind) {
  const w = kind === 'donut' ? 380 : kind === 'scatter' ? 520 : 560
  const h = kind === 'donut' ? 380 : 360
  addCentered(createChartElement(kind, { width: w, height: h }))
}

/** If a page point lands inside a frame element, fill that frame with the image (canva drop-to-fill). */
export function fillFrameAt(pageX: number, pageY: number, src: string, naturalWidth: number, naturalHeight: number): boolean {
  const state = useEditorStore.getState()
  const page = state.pages[state.currentPage]
  const hit = [...page.elements]
    .reverse()
    .find(
      (el) =>
        el.type === 'frame' &&
        el.visible &&
        pageX >= el.x &&
        pageX <= el.x + el.width &&
        pageY >= el.y &&
        pageY <= el.y + el.height
    ) as import('@/lib/types').FrameElement | undefined
  if (!hit) return false
  state.updateElements([hit.id], { src, naturalWidth, naturalHeight })
  return true
}

/** replace the image inside a selected frame (canva "Fill frame") */
export function fillSelectedFrame(src: string, naturalWidth: number, naturalHeight: number): boolean {
  const state = useEditorStore.getState()
  const sel = state.pages[state.currentPage].elements.find(
    (e) => state.selectedIds.includes(e.id) && e.type === 'frame'
  )
  if (!sel) return false
  state.updateElements([sel.id], { src, naturalWidth, naturalHeight })
  return true
}

/**
 * v0.5 perf: downscale oversized uploads before embedding. Huge photos (e.g. 12 MP)
 * used to bloat the jsonb document; we cap the stored dataURL at 2048px longest edge
 * (print-quality for typical designs, ~85% smaller documents). PNGs with transparency
 * keep their alpha; opaque images become JPEG.
 */
export async function downscaleForEmbed(src: string, maxEdge = 2048): Promise<{ src: string; width: number; height: number }> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new window.Image()
    i.onload = () => resolve(i)
    i.onerror = () => reject(new Error('load failed'))
    i.src = src
  })
  const longest = Math.max(img.naturalWidth, img.naturalHeight)
  if (longest <= maxEdge) {
    return { src, width: img.naturalWidth, height: img.naturalHeight } // already small enough
  }
  const scale = maxEdge / longest
  const w = Math.round(img.naturalWidth * scale)
  const h = Math.round(img.naturalHeight * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return { src, width: img.naturalWidth, height: img.naturalHeight }
  ctx.drawImage(img, 0, 0, w, h)
  // detect alpha: sample the corners… simple heuristic — if the source is a
  // data:image/png keep PNG, otherwise JPEG
  const isPng = src.startsWith('data:image/png')
  const out = isPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.9)
  // if PNG ballooned larger than the original, keep the original
  if (out.length > src.length && src.startsWith('data:')) return { src, width: img.naturalWidth, height: img.naturalHeight }
  return { src: out, width: w, height: h }
}

export function addImageFromSrc(src: string, naturalWidth: number, naturalHeight: number) {
  const state = useEditorStore.getState()
  const maxW = state.width * 0.7
  const maxH = state.height * 0.7
  const scale = Math.min(maxW / naturalWidth, maxH / naturalHeight, 1)
  const w = Math.round(naturalWidth * scale)
  const h = Math.round(naturalHeight * scale)
  const pos = placement(w, h, state.pages[state.currentPage].elements.length)
  state.addElement(
    createImageElement(src, naturalWidth, naturalHeight, {
      ...pos,
      width: w,
      height: h,
    })
  )
}

/** loads an image, downscales oversized sources, then adds it to the canvas */
export function addImageFromFile(file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Not an image'))
      return
    }
    if (file.size > 25 * 1024 * 1024) {
      reject(new Error('Image too large (max 25 MB)'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const src = String(reader.result)
      const img = new window.Image()
      img.onload = () => {
        void downscaleForEmbed(src).then(({ src: scaled, width, height }) => {
          addImageFromSrc(scaled, width, height)
          resolve()
        }).catch(() => {
          addImageFromSrc(src, img.naturalWidth, img.naturalHeight)
          resolve()
        })
      }
      img.onerror = () => reject(new Error('Failed to load image'))
      img.src = src
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

/** replace the src of the currently selected image element (canva "Replace") */
export function replaceSelectedImage(src: string, naturalWidth: number, naturalHeight: number) {
  const state = useEditorStore.getState()
  const sel = state.pages[state.currentPage].elements.filter((e) => state.selectedIds.includes(e.id) && e.type === 'image')
  if (!sel.length) {
    addImageFromSrc(src, naturalWidth, naturalHeight)
    return
  }
  for (const el of sel) {
    const im = el as import('@/lib/types').ImageElement
    // keep the box, refit aspect if it distorts more than 15%
    const boxRatio = im.width / im.height
    const imgRatio = naturalWidth / naturalHeight
    let { width, height } = im
    if (Math.abs(boxRatio - imgRatio) / imgRatio > 0.15) {
      const refit = Math.min(im.width / naturalWidth, im.height / naturalHeight)
      width = Math.round(naturalWidth * refit)
      height = Math.round(naturalHeight * refit)
    }
    state.updateElements([im.id], { src, naturalWidth, naturalHeight, width, height })
  }
}

/** load a File → {src, w, h} without touching the canvas */
export function readImageFile(file: File): Promise<{ src: string; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Not an image'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const src = String(reader.result)
      const img = new window.Image()
      img.onload = () => resolve({ src, w: img.naturalWidth, h: img.naturalHeight })
      img.onerror = () => resolve({ src, w: 500, h: 500 })
      img.src = src
    }
    reader.onerror = () => reject(new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

/** add an image dropped at a page position */
export function addImageAt(src: string, naturalWidth: number, naturalHeight: number, x: number, y: number) {
  const state = useEditorStore.getState()
  const maxW = state.width * 0.7
  const scale = Math.min(maxW / naturalWidth, 1)
  const w = Math.round(naturalWidth * scale)
  const h = Math.round(naturalHeight * scale)
  state.addElement(
    createImageElement(src, naturalWidth, naturalHeight, {
      x: Math.max(0, Math.round(x - w / 2)),
      y: Math.max(0, Math.round(y - h / 2)),
      width: w,
      height: h,
    })
  )
}

// ── v0.11: audio/video elements ──────────────────────────────

/**
 * Upload an audio file to the media store, analyze it (waveform peaks +
 * BPM + beat grid — all baked into the element so every replica renders
 * and beat-syncs without the multi-MB file), and add it to the canvas.
 * onProgress reports upload chunks (0..1).
 */
export async function addAudioFromFile(
  file: File,
  onProgress?: (ratio: number) => void,
): Promise<void> {
  const { uploadMediaFile, mediaSrc } = await import('@/lib/media/media-client')
  const { analyzeAudioFile } = await import('@/lib/media/decode')
  const { createAudioElement } = await import('@/lib/types')
  const [handle, analysis] = await Promise.all([uploadMediaFile(file, onProgress), analyzeAudioFile(file)])
  const store = useEditorStore.getState()
  const w = Math.min(520, Math.max(360, store.width * 0.55))
  const pos = placement(w, 96, store.pages[store.currentPage].elements.length)
  store.addElement(
    createAudioElement(mediaSrc(handle.id), file.name.replace(/\.[^.]+$/, '').slice(0, 60), analysis.duration, {
      ...pos,
      width: Math.round(w),
      height: 96,
      peaks: analysis.peaks,
      bpm: analysis.bpm,
      beats: analysis.beats,
    })
  )
}

/** Upload a video file, capture its poster frame, and add it to the canvas. */
export async function addVideoFromFile(
  file: File,
  onProgress?: (ratio: number) => void,
): Promise<void> {
  const { uploadMediaFile, mediaSrc } = await import('@/lib/media/media-client')
  const { probeVideoFile } = await import('@/lib/media/decode')
  const { createVideoElement } = await import('@/lib/types')
  const [handle, probe] = await Promise.all([uploadMediaFile(file, onProgress), probeVideoFile(file)])
  const store = useEditorStore.getState()
  const maxW = store.width * 0.7
  const w = Math.round(Math.min(maxW, Math.max(200, probe.naturalWidth || 480)))
  const h = Math.round(probe.naturalWidth ? (w * probe.naturalHeight) / probe.naturalWidth : w * 0.5625)
  const pos = placement(w, h, store.pages[store.currentPage].elements.length)
  store.addElement(
    createVideoElement(mediaSrc(handle.id), probe.poster, probe.duration, probe.naturalWidth, probe.naturalHeight, {
      ...pos,
      width: w,
      height: h,
    })
  )
}

// ── v0.14 (D1): the persistent uploads library ──────────────

/**
 * Upload an image through the media store (NOT document embedding):
 * the original bytes land server-side — sha256-deduped within the
 * account, quota-counted, and listed in the Uploads panel from the
 * database. Returns the element-facing src + natural dimensions.
 */
export async function uploadImageToLibrary(
  file: File,
  onProgress?: (ratio: number) => void,
): Promise<{ id: string; src: string; w: number; h: number }> {
  if (!file.type.startsWith('image/')) throw new Error('Not an image')
  const { uploadMediaFile, mediaSrc } = await import('@/lib/media/media-client')
  const handle = await uploadMediaFile(file, onProgress)
  const { w, h } = await probeImageSize(mediaSrc(handle.id))
  return { id: handle.id, src: mediaSrc(handle.id), w, h }
}

/** natural dimensions of an image URL (same-origin media or data). */
export function probeImageSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new window.Image()
    img.onload = () => resolve({ w: img.naturalWidth || 500, h: img.naturalHeight || 500 })
    img.onerror = () => resolve({ w: 500, h: 500 })
    img.src = src
  })
}

/** Insert an image that already lives in the media store (library). */
export function addImageFromLibrary(id: string, w: number, h: number) {
  addImageFromSrc(`/api/media/${id}`, w, h)
}

/**
 * Insert audio that already lives in the media store — the element
 * references the served URL; duration is probed from the fetched blob
 * (the store keeps bytes, not metadata).
 */
export async function addAudioFromLibrary(id: string, name: string): Promise<void> {
  const { analyzeAudioFile } = await import('@/lib/media/decode')
  const { createAudioElement } = await import('@/lib/types')
  const blob = await fetch(`/api/media/${id}`).then((r) => {
    if (!r.ok) throw new Error('Media unavailable')
    return r.blob()
  })
  const analysis = await analyzeAudioFile(new File([blob], name || 'audio', { type: blob.type }))
  const store = useEditorStore.getState()
  const w = Math.min(520, Math.max(360, store.width * 0.55))
  const pos = placement(w, 96, store.pages[store.currentPage].elements.length)
  store.addElement(
    createAudioElement(`/api/media/${id}`, (name || 'Audio').replace(/\.[^.]+$/, '').slice(0, 60), analysis.duration, {
      ...pos,
      width: Math.round(w),
      height: 96,
      peaks: analysis.peaks,
      bpm: analysis.bpm,
      beats: analysis.beats,
    })
  )
}

/** Insert video that already lives in the media store (library). */
export async function addVideoFromLibrary(id: string, name: string): Promise<void> {
  const { probeVideoFile } = await import('@/lib/media/decode')
  const { createVideoElement } = await import('@/lib/types')
  const blob = await fetch(`/api/media/${id}`).then((r) => {
    if (!r.ok) throw new Error('Media unavailable')
    return r.blob()
  })
  const probe = await probeVideoFile(new File([blob], name || 'video', { type: blob.type }))
  const store = useEditorStore.getState()
  const maxW = store.width * 0.7
  const w = Math.round(Math.min(maxW, Math.max(200, probe.naturalWidth || 480)))
  const h = Math.round(probe.naturalWidth ? (w * probe.naturalHeight) / probe.naturalWidth : w * 0.5625)
  const pos = placement(w, h, store.pages[store.currentPage].elements.length)
  store.addElement(
    createVideoElement(`/api/media/${id}`, probe.poster, probe.duration, probe.naturalWidth, probe.naturalHeight, {
      ...pos,
      width: w,
      height: h,
    })
  )
}

// ── v0.15 (R6): stock videos ─────────────────────────────────

/**
 * Download a stock-video rendition in the BROWSER (both provider
 * CDNs answer Access-Control-Allow-Origin: * on GET — verified
 * empirically, see src/lib/stock-video.ts) and ride the existing
 * upload → probe → element path, so quota, sha256 dedupe, the
 * 32 MB cap, poster capture and the R3 export semantics all apply
 * unchanged. The rendition list is a LADDER: when the media store
 * rejects the primary (size cap 413, quota) or a download fails,
 * the next smaller rendition is tried; the FIRST error is rethrown
 * once every tier fails. The sanitized credit block is stored
 * durably on the element (toast + properties bar surface it).
 */
export async function addStockVideo(
  stock: {
    id: string
    mp4: string
    alternates: string[]
    width: number
    height: number
    credit: { provider: string; author: string; license: string; url: string }
  },
  onProgress?: (ratio: number) => void,
): Promise<void> {
  const { uploadMediaFile, mediaSrc } = await import('@/lib/media/media-client')
  const { probeVideoFile } = await import('@/lib/media/decode')
  const { createVideoElement } = await import('@/lib/types')

  let firstError: unknown = null
  for (const url of [stock.mp4, ...stock.alternates]) {
    try {
      const blob = await fetch(url).then((r) => {
        if (!r.ok) throw new Error(`Download failed (${r.status}).`)
        return r.blob()
      })
      const file = new File([blob], `${stock.id}.mp4`, { type: blob.type || 'video/mp4' })
      const [handle, probe] = await Promise.all([uploadMediaFile(file, onProgress), probeVideoFile(file)])

      const store = useEditorStore.getState()
      const naturalW = probe.naturalWidth || stock.width || 480
      const naturalH = probe.naturalHeight || stock.height || Math.round(naturalW * 0.5625)
      const maxW = store.width * 0.7
      const w = Math.round(Math.min(maxW, Math.max(200, naturalW)))
      const h = Math.round((w * naturalH) / naturalW)
      const pos = placement(w, h, store.pages[store.currentPage].elements.length)
      store.addElement(
        createVideoElement(mediaSrc(handle.id), probe.poster, probe.duration, naturalW, naturalH, {
          ...pos,
          width: w,
          height: h,
          credit: stock.credit,
        })
      )
      return
    } catch (err) {
      firstError ??= err
    }
  }
  throw firstError instanceof Error ? firstError : new Error('Could not add the stock video.')
}

/** v0.16.4 (A4): insert a stock PHOTO from the Photos panel's search
 *  (Pexels/Pixabay). The addStockVideo pattern one class over: download
 *  the preferred rendition in the browser (provider CDNs are CORS-open),
 *  ride the existing chunked media store (quota, sha256 dedupe, size cap
 *  all apply), probe the REAL dimensions from the bytes, and store the
 *  durable credit on the element. The alternates ladder retries smaller
 *  renditions when the store's cap rejects the primary. */
export async function addStockPhoto(
  stock: {
    id: string
    download: string
    alternates: string[]
    width: number
    height: number
    credit: { provider: string; author: string; license: string; url: string }
  },
  onProgress?: (ratio: number) => void,
): Promise<void> {
  const { uploadMediaFile, mediaSrc } = await import('@/lib/media/media-client')
  const { createImageElement } = await import('@/lib/types')

  let firstError: unknown = null
  for (const url of [stock.download, ...stock.alternates]) {
    try {
      const blob = await fetch(url).then((r) => {
        if (!r.ok) throw new Error(`Download failed (${r.status}).`)
        return r.blob()
      })
      // real dimensions from the actual bytes — provider metadata is a
      // hint, the blob is the truth (createImageBitmap, with a metadata
      // fallback for engines without it)
      let naturalW = stock.width || 1200
      let naturalH = stock.height || 800
      try {
        const bmp = await createImageBitmap(blob)
        naturalW = bmp.width || naturalW
        naturalH = bmp.height || naturalH
        bmp.close()
      } catch {
        /* keep the metadata dims */
      }
      const file = new File([blob], `${stock.id}.jpg`, { type: blob.type || 'image/jpeg' })
      const handle = await uploadMediaFile(file, onProgress)

      const store = useEditorStore.getState()
      const maxW = store.width * 0.7
      const maxH = store.height * 0.7
      const scale = Math.min(maxW / naturalW, maxH / naturalH, 1)
      const w = Math.round(naturalW * scale)
      const h = Math.round(naturalH * scale)
      const pos = placement(w, h, store.pages[store.currentPage].elements.length)
      store.addElement(
        createImageElement(mediaSrc(handle.id), naturalW, naturalH, {
          ...pos,
          width: w,
          height: h,
          credit: stock.credit,
        })
      )
      return
    } catch (err) {
      firstError ??= err
    }
  }
  throw firstError instanceof Error ? firstError : new Error('Could not add the stock photo.')
}

/** v0.19 (Wave 4): insert an AI-GENERATED video (the /api/ai/video
 *  proxy URL). Same pipeline as stock video: download the bytes in the
 *  browser, ride the chunked media store (quota, dedupe, size cap),
 *  probe the real dimensions + first-frame poster, place it. No credit
 *  block — the element is the user's own generation. */
export async function addGeneratedVideo(url: string, onProgress?: (ratio: number) => void): Promise<void> {
  const { uploadMediaFile, mediaSrc } = await import('@/lib/media/media-client')
  const { probeVideoFile } = await import('@/lib/media/decode')
  const { createVideoElement } = await import('@/lib/types')

  const blob = await fetch(url).then((r) => {
    if (!r.ok) throw new Error(`Download failed (${r.status}).`)
    return r.blob()
  })
  const file = new File([blob], `ai-video-${Date.now()}.mp4`, { type: blob.type || 'video/mp4' })
  const [handle, probe] = await Promise.all([uploadMediaFile(file, onProgress), probeVideoFile(file)])

  const store = useEditorStore.getState()
  const naturalW = probe.naturalWidth || 1024
  const naturalH = probe.naturalHeight || 576
  const maxW = store.width * 0.7
  const w = Math.round(Math.min(maxW, Math.max(200, naturalW)))
  const h = Math.round((w * naturalH) / naturalW)
  const pos = placement(w, h, store.pages[store.currentPage].elements.length)
  store.addElement(
    createVideoElement(mediaSrc(handle.id), probe.poster, probe.duration, naturalW, naturalH, {
      ...pos,
      width: w,
      height: h,
    }),
  )
}
