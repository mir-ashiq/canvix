// ─────────────────────────────────────────────────────────────
// Magic Layers — client-side reconstruction
//
// Converts a validated MagicLayerAnalysis + the source bitmap into
// NATIVE Canvix elements (not a flat raster): text, shapes and
// cropped image regions, each carrying provenance metadata.
// ─────────────────────────────────────────────────────────────

import {
  createShapeElement,
  createTextElement,
  uid,
  type AnyElement,
  type Background,
  type ImageElement,
  type PageData,
} from '@/lib/types'
import { FONT_CLASS_MAP, type MagicLayerAnalysis, type MagicRegion } from './types'

export interface MagicLayersReconstruction {
  /** the page background to apply */
  background: Background
  /** full-bleed image element when the background is a photo (null otherwise) */
  backgroundElement: ImageElement | null
  /** reconstructed elements, bottom-to-top layer order */
  elements: AnyElement[]
  /** text elements need a post-insert measure pass (id → target height) */
  pendingMeasureIds: string[]
}

/** Load an image dataURL into an HTMLImageElement. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Image failed to load'))
    img.src = src
  })
}

/** Crop a normalized region out of a source bitmap → JPEG dataURL. */
async function cropRegion(
  img: HTMLImageElement,
  bounds: { x: number; y: number; w: number; h: number },
  maxDim: number
): Promise<{ dataUrl: string; width: number; height: number }> {
  const sx = Math.max(0, Math.floor(bounds.x * img.naturalWidth))
  const sy = Math.max(0, Math.floor(bounds.y * img.naturalHeight))
  const sw = Math.max(1, Math.floor(bounds.w * img.naturalWidth))
  const sh = Math.max(1, Math.floor(bounds.h * img.naturalHeight))
  // cap output to keep documents light (Phase 13 perf: no 4K crops in jsonb)
  const scale = Math.min(1, maxDim / Math.max(sw, sh))
  const dw = Math.max(1, Math.round(sw * scale))
  const dh = Math.max(1, Math.round(sh * scale))
  const canvas = document.createElement('canvas')
  canvas.width = dw
  canvas.height = dh
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh)
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.88), width: dw, height: dh }
}

/**
 * Reconstruct a full editable page from an analysis.
 *
 * @param analysis validated region analysis (from /api/ai/magic-layers)
 * @param sourceImage the original bitmap (dataURL)
 * @param pageWidth target page width in px
 * @param pageHeight target page height in px
 */
export async function reconstructDesign(
  analysis: MagicLayerAnalysis,
  sourceImage: string,
  pageWidth: number,
  pageHeight: number,
  /** regions to skip (discarded by the user in review) */
  skipRegionIds: string[] = []
): Promise<MagicLayersReconstruction> {
  const img = await loadImage(sourceImage)
  const skip = new Set(skipRegionIds)

  // background
  let background: Background = { type: 'solid', color: analysis.background.from ?? '#FFFFFF' }
  if (analysis.background.kind === 'gradient') {
    background = {
      type: 'gradient',
      from: analysis.background.from ?? '#1F142E',
      to: analysis.background.to ?? '#7630D7',
      angle: analysis.background.angle ?? 135,
    }
  }
  let backgroundElement: ImageElement | null = null
  if (analysis.background.kind === 'photo') {
    // full-bleed image as the bottom layer, page background stays solid white
    const src = await cropRegion(img, { x: 0, y: 0, w: 1, h: 1 }, Math.max(pageWidth, pageHeight))
    backgroundElement = {
      id: uid('image'),
      type: 'image',
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
      rotation: 0,
      opacity: 1,
      locked: false,
      visible: true,
      shadow: { enabled: false, color: '#000000', blur: 12, offsetX: 0, offsetY: 6 },
      src: src.dataUrl,
      radius: 0,
      naturalWidth: src.width,
      naturalHeight: src.height,
      name: 'Background (Magic Layers)',
      magicLayer: {
        sourceRegion: 'background',
        confidence: 1,
        sourceType: 'photo',
        originalBounds: { x: 0, y: 0, w: 1, h: 1 },
      },
    }
    background = { type: 'solid', color: '#FFFFFF' }
  }

  const elements: AnyElement[] = []
  const pendingMeasureIds: string[] = []

  if (backgroundElement) elements.push(backgroundElement)

  const ordered = [...analysis.regions].sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
  for (const region of ordered) {
    if (skip.has(region.id)) continue
    const el = await regionToElement(region, img, pageWidth, pageHeight)
    if (!el) continue
    if (el.type === 'text') pendingMeasureIds.push(el.id)
    elements.push(el)
  }

  return { background, backgroundElement, elements, pendingMeasureIds }
}

async function regionToElement(
  region: MagicRegion,
  img: HTMLImageElement,
  pageWidth: number,
  pageHeight: number
): Promise<AnyElement | null> {
  const x = Math.round(region.bounds.x * pageWidth)
  const y = Math.round(region.bounds.y * pageHeight)
  const w = Math.max(8, Math.round(region.bounds.w * pageWidth))
  const h = Math.max(8, Math.round(region.bounds.h * pageHeight))

  const meta = {
    sourceRegion: region.id,
    confidence: region.confidence,
    sourceType: region.type,
    originalBounds: { ...region.bounds },
  }

  if (region.type === 'text') {
    // font size: fraction of image height → px on the target page
    const fontPx = Math.max(8, Math.round((region.fontSize ?? 0.05) * pageHeight))
    const fonts = FONT_CLASS_MAP[region.fontClass ?? 'sans']
    const isHeading = (region.fontSize ?? 0.05) > 0.06
    const el = createTextElement({
      x,
      y,
      width: w,
      height: h,
    })
    el.text = region.text ?? ''
    el.fontSize = fontPx
    el.fontFamily = isHeading || region.bold ? fonts.heading : fonts.body
    el.bold = region.bold || isHeading
    el.italic = region.italic ?? false
    el.fill = region.color ?? '#1F2226'
    el.align = region.align ?? 'center'
    el.name = `Text — ${(region.text ?? '').slice(0, 18).replace(/\n/g, ' ')}`
    el.magicLayer = meta
    return el
  }

  if (region.type === 'photo') {
    // cropped image region from the source bitmap
    const crop = await cropRegion(img, region.bounds, 1024)
    return {
      id: uid('image'),
      type: 'image',
      x,
      y,
      width: w,
      height: h,
      rotation: 0,
      opacity: 1,
      locked: false,
      visible: true,
      shadow: { enabled: false, color: '#000000', blur: 12, offsetX: 0, offsetY: 6 },
      src: crop.dataUrl,
      radius: 0,
      naturalWidth: crop.width,
      naturalHeight: crop.height,
      name: region.subject ? `Image — ${region.subject.slice(0, 24)}` : 'Image region',
      magicLayer: meta,
    } satisfies ImageElement
  }

  if (region.type === 'shape' || region.type === 'decoration') {
    const shape = region.shape === 'ellipse' ? 'ellipse' : region.shape === 'rounded-rect' ? 'rect' : 'rect'
    const el = createShapeElement(shape, {
      x,
      y,
      width: w,
      height: h,
    })
    el.fill = region.color ?? '#00C4CC'
    el.cornerRadius = region.shape === 'rounded-rect' ? Math.min(24, Math.round(Math.min(w, h) * 0.2)) : 0
    el.name = region.type === 'decoration' ? 'Decoration' : `Shape — ${shape}`
    el.magicLayer = meta
    return el
  }

  return null
}

/** Build the page data for a reconstruction (used on "Create design"). */
export function toPage(rec: MagicLayersReconstruction): PageData {
  return {
    id: uid('page'),
    background: rec.background,
    elements: rec.elements,
  }
}
