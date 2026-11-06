import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { TableElement, TextElement } from '@/lib/types'
import { createTextElement } from '@/lib/types'
import { faceKey } from './fonts'
import { PdfWriter } from './pdf-writer'
import {
  collectTextFaces,
  createFakeTextIo,
  drawTextElement,
  layoutTextElement,
  PdfFontRegistry,
  roundedRectOps,
  textElementIsRaster,
} from './text-ops'

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL('../../../tests/fixtures/fonts/' + name, import.meta.url)))

const latin1 = (bytes: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return s
}

const poppinsIo = {
  lookupUrl: async () => 'https://fonts.gstatic.com/s/poppins/v24/x.ttf',
  fetchBytes: async () => fixture('poppins-400.ttf'),
}

describe('layoutTextElement', () => {
  const io = createFakeTextIo(0.5)

  it('positions a single left-aligned line with the Konva baseline', () => {
    const el = createTextElement({ x: 10, y: 20, width: 300, text: 'Hello', align: 'left' })
    const runs = layoutTextElement(el, io)
    expect(runs).toHaveLength(1)
    // measure('Hello') = 5 × 32 × 0.5 = 80 < 300 → one line
    expect(runs[0].x).toBe(0)
    // baseline = (ascent − descent)/2 + lineHeight/2 with 0.8/0.2 fake metrics
    expect(runs[0].y).toBeCloseTo((32 * 0.8 - 32 * 0.2) / 2 + (32 * 1.25) / 2, 5)
    expect(runs[0].positions).toEqual([0, 16, 32, 48, 64])
  })

  it('wraps to a second line with lineHeight steps', () => {
    const el = createTextElement({ x: 0, y: 0, width: 40, text: 'aa bb', align: 'left' })
    const runs = layoutTextElement(el, io)
    expect(runs.map((r) => r.text)).toEqual(['aa', 'bb'])
    expect(runs[1].y - runs[0].y).toBeCloseTo(32 * 1.25, 5)
  })

  it('resolves rich span styles per run', () => {
    const el = createTextElement({
      x: 0, y: 0, width: 400, align: 'left',
      text: 'plainBOLD',
      spans: [{ text: 'plain' }, { text: 'BOLD', bold: true, color: '#FF0000' }],
    })
    const runs = layoutTextElement(el, io)
    expect(runs.map((r) => [r.text, r.bold, r.color])).toEqual([
      ['plain', false, '#1F2226'],
      ['BOLD', true, '#FF0000'],
    ])
  })
})

describe('textElementIsRaster', () => {
  it('routes curve/gradient/effects to the raster strip', () => {
    expect(textElementIsRaster(createTextElement({ curve: 30 }))).toBe(true)
    expect(textElementIsRaster(createTextElement({ curve: 1 }))).toBe(false)
    expect(textElementIsRaster(createTextElement({ fillGradient: { type: 'linear', from: '#FFF', to: '#000', angle: 90 } }))).toBe(true)
    expect(textElementIsRaster(createTextElement({ effect: 'shadow' }))).toBe(true)
    expect(textElementIsRaster(createTextElement({ effect: 'background' }))).toBe(false)
    expect(textElementIsRaster(createTextElement({}))).toBe(false)
  })
})

describe('collectTextFaces', () => {
  it('collects faces and codepoints across element types (raster text skipped)', () => {
    const textEl = createTextElement({
      x: 0, y: 0, width: 400, align: 'left', fontFamily: 'Poppins',
      text: 'plainBOLDé',
      spans: [{ text: 'plain' }, { text: 'BOLD', bold: true }, { text: 'é' }],
    })
    const curved = createTextElement({ curve: 30, text: 'curved ignored' })
    const table: TableElement = {
      type: 'table',
      id: 't1', x: 0, y: 0, width: 100, height: 60, rotation: 0, opacity: 1, visible: true,
      rows: 2, cols: 2, cells: [{ text: 'H1' }, { text: 'h2' }, { text: 'b', bold: true }, { text: '' }],
      colWidths: [50, 50], rowHeight: 30,
      borderColor: '#000', borderWidth: 1, headerFill: '#111', fill: '#FFF', fontSize: 12, fontFamily: 'Inter',
    } as unknown as TableElement
    const pages = [
      {
        elements: [
          textEl,
          curved,
          table,
          { type: 'embed', url: 'https://www.youtube.com/watch?v=x', title: 'My Video', x: 0, y: 0, width: 100, height: 100 },
          { type: 'group', children: [createTextElement({ text: 'inside', fontFamily: 'Lora', italic: true })] },
        ],
      },
    ]
    const faces = collectTextFaces(pages)
    const keys = [...faces.keys()].sort()
    expect(keys).toContain('Poppins|')
    expect(keys).toContain('Poppins|b')
    expect(keys).toContain('Inter|b')
    expect(keys).toContain('Inter|')
    expect(keys).toContain('Lora|i')
    // curved text contributed nothing
    expect([...faces.entries()].some(([, v]) => v.codepoints.has('u'.codePointAt(0)!))).toBe(false)
    // codepoints came through incl. the é span
    expect(faces.get('Poppins|')!.codepoints.has(0xe9)).toBe(true)
    expect(faces.get('Poppins|b')!.codepoints.has('B'.codePointAt(0)!)).toBe(true)
    // table header face is bold; body text noted under its own weight
    expect(faces.get('Inter|b')!.codepoints.has('1'.codePointAt(0)!)).toBe(true)
    expect(faces.get('Inter|b')!.codepoints.has('2'.codePointAt(0)!)).toBe(true) // 'h2' sits in the header row
    expect(faces.get('Inter|')!.codepoints.has('b'.codePointAt(0)!)).toBe(false) // bold cell → bold face
    // embed labels → Inter regular (host) + bold (title)
    expect(faces.get('Inter|')!.codepoints.has('Y'.codePointAt(0)!)).toBe(true) // YOUTUBE host (www stripped)
    expect(faces.get('Inter|b')!.codepoints.has('M'.codePointAt(0)!)).toBe(true) // My Video
  })
})

describe('PdfFontRegistry + drawing', () => {
  it('embeds a subset font and draws a positioned TJ run', async () => {
    const el = createTextElement({ x: 10, y: 100, width: 400, text: 'Hi', align: 'left', fontFamily: 'Poppins' })
    const notes = collectTextFaces([{ elements: [el] }])
    const pdf = new PdfWriter()
    const reg = new PdfFontRegistry(pdf)
    await reg.build(notes, poppinsIo)

    const entry = reg.get({ family: 'Poppins', bold: false, italic: false })
    expect(entry?.kind).toBe('ttf')

    const gH = entry!.kind === 'ttf' ? entry!.subset!.codepointToGid.get(0x48)! : 0
    const gI = entry!.kind === 'ttf' ? entry!.subset!.codepointToGid.get(0x69)! : 0

    const ops = reg.drawRun({
      x: 10, y: 100, pageH: 1080, text: 'Hi', fontFamily: 'Poppins',
      fontSize: 40, bold: false, italic: false, color: '#FF0000',
      positions: [0, 20], width: 45,
    })
    expect(ops).toContain('BT /F1 40 Tf 1 0 0 rg')
    expect(ops).toContain(`1 0 0 1 10 980 Tm`)
    expect(ops).toContain(`<${gH.toString(16).padStart(4, '0')}>`)
    // adjustment: pen after H = 10 + adv(H)·40/1000 vs next x = 30
    const sub = entry!.kind === 'ttf' ? entry!.subset! : null!
    const pen = 10 + (sub.advances[gH] * sub.scale * 40) / 1000
    const adj = Math.round((pen - 30) * 25)
    if (adj !== 0) expect(ops).toContain(`<${gH.toString(16).padStart(4, '0')}> ${adj} <`)
    else expect(ops).toContain(`<${gH.toString(16).padStart(4, '0')}> <`)
    void gI

    // document-level: the font objects land in the PDF
    const pages = pdf.addObject('<< /Type /Pages /Kids [] /Count 0 >>')
    const root = pdf.addObject(`<< /Type /Catalog /Pages ${pdf.ref(pages)} >>`)
    const bytes = pdf.finalize(root)
    const doc = latin1(bytes)
    expect(doc).toContain('/Subtype /Type0')
    expect(doc).toContain('/Encoding /Identity-H')
    expect(doc).toContain('/CIDToGIDMap /Identity')
    expect(doc).toContain('/FontFile2')
    expect(doc).toContain('beginbfchar')
    expect(doc).toContain('/CVX001+Poppins-Regular')
    const wMatch = /\/W \[0 \[([\d .]+)\]\]/.exec(doc)
    expect(wMatch).toBeTruthy()
    // consecutive-widths run form covering every subset glyph
    expect(wMatch![1].trim().split(' ').length).toBeGreaterThanOrEqual(2)
    expect(reg.resourcesDict()).toMatch(/^<< \/F1 \d+ 0 R >>$/)
  })

  it('falls back to std14 with WinAnsi escaping', async () => {
    const el = createTextElement({ x: 0, y: 0, width: 400, text: 'héllo — wörld', fontFamily: 'Lora' })
    const notes = collectTextFaces([{ elements: [el] }])
    const pdf = new PdfWriter()
    const reg = new PdfFontRegistry(pdf)
    await reg.build(notes, { lookupUrl: async () => null })

    const entry = reg.get({ family: 'Lora', bold: false, italic: false })
    expect(entry?.kind).toBe('std14')

    const ops = reg.drawRun({
      x: 5, y: 50, pageH: 500, text: 'héllo — wörld', fontFamily: 'Lora',
      fontSize: 20, bold: false, italic: false, color: '#000000', letterSpacing: 2,
    })
    expect(ops).toContain('BT /F1 20 Tf 0 0 0 rg 2 Tc')
    expect(ops).toContain('1 0 0 1 5 450 Tm (h\\351llo \\227 w\\366rld) Tj')

    const pages = pdf.addObject('<< /Type /Pages /Kids [] /Count 0 >>')
    const root = pdf.addObject(`<< /Type /Catalog /Pages ${pdf.ref(pages)} >>`)
    const doc = latin1(pdf.finalize(root))
    expect(doc).toContain('/BaseFont /Times-Roman') // serif family → Times
    expect(doc).toContain('/Encoding /WinAnsiEncoding')
  })

  it('draws underlines and strikes with Konva geometry', async () => {
    const el = createTextElement({ x: 0, y: 0, width: 400, text: 'U', fontFamily: 'Poppins' })
    const notes = collectTextFaces([{ elements: [el] }])
    const pdf = new PdfWriter()
    const reg = new PdfFontRegistry(pdf)
    await reg.build(notes, poppinsIo)
    const ops = reg.drawRun({
      x: 10, y: 100, pageH: 1080, text: 'U', fontFamily: 'Poppins',
      fontSize: 30, bold: false, italic: false, color: '#123456',
      underline: true, strike: true, width: 15,
    })
    // underline: y = 100 + round(30/4) = 108, th = 2 → rect y = 1080 − 108 − 1
    expect(ops).toMatch(/0\.0706 0\.2039 0\.3373 rg 10 971 15 2 re f/)
    // strike: y = 100 − 8 = 92 → rect y = 1080 − 92 − 1
    expect(ops).toMatch(/10 987 15 2 re f/)
  })
})

describe('drawTextElement', () => {
  const io = createFakeTextIo(0.5)

  it('returns null for raster-bound text', async () => {
    const pdf = new PdfWriter()
    const reg = new PdfFontRegistry(pdf)
    await reg.build(collectTextFaces([{ elements: [] }]), poppinsIo)
    expect(drawTextElement(createTextElement({ curve: 25 }), 1080, reg, io)).toBeNull()
    expect(drawTextElement(createTextElement({ effect: 'lift' }), 1080, reg, io)).toBeNull()
  })

  it('emits runs and honours the coverage gate', async () => {
    const good = createTextElement({ x: 10, y: 20, width: 400, text: 'Hello', align: 'left', fontFamily: 'Poppins' })
    const cjk = createTextElement({ x: 10, y: 20, width: 400, text: '中文文本', align: 'left', fontFamily: 'Poppins' })
    const pages = [{ elements: [good, cjk] }]
    const notes = collectTextFaces(pages)
    const pdf = new PdfWriter()
    const reg = new PdfFontRegistry(pdf)
    await reg.build(notes, poppinsIo)
    expect(drawTextElement(good, 1080, reg, io)).toContain('BT /F1')
    // Poppins has no CJK glyphs → the whole element rasterizes instead of tofu
    expect(drawTextElement(cjk, 1080, reg, io)).toBeNull()
  })

  it('renders the background effect block behind the runs', async () => {
    const el = createTextElement({
      x: 0, y: 0, width: 200, text: 'bg', align: 'left', fontFamily: 'Poppins',
      effect: 'background', effectBackground: '#EEEEEE',
    })
    const pdf = new PdfWriter()
    const reg = new PdfFontRegistry(pdf)
    await reg.build(collectTextFaces([{ elements: [el] }]), poppinsIo)
    const ops = drawTextElement(el, 1000, reg, io)
    expect(ops).toContain('0.9333 0.9333 0.9333 rg') // #EEEEEE
    expect(ops).toContain(' c\n') // bézier corners
    expect(ops).toContain('BT /F1')
  })
})

describe('roundedRectOps', () => {
  it('degenerates to a plain rect at r=0', () => {
    expect(roundedRectOps(10, 20, 30, 40, 0, '#FF0000', 1000)).toBe('1 0 0 rg 10 940 30 40 re f')
  })

  it('emits four bézier corners for r>0', () => {
    const ops = roundedRectOps(0, 0, 100, 50, 10, '#00FF00', 1000)
    expect((ops.match(/ c(?:\n|$)/g) ?? []).length).toBe(4)
    expect(ops).toContain('h f')
  })
})
