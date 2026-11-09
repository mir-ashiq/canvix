import { describe, expect, it, vi } from 'vitest'
import type { PageData, AnyElement } from '@/lib/types'
import { exportDesignToPdf } from '@/lib/pdf-export'

// node has no Image() — the video-export preloader is irrelevant for
// these vector-path tests (the embedder's JPEG passthrough is the code
// under test), so it is stubbed to an empty map.
vi.mock('@/lib/video-export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/video-export')>()
  return { ...actual, collectImages: async () => new Map<string, HTMLImageElement>() }
})

// Node-side Wave 3 checks, same discipline as pdf-export.test.ts:
// the offline font ladder (std14) keeps everything deterministic.

// an 8×8 solid-red JPEG (844 bytes) — the only format the node-side
// embedder passes through byte-for-byte (PNG needs a canvas)
const RED_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDmqKKK8w/Qz//Z'

const page = (elements: AnyElement[], over: Partial<PageData> = {}): PageData =>
  ({ id: 'p1', background: { type: 'solid', color: '#FFFFFF' }, elements, ...over }) as unknown as PageData

function el(over: Record<string, unknown>): AnyElement {
  return {
    id: 'e1',
    type: 'rect',
    x: 100,
    y: 100,
    width: 200,
    height: 200,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    fill: '#00C4CC',
    stroke: 'transparent',
    strokeWidth: 0,
    cornerRadius: 0,
    ...over,
  } as AnyElement
}

async function pdfString(pages: PageData[], designWidth = 600, designHeight = 400): Promise<string> {
  const result = await exportDesignToPdf({
    designWidth,
    designHeight,
    pages,
    title: 'Wave 3',
    fontLadderIo: { lookupUrl: async () => null },
  })
  const buf = new Uint8Array(await result.blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return s
}

describe('exportDesignToPdf — Wave 3 features (node, std14 ladder)', () => {
  it('polygon renders as a full-box vector path (6 sides → 6 line segments)', async () => {
    const doc = await pdfString([page([el({ type: 'polygon', sides: 6 })])])
    // one moveto + five lineto + close (h), then the fill — a hexagon
    // is exactly 6 vertices = 1 m + 5 l + h
    const lines = doc.match(/ l\n/g)?.length ?? 0
    expect(lines).toBe(5)
    expect(doc).toMatch(/m\n[\d.]+ [\d.]+ l/)
  })

  it('star honours numPoints (9 → 18 segments) and fills the element box', async () => {
    const doc = await pdfString([page([el({ type: 'star', numPoints: 9, innerRatio: 0.4 })])])
    const lines = doc.match(/ l\n/g)?.length ?? 0
    expect(lines).toBe(17) // 18 vertices = 1 m + 17 l + h
    // the top outer vertex touches the box top edge: y-down 100 →
    // page space (designH - y) = 400 - 100 = 300, x = 100 + 200/2 = 200
    expect(doc).toContain('200 300 m')
  })

  it('per-page size override drives each MediaBox independently', async () => {
    const doc = await pdfString(
      [page([], {}), page([], { width: 500, height: 250 })],
      600,
      400,
    )
    expect(doc).toContain('/MediaBox [0 0 600 400]')
    expect(doc).toContain('/MediaBox [0 0 500 250]')
    // the second page's background covers ITS box (5 pt-high box, not 400)
    expect(doc).toMatch(/0 0 500 250 re f/)
  })

  it('per-page size out of range falls back to the design size', async () => {
    const doc = await pdfString([page([], { width: 999999, height: -5 })], 600, 400)
    expect(doc).not.toContain('/MediaBox [0 0 999999 -5]')
    expect(doc).toContain('/MediaBox [0 0 600 400]')
  })

  it('image mask → vector clip (W n) around the image XObject paint', async () => {
    const doc = await pdfString([
      page([el({ type: 'image', src: `data:image/jpeg;base64,${RED_JPEG_B64}`, maskShape: 'circle' })]),
    ])
    // the image embedded as a JPEG passthrough XObject
    expect(doc).toContain('/Subtype /Image')
    expect(doc).toContain('/Filter /DCTDecode')
    // a clip path wraps the paint: q … W n … cm /ImN Do Q
    expect(doc).toMatch(/q [\d.\s]+ m[\s\S]*?W n[\s\S]*?cm \/Im\d+ Do Q/)
    // the circle mask is a 72-segment polygon (72 vertices = 1 m + 71 l
    // + h), not a 4-line rect
    const clipLines = doc.match(/ l\n/g)?.length ?? 0
    expect(clipLines).toBe(71)
  })

  it('image without mask keeps the plain paint (no W n clip)', async () => {
    const doc = await pdfString([
      page([el({ type: 'image', src: `data:image/jpeg;base64,${RED_JPEG_B64}` })]),
    ])
    expect(doc).toContain('/Im')
    expect(doc).not.toContain('W n')
  })

  it('auto-fit shrinks the Tf size below the authored one', async () => {
    const many = Array.from({ length: 30 }, (_, i) => `line of text number ${i}`).join('\n')
    const doc = await pdfString([
      page([
        el({
          type: 'text',
          text: many,
          autoFit: true,
          fontSize: 60,
          fontFamily: 'Inter',
          fill: '#000000',
          align: 'left',
          lineHeight: 1.25,
          letterSpacing: 0,
          width: 300,
          height: 120,
        }),
      ]),
    ])
    const sizes = [...doc.matchAll(/BT \/F\d+ ([\d.]+) Tf/g)].map((m) => Number(m[1]))
    expect(sizes.length).toBeGreaterThan(0)
    for (const size of sizes) {
      expect(size).toBeLessThan(60)
      expect(size).toBeGreaterThanOrEqual(6)
    }
  })

  it('list text and rtl text fall to the raster strip (documented v1 approximation)', async () => {
    // in node the strip has no canvas either → the element is dropped
    // from the vector page; the contract under test is that the vector
    // text path never sees list/rtl runs (no BT text ops for them)
    const doc = await pdfString([
      page([
        el({
          type: 'text',
          text: 'one\ntwo',
          listStyle: 'bullet',
          fontSize: 24,
          fontFamily: 'Inter',
          fill: '#000000',
          align: 'left',
          lineHeight: 1.2,
          letterSpacing: 0,
          width: 300,
          height: 100,
        }),
      ]),
    ])
    expect(doc).not.toContain('BT /F')
  })
})
