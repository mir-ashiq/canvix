// ─────────────────────────────────────────────────────────────
// Canvix template fields (v0.17 Wave 2) — the "smart template"
// engine. Templates may declare fields; text elements carry
// {{key}} markers. At fill time the markers are substituted with
// caller values (one design per row of values).
//
//   · TemplateField  — declaration on a template
//   · fillTemplateFields(pages, values) → new pages (pure)
//   · extractFieldKeys(pages)            — scan markers
//   · parseCsv(text)                     — RFC-4180-ish CSV → rows
// Used by the editor fill dialog, the dashboard CSV bulk flow and
// the REST fill API (/api/templates/[slug]/fill).
// ─────────────────────────────────────────────────────────────

import type { PageData } from '../types'

export interface TemplateField {
  key: string
  label: string
  example: string
}

const KEY_RE = /^[a-z][a-z0-9_]{1,30}$/
const MARKER_RE = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/gi

/** validate a field declaration list (API input guard) */
export function validFields(input: unknown): TemplateField[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > 24) return null
  const seen = new Set<string>()
  const out: TemplateField[] = []
  for (const raw of input) {
    if (typeof raw !== 'object' || raw === null) return null
    const { key, label, example } = raw as Record<string, unknown>
    if (typeof key !== 'string' || !KEY_RE.test(key) || seen.has(key)) return null
    if (typeof label !== 'string' || !label.length || label.length > 60) return null
    if (typeof example !== 'string' || example.length > 200) return null
    seen.add(key)
    out.push({ key, label, example })
  }
  return out
}

/** every {{key}} marker used anywhere in the document (unique, lowercase) */
export function extractFieldKeys(pages: PageData[]): string[] {
  const keys = new Set<string>()
  for (const page of pages) {
    for (const el of page.elements ?? []) {
      if (el.type !== 'text') continue
      const text = (el as { text?: string }).text ?? ''
      for (const m of text.matchAll(MARKER_RE)) keys.add(m[1].toLowerCase())
    }
  }
  return [...keys]
}

/** one substitution pass over text runs — supports \n in values */
function substituteText(text: string, values: Record<string, string>): string {
  return text.replace(MARKER_RE, (_m, key: string) => {
    const v = values[key.toLowerCase()]
    return v !== undefined ? v : `{{${key}}}`
  })
}

/**
 * Fill a template document with one row of values. Pure: returns a
 * fresh deep-copied pages array, never mutates the template. Markers
 * with no matching value are left in place (visible in the editor, so
 * the user notices) — except empty-string values, which clear them.
 */
export function fillTemplateFields(
  pages: PageData[],
  values: Record<string, unknown>
): PageData[] {
  const clean: Record<string, string> = {}
  for (const [k, v] of Object.entries(values ?? {})) {
    if (typeof v === 'string' && v.length <= 500) clean[k.toLowerCase()] = v
  }
  return pages.map((page) => ({
    ...page,
    elements: (page.elements ?? []).map((el) => {
      if (el.type !== 'text') return el
      const t = el as typeof el & { text?: string }
      if (!t.text || !t.text.includes('{{')) return el
      return { ...el, text: substituteText(t.text, clean) }
    }),
  }))
}

/**
 * RFC-4180-ish CSV parser: double-quote wrapping, "" escapes, CRLF or
 * LF line endings. Returns rows of cells; the first row is the header.
 * Hard caps: 2 MB input, 500 rows, 40 columns (the bulk-fill UI only
 * ever needs a handful).
 */
export function parseCsv(input: string): string[][] {
  if (input.length > 2_000_000) throw new Error('CSV too large (2 MB max).')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  const push = () => { row.push(cell); cell = '' }
  const endRow = () => { push(); rows.push(row); row = [] }
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') { cell += '"'; i++ }
        else inQuotes = false
      } else cell += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      push()
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++
      // skip fully empty trailing lines
      if (cell === '' && row.length === 0 && rows.length > 0 && i === input.length - 1) continue
      endRow()
    } else {
      cell += ch
    }
    if (rows.length > 500) throw new Error('CSV exceeds 500 rows.')
    if (row.length > 40) throw new Error('CSV exceeds 40 columns.')
  }
  if (cell !== '' || row.length > 0) endRow()
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/** map a parsed CSV (header row + data rows) onto field values */
export function csvToFieldRows(
  csv: string[][],
  fieldKeys: string[]
): { rows: Record<string, string>[]; missing: string[] } {
  if (!csv.length) return { rows: [], missing: [...fieldKeys] }
  const header = csv[0].map((h) => h.trim().toLowerCase())
  const keys = fieldKeys.map((k) => k.toLowerCase())
  const missing = keys.filter((k) => !header.includes(k))
  const rows: Record<string, string>[] = []
  for (const dataRow of csv.slice(1)) {
    const values: Record<string, string> = {}
    header.forEach((h, i) => {
      if (keys.includes(h) && dataRow[i] !== undefined) values[h] = dataRow[i]
    })
    // only keep rows that actually carry at least one field value
    if (Object.keys(values).length) rows.push(values)
  }
  return { rows, missing }
}
