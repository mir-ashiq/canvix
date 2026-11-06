import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { PageData } from '@/lib/types'
import { createChartElement, createShapeElement, createTableElement, createTextElement } from '@/lib/types'
import { exportDesignToPdf } from '@/lib/pdf-export'
import { faceKey } from '@/lib/pdf/fonts'

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL('../../tests/fixtures/fonts/' + name, import.meta.url)))

const latin1 = (bytes: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return s
}

const page = (elements: unknown[]): PageData =>
  ({ id: 'p1', background: { type: 'solid', color: '#FFFFFF' }, elements }) as unknown as PageData

describe('exportDesignToPdf (node — std14 ladder offline)', () => {
  it('builds a multi-page PDF with real text ops and a valid skeleton', async () => {
    const text = createTextElement({ x: 20, y: 30, width: 500, text: 'Selectable résumé text', align: 'left', fontFamily: 'Poppins' })
    const shape = createShapeElement('rect', { x: 0, y: 0, width: 600, height: 400, fill: '#00C4CC', cornerRadius: 0 })
    const table = createTableElement({ x: 20, y: 200, rows: 2, cols: 2, cells: [{ text: 'H1' }, { text: 'H2' }, { text: 'x' }, { text: 'y' }] })
    const result = await exportDesignToPdf({
      designWidth: 600,
      designHeight: 400,
      pages: [page([shape, text, table]), page([createChartElement('bar', { x: 10, y: 10, width: 300, height: 200 })])],
      title: 'My Design',
      // node has no /api route → ladder falls to std14 (the documented offline path)
      fontLadderIo: { lookupUrl: async () => null },
    })
    expect(result.pages).toBe(2)
    expect(result.bytes).toBeGreaterThan(1000)
    const doc = latin1(new Uint8Array(await result.blob.arrayBuffer()))
    expect(doc.startsWith('%PDF-1.4')).toBe(true)
    expect(doc.trimEnd().endsWith('%%EOF')).toBe(true)
    // page tree with two kids
    expect(doc).toContain('/Type /Pages /Kids [')
    expect(doc).toContain('/Count 2')
    expect(doc).toMatch(/\/Type \/Page \/Parent \d+ 0 R \/MediaBox \[0 0 600 400\]/)
    // offline ladder → standard-14 Times/Helvetica with WinAnsi text ops
    expect(doc).toContain('/BaseFont /Helvetica')
    expect(doc).toContain('/Encoding /WinAnsiEncoding')
    // literal WinAnsi runs in the content streams
    expect(doc).toMatch(/\((.*?)\) Tj/)
    // real table + text runs made it into the content streams
    expect(doc).toContain('BT /F')
  })

  it('embeds subset fonts end-to-end through the injected ladder', async () => {
    const text = createTextElement({ x: 0, y: 0, width: 500, text: 'Hello é', align: 'left', fontFamily: 'Poppins' })
    const result = await exportDesignToPdf({
      designWidth: 500,
      designHeight: 300,
      pages: [page([text])],
      fontLadderIo: {
        lookupUrl: async (family, weight) => {
          expect(family).toBe('Poppins')
          expect(weight).toBe(400)
          return 'https://fonts.gstatic.com/s/poppins/v24/x.ttf'
        },
        fetchBytes: async () => fixture('poppins-400.ttf'),
      },
    })
    const doc = latin1(new Uint8Array(await result.blob.arrayBuffer()))
    expect(doc).toContain('/Subtype /Type0')
    expect(doc).toContain('/FontFile2')
    expect(doc).toContain('/ToUnicode')
    expect(doc).toContain('/CVX001+Poppins-Regular')
    // hex TJ runs (Identity-H glyph ids), not literal strings
    expect(doc).toMatch(/\[<[0-9a-f]{4}>/)
    void faceKey
  })

  it('throws on empty designs (fail fast, honest message)', async () => {
    await expect(
      exportDesignToPdf({ designWidth: 100, designHeight: 100, pages: [], fontLadderIo: { lookupUrl: async () => null } }),
    ).rejects.toThrow(/no pages/)
  })
})
