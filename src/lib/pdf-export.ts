// ─────────────────────────────────────────────────────────────
// Vector-text PDF export (v0.15 R4) — the orchestrator.
//
// Pages render from DATA (not the live stage): font faces are
// collected across the whole document, resolved through the
// acquisition ladder (embed real TTF subsets when reachable,
// documented std14 fallback otherwise), images are preloaded by
// the video-export loader, and each page is mapped to PDF
// operators by the vector renderer with per-element raster-strip
// fallbacks. The output is a PDF 1.4 file with selectable,
// searchable text — see docs/PDF-VECTOR-EXPORT.md for the
// architecture and the dependency decisions on record.
// ─────────────────────────────────────────────────────────────

import type { PageData } from '@/lib/types'
import { collectImages } from '@/lib/video-export'
import { PdfWriter, pdfTextString } from '@/lib/pdf/pdf-writer'
import { PdfImageEmbedder } from '@/lib/pdf/image-embed'
import type { FontLadderIo } from '@/lib/pdf/fonts'
import { collectTextFaces, createBrowserTextIo, PdfFontRegistry } from '@/lib/pdf/text-ops'
import { VectorPageRenderer } from '@/lib/pdf/vector-page'

export interface PdfExportOptions {
  designWidth: number
  designHeight: number
  pages: PageData[]
  /** raster detail for strips + embedded images (the dialog's 1×/2×/3×) */
  pixelScale?: number
  /** document /Title (the design name) */
  title?: string
  /** test seam — inject the font ladder IO (defaults to the live ladder) */
  fontLadderIo?: FontLadderIo
  onProgress?: (ratio: number, label: string) => void
}

export interface PdfExportResult {
  blob: Blob
  pages: number
  bytes: number
}

export async function exportDesignToPdf(opts: PdfExportOptions): Promise<PdfExportResult> {
  const n = opts.pages.length
  if (!n) throw new Error('Nothing to export — the design has no pages.')

  const pdf = new PdfWriter()
  const fonts = new PdfFontRegistry(pdf)

  // 1. fonts for every text-bearing element in the document
  opts.onProgress?.(0.06, 'Embedding fonts…')
  await fonts.build(collectTextFaces(opts.pages), opts.fontLadderIo ?? {})

  // 2. preload images (media data URLs + plugin renders + thumbs)
  opts.onProgress?.(0.22, 'Loading images…')
  const images = await collectImages(opts.pages)

  const embedder = new PdfImageEmbedder(pdf)
  const renderer = new VectorPageRenderer(
    pdf,
    fonts,
    embedder,
    { text: createBrowserTextIo(), images, pixelScale: opts.pixelScale ?? 2 },
    opts.designWidth,
    opts.designHeight,
  )

  // 3. pages (the tree object is reserved so pages can /Parent it)
  const pagesTree = pdf.reserveObject()
  const pageObjects: number[] = []
  for (let i = 0; i < n; i++) {
    opts.onProgress?.(0.26 + (0.62 * i) / n, `Rendering page ${i + 1} of ${n}…`)
    const { ops, resources } = await renderer.renderPage(opts.pages[i])
    const content = pdf.addStreamObject('', ops)
    pageObjects.push(
      pdf.addObject(
        `<< /Type /Page /Parent ${pdf.ref(pagesTree)} /MediaBox [0 0 ${opts.designWidth} ${opts.designHeight}] /Resources ${resources} /Contents ${pdf.ref(content)} >>`,
      ),
    )
  }
  pdf.defineObject(
    pagesTree,
    `<< /Type /Pages /Kids [${pageObjects.map((p) => pdf.ref(p)).join(' ')}] /Count ${n} >>`,
  )

  // 4. catalog + info
  const catalog = pdf.addObject(`<< /Type /Catalog /Pages ${pdf.ref(pagesTree)} >>`)
  const info = pdf.addObject(
    `<< /Producer (Canvix) /Title ${pdfTextString(opts.title ?? 'Canvix design')} >>`,
  )

  opts.onProgress?.(0.95, 'Writing PDF…')
  const bytes = pdf.finalize(catalog, info)
  opts.onProgress?.(1, 'Done')
  return { blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }), pages: n, bytes: bytes.length }
}

/** Trigger the browser download of an exported PDF. */
export function downloadPdf(result: PdfExportResult, filename: string): void {
  const url = URL.createObjectURL(result.blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
