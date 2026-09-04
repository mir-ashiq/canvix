// ─────────────────────────────────────────────────────────────
// Magic Layers — client-side image normalization
// ─────────────────────────────────────────────────────────────

import { loadImage } from './reconstruct'

/** Analyze size cap — vision quality vs transport size balance. */
export const ANALYSIS_MAX_EDGE = 1280

/**
 * Normalize an uploaded image for analysis:
 * - caps the longest edge at 1280px (vision models don't benefit from more)
 * - converts to JPEG (transport-friendly)
 * - returns the normalized dataURL + natural dimensions of the ORIGINAL
 */
export async function normalizeForAnalysis(
  file: File | Blob
): Promise<{ dataUrl: string; naturalWidth: number; naturalHeight: number }> {
  const raw = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(new Error('Could not read the file'))
    fr.readAsDataURL(file)
  })
  const img = await loadImage(raw)
  const longest = Math.max(img.naturalWidth, img.naturalHeight)
  const scale = Math.min(1, ANALYSIS_MAX_EDGE / longest)
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.9),
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
  }
}

/** Re-encode an existing image element src (any URL/dataURL) for analysis. */
export async function normalizeSrcForAnalysis(src: string): Promise<string> {
  const img = await loadImage(src)
  const longest = Math.max(img.naturalWidth, img.naturalHeight)
  const scale = Math.min(1, ANALYSIS_MAX_EDGE / longest)
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', 0.9)
}
