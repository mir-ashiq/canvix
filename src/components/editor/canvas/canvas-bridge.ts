'use client'

import Konva from 'konva'

/**
 * Shared mutable bridge between the editor store (autosave / export)
 * and the live Konva stage. Set by CanvasStage on mount.
 */
export const canvasBridge: {
  stage: Konva.Stage | null
  layer: Konva.Layer | null
  pageWidth: number
  pageHeight: number
  zoom: number
  pan: { x: number; y: number }
  fitToScreen: (() => void) | null
  refreshTransformer: (() => void) | null
  captureThumbnail: (() => Promise<string | null>) | null
} = {
  stage: null,
  layer: null,
  pageWidth: 1080,
  pageHeight: 1080,
  zoom: 1,
  pan: { x: 0, y: 0 },
  fitToScreen: null,
  refreshTransformer: null,
  captureThumbnail: null,
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

/**
 * Capture the current stage page as a dataURL, cropped & clipped to the page
 * bounds at the given output scale. Must be called while the desired page is shown.
 */
export async function captureStage(opts: {
  pixelScale: number
  mimeType?: 'image/png' | 'image/jpeg'
  quality?: number
}): Promise<string> {
  const { stage, layer, pageWidth, pageHeight, zoom, pan } = canvasBridge
  if (!stage || !layer) throw new Error('Canvas not ready')

  const rect = {
    x: pan.x,
    y: pan.y,
    width: pageWidth * zoom,
    height: pageHeight * zoom,
  }

  // clip the elements layer to the page rect (in stage/screen coords)
  const prevClip = layer.clip()
  layer.clip({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
  layer.batchDraw()
  await nextFrame()

  const url = stage.toDataURL({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    pixelRatio: opts.pixelScale / zoom,
    mimeType: opts.mimeType ?? 'image/png',
    quality: opts.quality ?? 0.92,
  })

  // restore clip state
  if (prevClip) layer.clip(prevClip)
  else layer.clip(null)
  layer.batchDraw()
  return url
}

/** Small thumbnail capture (max ~360px wide). */
export async function captureThumbnail(): Promise<string | null> {
  const { pageWidth } = canvasBridge
  if (!canvasBridge.stage) return null
  const scale = Math.min(360 / pageWidth, 1)
  try {
    return await captureStage({ pixelScale: scale, mimeType: 'image/jpeg', quality: 0.8 })
  } catch {
    return null
  }
}
