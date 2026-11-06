import { describe, expect, it } from 'vitest'
import {
  PdfWriter,
  parseJpegSize,
  pdfAlpha,
  pdfEscapeLiteral,
  pdfNum,
  pdfRgb,
  pdfTextString,
} from './pdf-writer'

// ── independent re-parser (shares NO code with the writer) ──
// Decodes the document as latin-1 so byte offsets == string
// indices, walks the classic xref table, and verifies every
// structural claim the writer makes.

function latin1(bytes: Uint8Array): string {
  let s = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode(...bytes.subarray(i, i + CH))
  }
  return s
}

interface ParsedDoc {
  text: string
  size: number
  root: number
  info: number | null
  offsets: number[]
  objectAt(num: number): string
}

function reparse(doc: Uint8Array): ParsedDoc {
  const text = latin1(doc)
  const tail = text.slice(-64)
  const m = /startxref\n(\d+)\n%%EOF\n$/.exec(tail)
  expect(m, 'ends with startxref/%%EOF').toBeTruthy()
  const xrefOffset = Number(m![1])

  expect(text.startsWith('%PDF-1.4\n%')).toBe(true)
  // binary comment bytes survive
  expect(doc[9]).toBe(0x25) // '%'
  expect(doc[10]).toBe(0xe2)
  expect(doc[13]).toBe(0xd3)

  const header = /^xref\n0 (\d+)\n/.exec(text.slice(xrefOffset))
  expect(header, 'xref at startxref offset').toBeTruthy()
  const count = Number(header![1])

  // entries: 20 bytes each after the two header lines
  const entriesStart = xrefOffset + header![0].length
  const offsets: number[] = []
  for (let i = 0; i < count; i++) {
    const entry = text.slice(entriesStart + i * 20, entriesStart + (i + 1) * 20)
    if (i === 0) {
      expect(entry).toBe('0000000000 65535 f \n')
      continue
    }
    expect(entry).toMatch(/^\d{10} 00000 n \n$/)
    offsets.push(Number(entry.slice(0, 10)))
  }

  // every xref offset must land exactly on its "n 0 obj"
  offsets.forEach((off, idx) => {
    expect(text.slice(off, off + String(idx + 1).length + 6)).toBe(`${idx + 1} 0 obj`)
  })

  const trailer = /trailer\n<< \/Size \d+ \/Root (\d+) 0 R( \/Info (\d+) 0 R)? >>\n/.exec(
    text.slice(xrefOffset),
  )
  expect(trailer, 'trailer with /Root').toBeTruthy()

  return {
    text,
    size: count,
    root: Number(trailer![1]),
    info: trailer![3] ? Number(trailer![3]) : null,
    offsets,
    objectAt: (num: number) => {
      const start = offsets[num - 1]
      const end = num < offsets.length ? offsets[num] : text.indexOf('trailer\n', xrefOffset - 1)
      return text.slice(start, end)
    },
  }
}

describe('PdfWriter', () => {
  it('serializes a minimal one-page document with an exact xref', () => {
    const pdf = new PdfWriter()
    const content = pdf.addStreamObject('', '1 0 0 RG 10 10 100 100 re S\n')
    const page = pdf.addObject(`<< /Type /Page /Parent PARENT /MediaBox [0 0 1080 1080] /Contents ${pdf.ref(content)} >>`)
    const pages = pdf.addObject(`<< /Type /Pages /Kids [${pdf.ref(page)}] /Count 1 >>`)
    const root = pdf.addObject(`<< /Type /Catalog /Pages ${pdf.ref(pages)} >>`)
    const bytes = pdf.finalize(root)

    const parsed = reparse(bytes)
    expect(parsed.size).toBe(5)
    expect(parsed.root).toBe(4)
    expect(parsed.objectAt(1)).toContain('/Length 28')
    expect(parsed.objectAt(1)).toContain('stream\n1 0 0 RG 10 10 100 100 re S\n\nendstream')
    expect(parsed.objectAt(2)).toContain('/MediaBox [0 0 1080 1080]')
    // no /Info when none given
    expect(parsed.info).toBeNull()
  })

  it('round-trips binary stream bytes untouched (FontFile2 contract)', () => {
    const fontBytes = new Uint8Array(512)
    for (let i = 0; i < fontBytes.length; i++) fontBytes[i] = (i * 37 + 11) & 0xff
    fontBytes[0] = 0x00
    fontBytes[1] = 0x01 // TTF magic
    fontBytes[2] = 0x00
    fontBytes[3] = 0x00

    const pdf = new PdfWriter()
    const font = pdf.addStreamObject('/Length1 512', fontBytes)
    const pages = pdf.addObject('<< /Type /Pages /Kids [] /Count 0 >>')
    const root = pdf.addObject(`<< /Type /Catalog /Pages ${pdf.ref(pages)} >>`)
    const bytes = pdf.finalize(root)

    const parsed = reparse(bytes)
    const obj = parsed.objectAt(1)
    expect(obj).toContain('/Length1 512 /Length 512')
    const s = obj.indexOf('stream\n') + 'stream\n'.length
    const e = obj.indexOf('\nendstream')
    expect(e - s).toBe(512)
    for (let i = 0; i < 512; i++) {
      expect(obj.charCodeAt(s + i)).toBe(fontBytes[i])
    }
  })

  it('supports multiple pages and an /Info object with unicode titles', () => {
    const pdf = new PdfWriter()
    const c1 = pdf.addStreamObject('', 'q Q\n')
    const c2 = pdf.addStreamObject('', 'q Q\n')
    const p1 = pdf.addObject(`<< /Type /Page /MediaBox [0 0 500 500] /Contents ${pdf.ref(c1)} >>`)
    const p2 = pdf.addObject(`<< /Type /Page /MediaBox [0 0 500 500] /Contents ${pdf.ref(c2)} >>`)
    const pages = pdf.addObject(`<< /Type /Pages /Kids [${pdf.ref(p1)} ${pdf.ref(p2)}] /Count 2 >>`)
    const root = pdf.addObject(`<< /Type /Catalog /Pages ${pdf.ref(pages)} >>`)
    const info = pdf.addObject(`<< /Producer (Canvix) /Title ${pdfTextString('déjà — ✓')} >>`)
    const bytes = pdf.finalize(root, info)

    const parsed = reparse(bytes)
    expect(parsed.info).toBe(7)
    const infoObj = parsed.objectAt(7)
    expect(infoObj).toContain('/Producer (Canvix)')
    // non-ASCII title → UTF-16BE hex string with BOM
    expect(infoObj).toContain('/Title <FEFF006400E9006A00E00020201400202713>')
  })

  it('formats numbers without exponents or trailing zeros', () => {
    expect(pdfNum(0.1 + 0.2)).toBe('0.3')
    expect(pdfNum(-0)).toBe('0')
    expect(pdfNum(3)).toBe('3')
    expect(pdfNum(1080)).toBe('1080')
    expect(pdfNum(1 / 3)).toBe('0.3333')
    expect(pdfNum(NaN)).toBe('0')
    expect(pdfNum(Infinity)).toBe('0')
    expect(pdfNum(1e18)).toBe('1000000000000000')
  })

  it('escapes literal strings', () => {
    expect(pdfEscapeLiteral('a(b)c\\d')).toBe('a\\(b\\)c\\\\d')
    expect(pdfEscapeLiteral('café')).toBe('caf\\351')
    expect(pdfEscapeLiteral('\n')).toBe('\\012')
  })
})

describe('parseJpegSize', () => {
  it('reads SOF0 dimensions past APP segments', () => {
    const bytes = new Uint8Array([
      0xff, 0xd8, // SOI
      0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, // APP0 (len 4)
      0xff, 0xdb, 0x00, 0x02, // DQT (len 2)
      0xff, 0xc0, 0x00, 0x0b, // SOF0 (len 11)
      0x08, // precision
      0x01, 0x2c, // height 300
      0x02, 0xd0, // width 720
      0x03, // components
    ])
    expect(parseJpegSize(bytes)).toEqual({ width: 720, height: 300 })
  })

  it('accepts SOF2 (progressive) too', () => {
    const bytes = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xc2, 0x00, 0x0b, 0x08, 0x00, 0x10, 0x00, 0x20, 0x01,
    ])
    expect(parseJpegSize(bytes)).toEqual({ width: 32, height: 16 })
  })

  it('rejects non-JPEG, truncated and SOS-first streams', () => {
    expect(parseJpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
    expect(parseJpegSize(new Uint8Array([0xff, 0xd8]))).toBeNull()
    // SOS before any SOF → malformed for our purposes
    expect(parseJpegSize(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]))).toBeNull()
  })
})

describe('colour helpers', () => {
  it('formats rgb operands', () => {
    expect(pdfRgb('#FF0000')).toBe('1 0 0')
    expect(pdfRgb('#00c4cc')).toBe('0 0.7686 0.8')
    expect(pdfRgb('#abc')).toBe('0.6667 0.7333 0.8')
    expect(pdfRgb('#00000080')).toBe('0 0 0')
    expect(pdfRgb('nonsense')).toBe('0 0 0')
    expect(pdfRgb('white')).toBe('1 1 1')
  })

  it('extracts alpha from #rrggbbaa', () => {
    expect(pdfAlpha('#FF000080')).toBeCloseTo(0.502, 2)
    expect(pdfAlpha('#FF0000')).toBe(1)
    expect(pdfAlpha('junk')).toBe(1)
  })
})
