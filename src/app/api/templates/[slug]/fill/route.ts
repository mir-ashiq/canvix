import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dbErrorResponse } from '@/lib/db-errors'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { getSessionUser } from '@/lib/auth/session'
import { anonKeyHash, readAnonToken, newAnonToken, setAnonCookie } from '@/lib/auth/anon'
import { withLogging } from '@/lib/observability'
import { fillTemplateFields, parseCsv, csvToFieldRows, extractFieldKeys, validFields, type TemplateField } from '@/lib/templates/fields'
import type { PageData } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 30

// ── v0.17 (Wave 2): REST template fill — the agent/API surface ──
//
//   POST /api/templates/{slug}/fill
//
//   Body (any of):
//     · JSON  { "values": { "key": "value", … } }        — single render
//     · JSON  { "rows": [ { … }, { … } ] }               — batch (≤ 100)
//     · text/csv  (raw body or multipart "csv" file)      — header row
//       must name the field keys; ≤ 500 rows parsed, ≤ 100 rendered
//
//   Query:
//     · ?persist=1  — also create a design per row for the caller
//       (session cookie or anon attribution — same rules as the
//       dashboard). Default: render only, return documents.
//
//   Response: { template, generated: [{ name, width, height, pages }],
//               created?: [{ id, name }] }
//
//   The same engine powers the editor fill dialog and the dashboard
//   CSV bulk flow — one substitution implementation, three surfaces.

const MAX_RENDER = 100

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

/** read the request body into up to MAX_RENDER value rows */
async function readValueRows(
  req: NextRequest,
  fieldKeys: string[]
): Promise<{ rows: Record<string, string>[]; error?: undefined } | { rows?: undefined; error: string }> {
  const contentType = req.headers.get('content-type') ?? ''

  // multipart: a single uploaded csv file
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData().catch(() => null)
    const file = form?.get('csv')
    if (!(file instanceof File)) return { error: 'Attach the CSV as a "csv" form field.' }
    if (file.size > 2_000_000) return { error: 'CSV exceeds 2 MB.' }
    const text = await file.text()
    try {
      const { rows, missing } = csvToFieldRows(parseCsv(text), fieldKeys)
      if (!rows.length) return { error: 'CSV has no data rows with matching columns.' }
      return { rows: rows.slice(0, MAX_RENDER) }
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'CSV parse failed.' }
    }
  }

  // raw text/csv body
  if (contentType.includes('text/csv')) {
    const text = await req.text()
    if (text.length > 2_000_000) return { error: 'CSV exceeds 2 MB.' }
    try {
      const { rows } = csvToFieldRows(parseCsv(text), fieldKeys)
      if (!rows.length) return { error: 'CSV has no data rows with matching columns.' }
      return { rows: rows.slice(0, MAX_RENDER) }
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'CSV parse failed.' }
    }
  }

  // JSON body: { values } or { rows }
  const body = (await req.json().catch(() => null)) as
    | { values?: unknown; rows?: unknown }
    | null
  if (!body || typeof body !== 'object') return { error: 'Send JSON { values } / { rows }, or a CSV body.' }

  const cleanRow = (raw: unknown): Record<string, string> | null => {
    if (typeof raw !== 'object' || raw === null) return null
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string' && v.length <= 500) out[k.toLowerCase()] = v
    }
    return out
  }

  if (body.rows !== undefined) {
    if (!Array.isArray(body.rows) || !body.rows.length) return { error: '"rows" must be a non-empty array.' }
    if (body.rows.length > MAX_RENDER) return { error: `"rows" exceeds ${MAX_RENDER} entries.` }
    const rows: Record<string, string>[] = []
    for (const raw of body.rows) {
      const row = cleanRow(raw)
      if (!row) return { error: 'Each row must be an object of string values.' }
      rows.push(row)
    }
    return { rows }
  }

  if (body.values !== undefined) {
    const row = cleanRow(body.values)
    if (!row) return { error: '"values" must be an object of string values.' }
    return { rows: [row] }
  }

  return { error: 'Send JSON { values } / { rows }, or a CSV body.' }
}

async function __canvix_post(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  const limit = checkRateLimit(req, 'templates:fill')
  if (!limit.ok) return rateLimitResponse(limit)

  const { slug } = await ctx.params
  const persist = req.nextUrl.searchParams.get('persist') === '1'
  if (slug.length > 80 || !/^[a-z0-9-]+$/.test(slug)) return bad('Invalid template slug.')

  try {
    const template = await db.template.findUnique({ where: { slug } })
    if (!template) return bad('Template not found.', 404)

    const pages = (template.pages ?? []) as unknown as PageData[]
    if (!pages.length) return bad('Template has no pages.', 422)

    // field keys: declared fields win; fall back to scanning markers
    const declared = validFields(template.fields)
    const fieldKeys: string[] = declared ? declared.map((f: TemplateField) => f.key) : extractFieldKeys(pages)
    if (!fieldKeys.length) return bad('Template declares no fields.', 422)

    const parsed = await readValueRows(req, fieldKeys)
    if (parsed.error) return bad(parsed.error)
    const rows: Record<string, string>[] = parsed.rows ?? []

    // render
    const generated = rows.map((values, i) => ({
      name: rows.length > 1 ? `${template.name} (${i + 1})` : template.name,
      width: template.width,
      height: template.height,
      pages: fillTemplateFields(pages, values),
    }))

    // persist mode: create designs for the caller
    let created: { id: string; name: string }[] | undefined
    let anonToken: string | null = null
    if (persist) {
      const user = await getSessionUser(req)
      const token = readAnonToken(req) ?? newAnonToken()
      if (!user) anonToken = token
      const ownerId = user?.id ?? null
      const anonKey = user ? null : anonKeyHash(token)
      const made = await db.design.createManyAndReturn({
        data: generated.map((g) => ({
          name: g.name,
          width: g.width,
          height: g.height,
          pages: g.pages as never,
          source: `template:${template.slug}`,
          ownerId,
          anonKey,
        })),
        select: { id: true, name: true },
      })
      created = made
    }

    const res = NextResponse.json(
      { template: template.slug, fields: fieldKeys, generated, ...(created ? { created } : {}) },
      { status: created ? 201 : 200 },
    )
    if (anonToken) setAnonCookie(res, anonToken)
    return res
  } catch (error) {
    return dbErrorResponse(error, 'POST /api/templates/[slug]/fill')
  }
}

// v0.12.5 (H7): opt-in request logging wrapper
export const POST = withLogging('POST /api/templates/[slug]/fill', __canvix_post)
