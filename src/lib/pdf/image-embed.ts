// ─────────────────────────────────────────────────────────────
// Image embedding for vector PDF export (v0.15 R4).
//
// Three paths, cheapest first:
//   1. JPEG passthrough — DCTDecode XObject with the original
//      bytes (no re-encode, no quality loss) when the image is
//      already JPEG and needs no transform and is not oversized
//      for its box.
//   2. Canvas path — anything else (PNG/WebP/SVG/plugin renders,
//      filtered/downscaled images, raster strips) is drawn to a
//      canvas, split into RGB + alpha planes and embedded as a
//      FlateDecode image with an /SMask when transparency is
//      present. Deflate comes from the platform's
//      CompressionStream — zero dependencies.
//   3. null — the source could not be loaded (fail-closed: the
//      caller renders the same honest placeholder the other
//      exporters use, or drops the element like SVG does).
//
// The canvas-touching half is browser-only (exercised by e2e);
// the byte-level half (passthrough, plane splitting, deflate,
// dictionary emission) is pure and unit-tested.
// ─────────────────────────────────────────────────────────────

import { parseJpegSize, pdfNum, PdfWriter } from './pdf-writer'

export interface EmbeddedImage {
  objNum: number
  width: number
  height: number
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'))
  const buf = await new Response(stream).arrayBuffer()
  return new Uint8Array(buf)
}

function dataUrlBytes(src: string): { bytes: Uint8Array; mime: string } | null {
  const m = /^data:([^;,]+)(;base64)?,([^\s]*)$/.exec(src)
  if (!m) return null
  const mime = m[1]
  if (m[2]) {
    try {
      const bin = atob(m[3])
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return { bytes, mime }
    } catch {
      return null
    }
  }
  const text = decodeURIComponent(m[3])
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff
  return { bytes, mime }
}

/** Split RGBA pixels into colour + alpha planes (pure). */
export function splitPlanes(rgba: Uint8Array): { rgb: Uint8Array; alpha: Uint8Array; hasAlpha: boolean } {
  const n = rgba.length / 4
  const rgb = new Uint8Array(n * 3)
  const alpha = new Uint8Array(n)
  let hasAlpha = false
  for (let i = 0; i < n; i++) {
    rgb[i * 3] = rgba[i * 4]
    rgb[i * 3 + 1] = rgba[i * 4 + 1]
    rgb[i * 3 + 2] = rgba[i * 4 + 2]
    alpha[i] = rgba[i * 4 + 3]
    if (rgba[i * 4 + 3] < 250) hasAlpha = true
  }
  return { rgb, alpha, hasAlpha }
}

export interface EmbedCanvas {
  width: number
  height: number
  /** RGBA pixels, width × height × 4 */
  data: Uint8Array
}

export class PdfImageEmbedder {
  private cache = new Map<string, EmbeddedImage | null>()

  constructor(private pdf: PdfWriter) {}

  /** Embed from a canvas-like source (browser path). */
  async embedCanvas(canvas: EmbedCanvas): Promise<EmbeddedImage> {
    const { rgb, alpha, hasAlpha } = splitPlanes(canvas.data)
    const [rgbZ, alphaZ] = await Promise.all([deflate(rgb), hasAlpha ? deflate(alpha) : null])
    let smask = ''
    let objData: Uint8Array
    let extra = ''
    if (hasAlpha && alphaZ) {
      const sm = this.pdf.addStreamObject(
        `<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode >>`,
        alphaZ,
      )
      smask = ` /SMask ${this.pdf.ref(sm)}`
      objData = rgbZ
      extra = ' /Filter /FlateDecode'
    } else {
      // fully opaque — flate the RGB plane directly
      objData = rgbZ
      extra = ' /Filter /FlateDecode'
    }
    void extra
    const obj = this.pdf.addStreamObject(
      `<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${smask} >>`,
      objData,
    )
    return { objNum: obj, width: canvas.width, height: canvas.height }
  }

  /** Embed a data-URL image. Returns null when unembeddable. */
  async embedDataUrl(src: string, opts: { maxW?: number; maxH?: number } = {}): Promise<EmbeddedImage | null> {
    if (this.cache.has(src)) return this.cache.get(src) ?? null
    const result = await this.embedDataUrlUncached(src, opts)
    this.cache.set(src, result)
    return result
  }

  private async embedDataUrlUncached(src: string, opts: { maxW?: number; maxH?: number }): Promise<EmbeddedImage | null> {
    const decoded = dataUrlBytes(src)
    if (!decoded) return null
    const { bytes, mime } = decoded
    const isJpeg = mime === 'image/jpeg' || mime === 'image/jpg'
    const dims = isJpeg ? parseJpegSize(bytes) : null
    const fits = dims
      ? (!opts.maxW || dims.width <= opts.maxW) && (!opts.maxH || dims.height <= opts.maxH)
      : false
    if (isJpeg && dims && fits) {
      // passthrough — the bytes are already DCT-coded
      const obj = this.pdf.addStreamObject(
        `<< /Type /XObject /Subtype /Image /Width ${dims.width} /Height ${dims.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode >>`,
        bytes,
      )
      return { objNum: obj, width: dims.width, height: dims.height }
    }
    // canvas path (browser); in non-DOM environments this degrades to null
    const canvas = await rasterizeToEmbedCanvas(src, opts)
    if (!canvas) return null
    return this.embedCanvas(canvas)
  }

  /** Ops to paint an image into a design-space box (y-down). */
  imageOps(img: EmbeddedImage, x: number, y: number, w: number, h: number, pageH: number, flipH = false, flipV = false): string {
    const a = flipH ? -w : w
    const d = flipV ? -h : h
    const tx = flipH ? x + w : x
    const ty = flipV ? pageH - y : pageH - y - h
    return `q ${pdfNum(a)} 0 0 ${pdfNum(d)} ${pdfNum(tx)} ${pdfNum(ty)} cm /Im${img.objNum} Do Q`
  }
}

async function rasterizeToEmbedCanvas(src: string, opts: { maxW?: number; maxH?: number }): Promise<EmbedCanvas | null> {
  if (typeof Image === 'undefined' || typeof document === 'undefined') return null
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.crossOrigin = 'anonymous'
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('load failed'))
      el.src = src
    })
    let w = img.naturalWidth || img.width
    let h = img.naturalHeight || img.height
    if (!w || !h) return null
    const scale = Math.min(1, (opts.maxW ?? 4096) / w, (opts.maxH ?? 4096) / h)
    w = Math.max(1, Math.round(w * scale))
    h = Math.max(1, Math.round(h * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, w, h)
    const data = ctx.getImageData(0, 0, w, h)
    return { width: w, height: h, data: new Uint8Array(data.data) }
  } catch {
    return null
  }
}
