// ─────────────────────────────────────────────────────────────
// pptx-export — the PPTX orchestrator (Wave 5, first slice of
// "Export & Sharing Professionalisation": the audit's missing
// PowerPoint export).
//
// Pages render from DATA exactly like the vector PDF: images are
// preloaded by the video-export loader, each page maps to a slide
// through the native-first/raster-fallback mapper, and the result
// is a zip (OPC package) written by the dependency-free zip
// writer. Speaker notes ride along as native notes slides — the
// presentation story continues in the file format itself.
//
// Honest limits (docs/PPTX-EXPORT.md): PowerPoint re-wraps text
// with its own engine, so line breaks can differ slightly from
// the canvas; per-page size overrides letterbox onto the design
// size; charts/tables/embeds/plugins/audio/video/freehand/curved
// text export as high-resolution PNG snapshots.
// ─────────────────────────────────────────────────────────────

import type { PageData } from '@/lib/types'
import { collectImages } from '@/lib/video-export'
import { ZipWriter } from '@/lib/pptx/zip-writer'
import {
  appPropsXml,
  contentTypesXml,
  corePropsXml,
  notesMasterRelsXml,
  notesMasterXml,
  notesSlideRelsXml,
  notesSlideXml,
  presentationRelsXml,
  presentationXml,
  rootRelsXml,
  slideLayoutRelsXml,
  slideLayoutXml,
  slideMasterRelsXml,
  slideMasterXml,
  themeXml,
} from '@/lib/pptx/parts'
import { mapSlide, type MappedSlide, type PptxMediaBag, type SlideMapContext } from '@/lib/pptx/slide-mapper'

export interface PptxExportOptions {
  designWidth: number
  designHeight: number
  pages: PageData[]
  /** raster detail for fallback snapshots (the dialog's 1×/2×/3×) */
  pixelScale?: number
  /** document title (docProps + PowerPoint's title bar) */
  title?: string
  onProgress?: (ratio: number, label: string) => void
}

export interface PptxExportResult {
  blob: Blob
  pages: number
  bytes: number
  /** how many elements exported as native OOXML shapes */
  natives: number
  /** how many exported as raster snapshots */
  rasters: number
  /** how many pages carry speaker notes */
  notes: number
}

/** The media bag: dedupes sources → part names, holds the bytes. */
class MediaBag implements PptxMediaBag {
  private parts = new Map<string, { name: string; bytes: Uint8Array }>()
  private counter = 0
  private images: Map<string, HTMLImageElement>

  constructor(images: Map<string, HTMLImageElement>) {
    this.images = images
  }

  private async bytesFor(src: string): Promise<Uint8Array | null> {
    // JPEG data URLs pass through byte-identical (no re-encode —
    // the PDF embedder's DCTDecode posture)
    if (src.startsWith('data:image/jpeg;base64,')) {
      try {
        const b64 = src.slice(src.indexOf(',') + 1)
        const bin = atob(b64)
        const out = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
        return out
      } catch {
        return null
      }
    }
    // everything else re-encodes through the preloaded element
    const img = this.images.get(src)
    if (!img || !img.naturalWidth) return null
    if (typeof document === 'undefined') return null
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0)
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), 'image/png'))
    if (!blob) return null
    return new Uint8Array(await blob.arrayBuffer())
  }

  async imagePart(src: string): Promise<string | null> {
    const hit = this.parts.get(src)
    if (hit) return hit.name
    const bytes = await this.bytesFor(src)
    if (!bytes) return null
    const name = `media/image${++this.counter}.png`
    this.parts.set(src, { name, bytes })
    return name
  }

  async registerRaster(bytes: Uint8Array): Promise<string> {
    const name = `media/raster${++this.counter}.png`
    this.parts.set(`raster:${this.counter}`, { name, bytes })
    return name
  }

  entries(): { name: string; bytes: Uint8Array }[] {
    return [...this.parts.values()]
  }
}

export async function exportDesignToPptx(opts: PptxExportOptions): Promise<PptxExportResult> {
  const n = opts.pages.length
  if (!n) throw new Error('Nothing to export — the design has no pages.')

  const scale = opts.pixelScale ?? 2

  // 1. preload images (media data URLs + plugin renders + thumbs)
  opts.onProgress?.(0.08, 'Loading images…')
  const images = await collectImages(opts.pages)

  const media = new MediaBag(images)
  let idCounter = 1
  const ctx: SlideMapContext = {
    images,
    pixelScale: scale,
    media,
    nextId: () => ++idCounter,
  }

  // 2. map every page (slide + optional notes)
  const mapped: MappedSlide[] = []
  let natives = 0
  let rasters = 0
  let notes = 0
  for (let i = 0; i < n; i++) {
    opts.onProgress?.(0.15 + (0.6 * i) / n, `Rendering slide ${i + 1} of ${n}…`)
    const slide = await mapSlide(opts.pages[i], opts.designWidth, opts.designHeight, ctx)
    mapped.push(slide)
    natives += slide.natives
    rasters += slide.rasters
    if (opts.pages[i].notes?.trim()) notes++
  }

  // 3. assemble the package
  opts.onProgress?.(0.8, 'Writing PPTX…')
  const zip = new ZipWriter()
  const hasNotesMaster = notes > 0
  const slideParts = mapped.map((_, i) => `/ppt/slides/slide${i + 1}.xml`)
  const notesParts = mapped
    .map((_, i) => (opts.pages[i].notes?.trim() ? `/ppt/notesSlides/notesSlide${i + 1}.xml` : null))
    .filter((p): p is string => !!p)

  await zip.addText('[Content_Types].xml', contentTypesXml(slideParts, notesParts))
  await zip.addText('_rels/.rels', rootRelsXml())
  await zip.addText('docProps/core.xml', corePropsXml(opts.title ?? 'Canvix design'))
  await zip.addText('docProps/app.xml', appPropsXml(n))
  await zip.addText('ppt/presentation.xml', presentationXml(opts.designWidth, opts.designHeight, n, hasNotesMaster))
  await zip.addText('ppt/_rels/presentation.xml.rels', presentationRelsXml(n, hasNotesMaster))
  await zip.addText('ppt/theme/theme1.xml', themeXml())
  await zip.addText('ppt/slideMasters/slideMaster1.xml', slideMasterXml())
  await zip.addText('ppt/slideMasters/_rels/slideMaster1.xml.rels', slideMasterRelsXml())
  await zip.addText('ppt/slideLayouts/slideLayout1.xml', slideLayoutXml())
  await zip.addText('ppt/slideLayouts/_rels/slideLayout1.xml.rels', slideLayoutRelsXml())
  if (hasNotesMaster) {
    await zip.addText('ppt/notesMasters/notesMaster1.xml', notesMasterXml())
    await zip.addText('ppt/notesMasters/_rels/notesMaster1.xml.rels', notesMasterRelsXml())
  }
  for (let i = 0; i < n; i++) {
    const slide = mapped[i]
    await zip.addText(`ppt/slides/slide${i + 1}.xml`, slide.xml)
    const rels =
      slide.imageRels.size === 0
        ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`
        : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
          [...slide.imageRels.entries()]
            .map(([rid, part]) => `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../${part}"/>`)
            .join('') +
          `</Relationships>`
    await zip.addText(`ppt/slides/_rels/slide${i + 1}.xml.rels`, rels)
    if (opts.pages[i].notes?.trim()) {
      await zip.addText(`ppt/notesSlides/notesSlide${i + 1}.xml`, notesSlideXml(opts.pages[i].notes!.trim()))
      await zip.addText(`ppt/notesSlides/_rels/notesSlide${i + 1}.xml.rels`, notesSlideRelsXml(i + 1))
    }
  }
  for (const m of media.entries()) {
    await zip.addBytes(m.name, m.bytes)
  }

  const bytes = await zip.finalize()
  opts.onProgress?.(1, 'Done')
  return {
    blob: new Blob([bytes as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    }),
    pages: n,
    bytes: bytes.length,
    natives,
    rasters,
    notes,
  }
}

/** Trigger the browser download of an exported PPTX. */
export function downloadPptx(result: PptxExportResult, filename: string): void {
  const url = URL.createObjectURL(result.blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
