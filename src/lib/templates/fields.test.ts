// Unit tests for template fields (v0.17 Wave 2) — substitution purity,
// marker scanning, CSV parsing and row mapping.

import { describe, it, expect } from 'vitest'
import {
  validFields,
  extractFieldKeys,
  fillTemplateFields,
  parseCsv,
  csvToFieldRows,
} from './fields'
import { createPage, createTextElement, type PageData } from '../types'

function pageWith(texts: string[]): PageData {
  const page = createPage()
  page.elements = texts.map((t, i) =>
    createTextElement({ id: `t${i}`, x: 40, y: 40 + i * 60, width: 400, text: t })
  )
  return page
}

describe('template fields (v0.17 Wave 2)', () => {
  it('validates field declarations', () => {
    expect(validFields([{ key: 'name', label: 'Name', example: 'Ada' }])).toEqual([
      { key: 'name', label: 'Name', example: 'Ada' },
    ])
    expect(validFields([])).toBeNull()
    expect(validFields('nope')).toBeNull()
    expect(validFields([{ key: 'UPPER', label: 'x', example: '' }])).toBeNull()
    expect(validFields([{ key: 'ok', label: 'x', example: '' }, { key: 'ok', label: 'y', example: '' }])).toBeNull()
    expect(validFields([{ key: 'ok', label: 'x'.repeat(61), example: '' }])).toBeNull()
    expect(
      validFields(Array.from({ length: 25 }, (_, i) => ({ key: `f${i}`, label: `F${i}`, example: '' })))
    ).toBeNull()
  })

  it('extracts unique marker keys from a document', () => {
    const pages = [pageWith(['Hello {{name}}!', '{{  title  }}', 'no markers', '{{name}} again'])]
    expect(extractFieldKeys(pages).sort()).toEqual(['name', 'title'])
  })

  it('substitutes values case-insensitively and stays pure', () => {
    const pages = [pageWith(['Dear {{name}},', 'You won {{prize}}!'])]
    const filled = fillTemplateFields(pages, { Name: 'Ada', prize: 'a trophy' })
    expect((filled[0].elements[0] as { text: string }).text).toBe('Dear Ada,')
    expect((filled[0].elements[1] as { text: string }).text).toBe('You won a trophy!')
    // original untouched
    expect((pages[0].elements[0] as { text: string }).text).toBe('Dear {{name}},')
  })

  it('keeps unmatched markers visible and drops oversized values', () => {
    const pages = [pageWith(['{{name}} — {{email}}'])]
    const filled = fillTemplateFields(pages, { email: 'x'.repeat(501) })
    expect((filled[0].elements[0] as { text: string }).text).toBe('{{name}} — {{email}}')
  })

  it('supports multiline values', () => {
    const pages = [pageWith(['{{address}}'])]
    const filled = fillTemplateFields(pages, { address: 'Line 1\nLine 2' })
    expect((filled[0].elements[0] as { text: string }).text).toBe('Line 1\nLine 2')
  })

  it('parses RFC-4180 CSV (quotes, escaped quotes, CRLF)', () => {
    const csv = 'name,prize\n"Ada, Lovelace","a ""big"" trophy"\r\nGrace,notebook\n'
    const rows = parseCsv(csv)
    expect(rows).toEqual([
      ['name', 'prize'],
      ['Ada, Lovelace', 'a "big" trophy'],
      ['Grace', 'notebook'],
    ])
  })

  it('drops blank lines and enforces hard caps', () => {
    expect(parseCsv('a,b\n\n\n1,2\n')).toEqual([['a', 'b'], ['1', '2']])
    expect(() => parseCsv('a\n'.repeat(502))).toThrow(/500 rows/)
  })

  it('maps CSV rows onto field keys and reports missing columns', () => {
    const csv = [
      ['Name', 'Email'],
      ['Ada', 'ada@example.com'],
      ['Grace', 'grace@example.com'],
    ]
    const { rows, missing } = csvToFieldRows(csv, ['name', 'email', 'title'])
    expect(missing).toEqual(['title'])
    expect(rows).toEqual([
      { name: 'Ada', email: 'ada@example.com' },
      { name: 'Grace', email: 'grace@example.com' },
    ])
  })
})
