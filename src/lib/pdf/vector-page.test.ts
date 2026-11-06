import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { PageData } from '@/lib/types'
import { createChartElement, createShapeElement, createTextElement } from '@/lib/types'
import { PdfWriter } from './pdf-writer'
import { collectTextFaces, createFakeTextIo, PdfFontRegistry } from './text-ops'
import { PdfImageEmbedder, splitPlanes } from './image-embed'
import { rotationCm, svgPathToCmds, VectorPageRenderer } from './vector-page'

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL('../../../tests/fixtures/fonts/' + name, import.meta.url)))

const latin1 = (bytes: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return s
}

const poppinsIo = {
  lookupUrl: async () => 'https://fonts.gstatic.com/s/poppins/v24/x.ttf',
  fetchBytes: async () => fixture('poppins-400.ttf'),
}

async function buildRenderer(designW: number, designH: number, pages: PageData[]) {
  const pdf = new PdfWriter()
  const fonts = new PdfFontRegistry(pdf)
  await fonts.build(collectTextFaces(pages), poppinsIo)
  const embedder = new PdfImageEmbedder(pdf)
  const renderer = new VectorPageRenderer(pdf, fonts, embedder, { text: createFakeTextIo(0.5), images: new Map(), pixelScale: 2 }, designW, designH)
  return { pdf, fonts, renderer }
}

describe('svgPathToCmds', () => {
  it('parses M/L/H/V/Z', () => {
    const cmds = svgPathToCmds('M 10 20 L 30 40 H 50 V 5 Z')
    expect(cmds).toEqual([
      { c: 'M', x: 10, y: 20 },
      { c: 'L', x: 30, y: 40 },
      { c: 'L', x: 50, y: 40 },
      { c: 'L', x: 50, y: 5 },
      { c: 'Z' },
    ])
  })

  it('handles relative commands', () => {
    const cmds = svgPathToCmds('M 10 20 l 5 5 h 3 v -2')
    expect(cmds).toEqual([
      { c: 'M', x: 10, y: 20 },
      { c: 'L', x: 15, y: 25 },
      { c: 'L', x: 18, y: 25 },
      { c: 'L', x: 18, y: 23 },
    ])
  })

  it('converts quadratics to cubics and honours T reflection', () => {
    const cmds = svgPathToCmds('M 0 0 Q 10 0 20 10 T 40 10')
    expect(cmds).toHaveLength(3) // M + two C
    // first cubic control from Q(10,0): (6.67, 0)
    expect(cmds[1]).toMatchObject({ c: 'C', x1: 0 + (2 / 3) * 10, y1: 0 })
    // T reflects the implied control: (30, 20)
    expect(cmds[2]).toMatchObject({ c: 'C', x1: 20 + (2 / 3) * 10, y1: 10 + (2 / 3) * 10 })
  })

  it('approximates an arc with cubics landing on the endpoint', () => {
    const cmds = svgPathToCmds('M 0 0 A 50 50 0 0 1 100 0')
    const last = [...cmds].reverse().find((c) => c.c === 'C')
    expect(last?.x).toBeCloseTo(100, 3)
    expect(last?.y).toBeCloseTo(0, 3)
    expect(cmds.filter((c) => c.c === 'C').length).toBeGreaterThanOrEqual(2)
  })
})

describe('rotationCm', () => {
  it('matches the hand-derived quarter turn', () => {
    expect(rotationCm(90, 0, 0, 100)).toBe('0 -1 1 0 -100 100 cm')
    expect(rotationCm(0, 5, 5, 100)).toBe('')
  })
})

describe('VectorPageRenderer', () => {
  it('renders background, shapes, table, chart and text with resources', async () => {
    const text = createTextElement({ x: 40, y: 60, width: 400, text: 'Hello PDF', align: 'left', fontFamily: 'Poppins' })
    const shape = createShapeElement('rect', { x: 0, y: 0, width: 100, height: 80, fill: '#00C4CC', cornerRadius: 0 })
    const chart = createChartElement('bar', { x: 150, y: 200, width: 300, height: 200 })
    const page = {
      id: 'p1',
      background: { type: 'solid', color: '#FFFFFF' },
      elements: [shape, text, chart],
    } as unknown as PageData
    const { renderer } = await buildRenderer(500, 400, [page])
    const { ops, resources } = await renderer.renderPage(page)
    // background
    expect(ops).toContain('1 1 1 rg 0 0 500 400 re f')
    // rect fill (y-flipped: y=0..80 → page 400..320)
    expect(ops).toContain('0 0.7686 0.8 rg')
    expect(ops).toContain('0 400 m')
    expect(ops).toContain('100 320 l')
    expect(ops).toContain('h f')
    // real text ops for the text element
    expect(ops).toContain('BT /F1 32 Tf')
    // chart text present (labels ride the chart geometry)
    expect(ops.match(/BT \/F\d+ \d+(\.\d+)? Tf/g)?.length).toBeGreaterThanOrEqual(2)
    // resources carry fonts
    expect(resources).toContain('/Font <<')
  })

  it('wraps rotated + semi-transparent elements', async () => {
    const shape = createShapeElement('rect', { x: 10, y: 10, width: 50, height: 50, fill: '#FF0000', rotation: 45, opacity: 0.5 })
    const page = { id: 'p', background: { type: 'solid', color: '#FFF' }, elements: [shape] } as unknown as PageData
    const { renderer } = await buildRenderer(200, 200, [page])
    const { ops, resources } = await renderer.renderPage(page)
    expect(ops).toContain('q /GS1 gs')
    expect(ops).toContain(rotationCm(45, 10, 10, 200))
    expect(resources).toContain('/ExtGState << /GS1')
  })

  it('emits gradient backgrounds as pattern shadings', async () => {
    const page = {
      id: 'p',
      background: { type: 'gradient', from: '#FF0000', to: '#0000FF', angle: 90 },
      elements: [],
    } as unknown as PageData
    const { pdf, renderer } = await buildRenderer(100, 100, [page])
    const { ops, resources } = await renderer.renderPage(page)
    expect(ops).toContain('/Pattern cs /P1 scn')
    expect(resources).toContain('/Pattern << /P1')
    // the pattern object carries the bbox-unit matrix with the y flip
    const doc = latin1(pdf.finalize(1))
    expect(doc).toContain('/Matrix [100 0 0 -100 0 100]')
    expect(doc).toContain('/ShadingType 2')
    expect(doc).toContain('/FunctionType 2')
  })

  it('omits raster-bound elements in node (no DOM strips) — never throws', async () => {
    const curved = createTextElement({ curve: 30, text: 'arc' })
    const page = { id: 'p', background: { type: 'solid', color: '#FFF' }, elements: [curved] } as unknown as PageData
    const { renderer } = await buildRenderer(300, 300, [page])
    const { ops } = await renderer.renderPage(page)
    expect(ops).not.toContain('BT')
  })
})

describe('PdfImageEmbedder', () => {
  it('splits RGBA into colour and alpha planes', () => {
    const rgba = new Uint8Array([
      255, 0, 0, 255,
      0, 255, 0, 128,
      0, 0, 255, 0,
      10, 20, 30, 255,
    ])
    const { rgb, alpha, hasAlpha } = splitPlanes(rgba)
    expect([...rgb]).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30])
    expect([...alpha]).toEqual([255, 128, 0, 255])
    expect(hasAlpha).toBe(true)
  })

  it('passes JPEG data URLs through as DCTDecode untouched', async () => {
    // minimal but structurally valid JPEG (SOI, APP0, SOF0 with 20×10, SOS, EOI)
    const bytes = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
      0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x0a, 0x00, 0x14, 0x01,
      0xff, 0xda, 0x00, 0x02,
      0x12, 0x34, 0x56,
      0xff, 0xd9,
    ])
    const b64 = Buffer.from(bytes).toString('base64')
    const pdf = new PdfWriter()
    const embedder = new PdfImageEmbedder(pdf)
    const img = await embedder.embedDataUrl(`data:image/jpeg;base64,${b64}`)
    expect(img).toMatchObject({ width: 20, height: 10 })
    const pages = pdf.addObject('<< /Type /Pages /Kids [] /Count 0 >>')
    const root = pdf.addObject(`<< /Type /Catalog /Pages ${pdf.ref(pages)} >>`)
    const doc = latin1(pdf.finalize(root))
    expect(doc).toContain('/Filter /DCTDecode')
    expect(doc).toContain('/Width 20 /Height 10')
    // the entropy bytes survive verbatim
    expect(doc).toContain('\u00124V')
  })

  it('flates canvas pixels with an SMask when alpha is present (round-trip)', async () => {
    const pdf = new PdfWriter()
    const embedder = new PdfImageEmbedder(pdf)
    const data = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 100])
    const img = await embedder.embedCanvas({ width: 2, height: 1, data })
    expect(img).toMatchObject({ width: 2, height: 1 })
    const pages = pdf.addObject('<< /Type /Pages /Kids [] /Count 0 >>')
    const root = pdf.addObject(`<< /Type /Catalog /Pages ${pdf.ref(pages)} >>`)
    const doc = latin1(pdf.finalize(root))
    expect(doc).toContain('/Filter /FlateDecode')
    expect(doc).toContain('/SMask')
    expect(doc).toContain('/ColorSpace /DeviceGray')

    // independent round-trip: find the SMask stream and inflate it
    const smaskAt = doc.indexOf('/ColorSpace /DeviceGray')
    const streamAt = doc.indexOf('stream\n', smaskAt) + 'stream\n'.length
    const endAt = doc.indexOf('\nendstream', streamAt)
    const zbytes = new Uint8Array(endAt - streamAt)
    for (let i = 0; i < zbytes.length; i++) zbytes[i] = doc.charCodeAt(streamAt + i)
    const inflated = new Uint8Array(
      await new Response(new Blob([zbytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer(),
    )
    expect([...inflated]).toEqual([255, 100])
  })

  it('places images with flips and y-flip', async () => {
    const pdf = new PdfWriter()
    const embedder = new PdfImageEmbedder(pdf)
    const img = { objNum: 7, width: 10, height: 5 }
    expect(embedder.imageOps(img, 10, 20, 30, 40, 500)).toBe('q 30 0 0 40 10 440 cm /Im7 Do Q')
    expect(embedder.imageOps(img, 10, 20, 30, 40, 500, true, false)).toBe('q -30 0 0 40 40 440 cm /Im7 Do Q')
    expect(embedder.imageOps(img, 10, 20, 30, 40, 500, false, true)).toBe('q 30 0 0 -40 10 480 cm /Im7 Do Q')
  })
})
