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
import { resolveFontFaces } from '@/lib/pdf/fonts'
import { collectTextFaces } from '@/lib/pdf/text-ops'
import { sfxUrl } from '@/lib/assets/sfx-pack'
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
  type EmbeddedFontFace,
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
  /** v0.22: test seam for the SFX fetch (the fontLadderIo pattern) —
   *  defaults to the browser's same-origin fetch of /sfx/<id>.wav */
  sfxIo?: { fetchBytes?: (url: string) => Promise<Uint8Array | null> }
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
  /** v0.22: how many pages carry a transition */
  transitions: number
  /** v0.22: how many pages carry the transition SFX bytes */
  sounds: number
  /** v0.22: how many elements carry an entrance animation */
  animated: number
  /** v0.22: how many font FACES were embedded (0 = ladder failed
   *  or no text — the file still references the typefaces) */
  fontsEmbedded: number
}

/** The media bag: dedupes sources → part names, holds the bytes. */
class MediaBag implements PptxMediaBag {
  private parts = new Map<string, { name: string; bytes: Uint8Array }>()
  private counter = 0
  private images: Map<string, HTMLImageElement>

  constructor(images: Map<string, HTMLImageElement>, sfxIo?: PptxExportOptions['sfxIo']) {
    this.images = images
    this.sfxIo = sfxIo
  }

  // v0.22: the offline SFX pack — fetched once per id, embedded as wav
  private sounds = new Map<string, { name: string; bytes: Uint8Array } | null>()
  private sfxIo?: PptxExportOptions['sfxIo']

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

  async soundPart(id: string): Promise<string | null> {
    const hit = this.sounds.get(id)
    if (hit) return hit.name
    if (hit === null) return null
    const fetchBytes =
      this.sfxIo?.fetchBytes ??
      (async (url: string) => {
        if (typeof fetch === 'undefined') return null
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
          if (!res.ok) return null
          return new Uint8Array(await res.arrayBuffer())
        } catch {
          return null
        }
      })
    try {
      const bytes = await fetchBytes(sfxUrl(id))
      if (!bytes || bytes.length < 64) {
        this.sounds.set(id, null)
        return null
      }
      const name = `media/sfx${++this.counter}.wav`
      this.parts.set(`sound:${id}`, { name, bytes })
      this.sounds.set(id, { name, bytes })
      return name
    } catch {
      this.sounds.set(id, null)
      return null
    }
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

  const media = new MediaBag(images, opts.sfxIo)
  let idCounter = 1
  const ctx: SlideMapContext = {
    images,
    pixelScale: scale,
    media,
    nextId: () => ++idCounter,
  }

  // 2. resolve the document's text faces through the SAME collector the
  //    PDF exporter uses (walks text spans, table cells, chart labels,
  //    embed captions — everything the slides will reference), then the
  //    shared font ladder for TTF bytes. Failures degrade silently:
  //    typefaces stay referenced, viewers substitute (the pre-v0.22
  //    behaviour).
  opts.onProgress?.(0.1, 'Loading fonts…')
  const faceRequests = [...collectTextFaces(opts.pages).values()].map((n) => n.face)
  const resolvedFaces = await resolveFontFaces(faceRequests)
  // family → face slots with TTF bytes only (std14 fallbacks can't embed)
  const embedded = new Map<string, EmbeddedFontFace>()
  const fontBytes: { name: string; bytes: Uint8Array }[] = []
  let fontRelCursor = 0
  const fontRids = new Map<string, string>()
  for (const face of resolvedFaces.values()) {
    if (face.kind !== 'ttf') continue
    const slot = face.bold && face.italic ? 'bi' : face.bold ? 'bold' : face.italic ? 'italic' : 'regular'
    let entry = embedded.get(face.family)
    if (!entry) {
      entry = { family: face.family, faces: {} }
      embedded.set(face.family, entry)
    }
    if (entry.faces[slot]) continue
    const rid = `rIdF${++fontRelCursor}`
    const part = `fonts/font${fontRelCursor}.fntdata`
    entry.faces[slot] = rid
    fontRids.set(rid, part)
    fontBytes.push({ name: `ppt/${part}`, bytes: face.bytes })
  }

  // 3. map every page (slide + optional notes)
  const mapped: MappedSlide[] = []
  let natives = 0
  let rasters = 0
  let notes = 0
  let transitions = 0
  let sounds = 0
  let animated = 0
  for (let i = 0; i < n; i++) {
    opts.onProgress?.(0.15 + (0.55 * i) / n, `Rendering slide ${i + 1} of ${n}…`)
    const slide = await mapSlide(opts.pages[i], opts.designWidth, opts.designHeight, ctx)
    mapped.push(slide)
    natives += slide.natives
    rasters += slide.rasters
    animated += slide.animated.length
    if (opts.pages[i].notes?.trim()) notes++
    if (slide.xml.includes('<p:transition')) transitions++
    if (slide.hasSound) sounds++
  }

  // 3. assemble the package
  opts.onProgress?.(0.8, 'Writing PPTX…')
  const zip = new ZipWriter()
  const hasNotesMaster = notes > 0
  const slideParts = mapped.map((_, i) => `/ppt/slides/slide${i + 1}.xml`)
  const notesParts = mapped
    .map((_, i) => (opts.pages[i].notes?.trim() ? `/ppt/notesSlides/notesSlide${i + 1}.xml` : null))
    .filter((p): p is string => !!p)

  await zip.addText(
    '[Content_Types].xml',
    contentTypesXml(slideParts, notesParts, { fonts: fontBytes.length, sounds }),
  )
  await zip.addText('_rels/.rels', rootRelsXml())
  await zip.addText('docProps/core.xml', corePropsXml(opts.title ?? 'Canvix design'))
  await zip.addText('docProps/app.xml', appPropsXml(n))
  await zip.addText(
    'ppt/presentation.xml',
    presentationXml(opts.designWidth, opts.designHeight, n, hasNotesMaster, [...embedded.values()]),
  )
  await zip.addText(
    'ppt/_rels/presentation.xml.rels',
    presentationRelsXml(n, hasNotesMaster, [...fontRids.entries()].map(([rid, part]) => ({ rid, part }))),
  )
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
      slide.imageRels.size === 0 && slide.soundRels.size === 0
        ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`
        : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
          [...slide.imageRels.entries()]
            .map(([rid, part]) => `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../${part}"/>`)
            .join('') +
          [...slide.soundRels.entries()]
            .map(([rid, part]) => `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/audio" Target="../${part}"/>`)
            .join('') +
          `</Relationships>`
    await zip.addText(`ppt/slides/_rels/slide${i + 1}.xml.rels`, rels)
    if (opts.pages[i].notes?.trim()) {
      await zip.addText(`ppt/notesSlides/notesSlide${i + 1}.xml`, notesSlideXml(opts.pages[i].notes!.trim()))
      await zip.addText(`ppt/notesSlides/_rels/notesSlide${i + 1}.xml.rels`, notesSlideRelsXml(i + 1))
    }
  }
  for (const m of media.entries()) {
    // v0.22 fix: media parts live under ppt/ — the slide rels say
    // "../media/imageN.png" (relative to ppt/slides/_rels/), which
    // resolves to ppt/media/…; before this the parts landed at the
    // package ROOT and every image/sound in a PPTX was a broken ref
    await zip.addBytes(`ppt/${m.name}`, m.bytes)
  }
  // v0.22: the embedded font parts (raw TTF bytes as fntdata)
  for (const f of fontBytes) {
    await zip.addBytes(f.name, f.bytes)
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
    transitions,
    sounds,
    animated,
    fontsEmbedded: fontBytes.length,
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
