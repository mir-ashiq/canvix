// ─────────────────────────────────────────────────────────────
// Plugin manifest — types + the install-time validator
// (research/PLUGIN-SYSTEM.md §4.1).
//
// A plugin is a directory of static files described by
// `manifest.canvix.json`. This validator is the first gate of the
// trust chain: everything the consent screen shows, the serve
// route serves, and the broker enforces originates from a
// manifest that passed HERE.
//
// Validation philosophy: collect every error (plain language,
// never a silent no-op), normalize what passes, and reject
// anything not explicitly allowed. Unknown top-level keys are
// ignored on purpose — a future-minor manifest on this host keeps
// its v1 contract; version checks above decide compatibility.
// ─────────────────────────────────────────────────────────────

import { checkCloneSafe } from './data-caps'
import { normalizePermissions } from './permissions'
import { isValidRange, matchesRange, parseSemver } from './semver'

/** Plugin API version THIS host build speaks (envelope major + additive minor). */
export const PLUGIN_API_MAJOR = 1
export const PLUGIN_API_MINOR = 0

/** Hard size cap for the manifest JSON itself. */
export const MAX_MANIFEST_BYTES = 64 * 1024
/** Max declared element types per plugin. */
export const MAX_ELEMENTS = 20
/** Max property fields per element schema. */
export const MAX_FIELDS = 24

const API_RE = /^\d+(\.\d+)?$/
const ID_RE = /^[a-z0-9][a-z0-9-]{1,62}(\.[a-z0-9-]+){0,3}$/
const KIND_RE = /^[a-z][a-z0-9-]{0,30}$/
const FIELD_KEY_RE = /^[a-z][a-zA-Z0-9]{0,30}$/
const HEX_RE = /^#[0-9a-fA-F]{6}$/
const ENTRY_PATH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,118}\.html$/

export type PluginFieldType = 'text' | 'number' | 'color' | 'select' | 'range'

export interface PluginFieldSpec {
  key: string
  type: PluginFieldType
  label: string
  min?: number
  max?: number
  step?: number
  maxLength?: number
  options?: { value: string; label: string }[]
}

export interface PluginElementSpec {
  kind: string
  label: string
  initialData: Record<string, unknown>
  schema: PluginFieldSpec[]
}

export interface PluginManifest {
  canvixPluginApi: string
  id: string
  name: string
  description?: string
  version: string
  author?: { name: string; url?: string }
  engines: { canvix: string }
  entry: { panel?: string }
  permissions: string[]
  elements: PluginElementSpec[]
}

export interface ValidateManifestOptions {
  /** host app semver, e.g. "0.13.0" — checked against engines.canvix */
  hostAppVersion: string
  /** override for tests / future hosts */
  hostApiMajor?: number
  hostApiMinor?: number
  /** allow `com.canvix.*` ids — first-party/bundled plugins only */
  allowFirstParty?: boolean
}

export type ManifestResult =
  | { ok: true; manifest: PluginManifest; networkOrigins: string[] }
  | { ok: false; errors: string[] }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype
}

/** Is `p` a safe relative asset path (no traversal, no scheme, no absolute)? */
export function isSafeEntryPath(p: unknown): p is string {
  if (typeof p !== 'string') return false
  if (!ENTRY_PATH_RE.test(p)) return false
  if (p.includes('..')) return false
  if (p.includes('\\')) return false
  // ≤ 8 segments, no empty segments ("a//b")
  const segs = p.split('/')
  if (segs.length > 8 || segs.some((s) => !s)) return false
  return true
}

/** Validate one field spec; return its error or null. */
function validateField(f: unknown, where: string): string | null {
  if (!isPlainObject(f)) return `${where}: each schema field must be an object`
  if (typeof f.key !== 'string' || !FIELD_KEY_RE.test(f.key)) {
    return `${where}: field key must be lowerCamelCase identifiers ("${String(f.key)}")`
  }
  const types: PluginFieldType[] = ['text', 'number', 'color', 'select', 'range']
  if (!types.includes(f.type as PluginFieldType)) {
    return `${where}.${f.key}: type must be one of ${types.join(', ')}`
  }
  if (typeof f.label !== 'string' || f.label.trim().length < 1 || f.label.length > 40) {
    return `${where}.${f.key}: label must be 1–40 characters`
  }
  if (f.type === 'number' || f.type === 'range') {
    const min = f.min
    const max = f.max
    if (min !== undefined && !Number.isFinite(Number(min))) return `${where}.${f.key}: min must be a finite number`
    if (max !== undefined && !Number.isFinite(Number(max))) return `${where}.${f.key}: max must be a finite number`
    if (min !== undefined && max !== undefined && Number(min) > Number(max)) {
      return `${where}.${f.key}: min must be ≤ max`
    }
    if (f.step !== undefined && !(Number(f.step) > 0)) return `${where}.${f.key}: step must be > 0`
  }
  if (f.type === 'text' && f.maxLength !== undefined) {
    const m = Number(f.maxLength)
    if (!Number.isInteger(m) || m < 1 || m > 400) return `${where}.${f.key}: maxLength must be 1–400`
  }
  if (f.type === 'select') {
    const opts = f.options
    if (!Array.isArray(opts) || opts.length < 2 || opts.length > 10) {
      return `${where}.${f.key}: select needs 2–10 options`
    }
    const seen = new Set<string>()
    for (const o of opts) {
      if (!isPlainObject(o) || typeof o.value !== 'string' || !o.value || o.value.length > 40) {
        return `${where}.${f.key}: each option needs a value (1–40 chars)`
      }
      if (typeof o.label !== 'string' || !o.label || o.label.length > 40) {
        return `${where}.${f.key}: each option needs a label (1–40 chars)`
      }
      if (seen.has(o.value)) return `${where}.${f.key}: duplicate option value "${o.value}"`
      seen.add(o.value)
    }
  }
  return null
}

/** Does `value` conform to a validated field spec? */
function valueMatchesField(value: unknown, f: PluginFieldSpec): boolean {
  switch (f.type) {
    case 'text':
      return typeof value === 'string' && value.length <= (f.maxLength ?? 400)
    case 'color':
      return typeof value === 'string' && HEX_RE.test(value)
    case 'number':
    case 'range': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return false
      if (f.min !== undefined && value < f.min) return false
      if (f.max !== undefined && value > f.max) return false
      return true
    }
    case 'select':
      return typeof value === 'string' && (f.options ?? []).some((o) => o.value === value)
  }
}

/**
 * Validate a parsed manifest JSON value. Collects ALL errors so a
 * plugin author fixes everything in one round-trip.
 */
export function validateManifest(raw: unknown, opts: ValidateManifestOptions): ManifestResult {
  const errors: string[] = []
  const hostMajor = opts.hostApiMajor ?? PLUGIN_API_MAJOR
  const hostMinor = opts.hostApiMinor ?? PLUGIN_API_MINOR

  let serialized: string
  try {
    serialized = JSON.stringify(raw)
  } catch {
    return { ok: false, errors: ['manifest is not JSON-serializable'] }
  }
  if (serialized.length > MAX_MANIFEST_BYTES) {
    return { ok: false, errors: [`manifest is ${serialized.length} bytes — the cap is ${MAX_MANIFEST_BYTES}`] }
  }
  if (!isPlainObject(raw)) {
    return { ok: false, errors: ['manifest must be a JSON object'] }
  }
  // reserved key names — a hostile manifest must not be able to
  // plant own __proto__/constructor/prototype keys for downstream
  // naive merges to trip over (JSON.parse makes these real own keys)
  for (const key of Object.keys(raw)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return { ok: false, errors: [`manifest must not contain the reserved key "${key}"`] }
    }
  }

  // ── canvixPluginApi ──
  const api = raw.canvixPluginApi
  if (typeof api !== 'string' || !API_RE.test(api)) {
    errors.push('canvixPluginApi must be "1" or "major.minor" like "1.2"')
  } else {
    const [majStr, minStr = '0'] = api.split('.')
    const maj = Number(majStr)
    const min = Number(minStr)
    if (maj !== hostMajor) {
      errors.push(
        maj > hostMajor
          ? `this plugin needs plugin API v${maj} — this Canvix speaks v${hostMajor}.${hostMinor}; update Canvix or install an older plugin`
          : `this plugin targets plugin API v${maj} which this Canvix no longer supports (v${hostMajor}.${hostMinor})`,
      )
    } else if (min > hostMinor) {
      errors.push(
        `this plugin needs plugin API v${maj}.${min} — this Canvix speaks v${hostMajor}.${hostMinor}; update Canvix`,
      )
    }
  }

  // ── id ──
  const id = raw.id
  if (typeof id !== 'string' || !ID_RE.test(id) || id.length > 80) {
    errors.push('id must look like "com.example.plugin" — lowercase, dots/hyphens, 2–80 chars')
  } else if (!opts.allowFirstParty && (id.startsWith('com.canvix.') || id === 'canvix')) {
    errors.push('ids under com.canvix.* are reserved for plugins bundled with Canvix')
  }

  // ── name / description / version / author ──
  const name = raw.name
  if (typeof name !== 'string' || name.trim().length < 1 || name.length > 80) {
    errors.push('name must be 1–80 characters')
  }
  if (raw.description !== undefined && (typeof raw.description !== 'string' || raw.description.length > 280)) {
    errors.push('description must be a string of at most 280 characters')
  }
  const version = raw.version
  if (typeof version !== 'string' || !parseSemver(version)) {
    errors.push('version must be semver, e.g. "1.0.0"')
  }
  if (raw.author !== undefined) {
    if (!isPlainObject(raw.author) || typeof raw.author.name !== 'string' || raw.author.name.length < 1 || raw.author.name.length > 80) {
      errors.push('author.name must be 1–80 characters')
    } else if (raw.author.url !== undefined) {
      try {
        const u = new URL(String(raw.author.url))
        if (u.protocol !== 'https:') errors.push('author.url must be https:')
      } catch {
        errors.push('author.url must be a valid URL')
      }
    }
  }

  // ── engines.canvix ──
  const engines = raw.engines
  if (!isPlainObject(engines) || typeof engines.canvix !== 'string' || !isValidRange(engines.canvix)) {
    errors.push('engines.canvix must be a semver range, e.g. ">=0.13.0 <0.14.0"')
  } else if (!matchesRange(opts.hostAppVersion, engines.canvix)) {
    errors.push(
      `this plugin needs Canvix ${engines.canvix} — this instance is ${opts.hostAppVersion}`,
    )
  }

  // ── entry ──
  const entry = raw.entry
  const elementsRaw = raw.elements
  const hasElements = Array.isArray(elementsRaw) && elementsRaw.length > 0
  if (!isPlainObject(entry)) {
    errors.push('entry must be an object, e.g. { "panel": "panel.html" }')
  } else if (entry.panel !== undefined && !isSafeEntryPath(entry.panel)) {
    errors.push('entry.panel must be a relative .html path inside the plugin (no "..", no absolute paths)')
  } else if (entry.panel === undefined && !hasElements) {
    errors.push('a plugin must declare entry.panel and/or elements — otherwise it does nothing')
  }

  // ── permissions ──
  const perms = normalizePermissions(raw.permissions)
  if (!perms.ok) {
    errors.push(`permissions: ${perms.error}`)
  }

  // ── elements ──
  const elements: PluginElementSpec[] = []
  if (elementsRaw !== undefined) {
    if (!Array.isArray(elementsRaw) || elementsRaw.length === 0) {
      errors.push('elements must be a non-empty array when present')
    } else if (elementsRaw.length > MAX_ELEMENTS) {
      errors.push(`at most ${MAX_ELEMENTS} element types per plugin`)
    } else {
      const kinds = new Set<string>()
      for (let i = 0; i < elementsRaw.length; i++) {
        const e = elementsRaw[i]
        const where = `elements[${i}]`
        if (!isPlainObject(e)) {
          errors.push(`${where}: must be an object`)
          continue
        }
        if (typeof e.kind !== 'string' || !KIND_RE.test(e.kind)) {
          errors.push(`${where}: kind must be a lowercase slug like "cloud"`)
          continue
        }
        if (kinds.has(e.kind)) errors.push(`${where}: duplicate kind "${e.kind}"`)
        kinds.add(e.kind)
        if (typeof e.label !== 'string' || e.label.trim().length < 1 || e.label.length > 40) {
          errors.push(`${where}.${e.kind}: label must be 1–40 characters`)
        }
        if (!isPlainObject(e.initialData)) {
          errors.push(`${where}.${e.kind}: initialData must be an object`)
          continue
        }
        const capErr = checkCloneSafe(e.initialData)
        if (capErr) errors.push(`${where}.${e.kind}: initialData ${capErr}`)

        const schema: PluginFieldSpec[] = []
        if (e.schema !== undefined) {
          if (!Array.isArray(e.schema) || e.schema.length === 0) {
            errors.push(`${where}.${e.kind}: schema must be a non-empty array when present`)
          } else if (e.schema.length > MAX_FIELDS) {
            errors.push(`${where}.${e.kind}: at most ${MAX_FIELDS} schema fields`)
          } else {
            const keys = new Set<string>()
            for (const f of e.schema) {
              const err = validateField(f, `${where}.${e.kind}`)
              if (err) {
                errors.push(err)
                continue
              }
              const spec = f as PluginFieldSpec
              if (keys.has(spec.key)) errors.push(`${where}.${e.kind}: duplicate schema key "${spec.key}"`)
              keys.add(spec.key)
              // coherence: initialData must carry every schema key, validly
              if (!(spec.key in e.initialData)) {
                errors.push(`${where}.${e.kind}: initialData is missing "${spec.key}" from the schema`)
              } else if (!valueMatchesField(e.initialData[spec.key], spec)) {
                errors.push(`${where}.${e.kind}: initialData.${spec.key} does not match its ${spec.type} schema`)
              }
              schema.push(spec)
            }
          }
        }
        elements.push({
          kind: e.kind as string,
          label: e.label as string,
          initialData: e.initialData,
          schema,
        })
      }
    }
  }

  if (errors.length) return { ok: false, errors }

  const m: PluginManifest = {
    canvixPluginApi: api as string,
    id: id as string,
    name: name as string,
    ...(raw.description !== undefined ? { description: raw.description as string } : {}),
    version: version as string,
    ...(isPlainObject(raw.author)
      ? { author: raw.author as { name: string; url?: string } }
      : {}),
    engines: { canvix: (engines as { canvix: string }).canvix },
    entry: isPlainObject(entry)
      ? entry.panel !== undefined
        ? { panel: entry.panel as string }
        : {}
      : {},
    permissions: perms.ok ? perms.permissions : [],
    elements,
  }
  return {
    ok: true,
    manifest: m,
    networkOrigins: perms.ok ? perms.networkOrigins : [],
  }
}

// ── install-time HTML packaging rule (§4.2) ───────────────────
//
// The serve route's CSP has no `unsafe-inline` for scripts, so an
// inline <script> can never run — this check exists so a broken
// plugin fails at INSTALL (clear error) instead of at RUN (silent
// dead UI), and so `script-src 'self'` stays defensible.

const SCRIPT_TAG_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi
const SCRIPT_SRC_RE = /src\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i
const JS_URI_RE = /javascript\s*:/i
const ON_HANDLER_RE = /\son[a-z]+\s*=/i
const SAFE_ASSET_PATH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,118}$/

/** Max size for one served HTML file. */
export const MAX_ENTRY_HTML_BYTES = 512 * 1024

/**
 * Packaging rules for a plugin's entry HTML. Returns null when
 * clean, or the first violation found.
 */
export function checkEntryHtml(html: string): string | null {
  if (typeof html !== 'string') return 'entry HTML must be a string'
  if (html.length > MAX_ENTRY_HTML_BYTES) {
    return `entry HTML is ${html.length} bytes — the cap is ${MAX_ENTRY_HTML_BYTES}`
  }
  if (JS_URI_RE.test(html)) return 'entry HTML must not contain javascript: URIs'
  if (ON_HANDLER_RE.test(html)) return 'entry HTML must not contain inline event handlers (onclick=…)'
  let m: RegExpExecArray | null
  SCRIPT_TAG_RE.lastIndex = 0
  while ((m = SCRIPT_TAG_RE.exec(html)) !== null) {
    const attrs = m[1] ?? ''
    const body = m[2] ?? ''
    const src = SCRIPT_SRC_RE.exec(attrs)
    if (!src) {
      if (body.trim()) return 'entry HTML must not contain inline <script> blocks (use <script src="app.js">)'
      continue // empty script tag is pointless but harmless
    }
    const srcValue = src[2] ?? src[3] ?? src[4] ?? ''
    if (srcValue.includes('..') || srcValue.includes('\\')) {
      return `script src "${srcValue}" must stay inside the plugin directory`
    }
    if (!SAFE_ASSET_PATH_RE.test(srcValue)) {
      return `script src "${srcValue}" must be a relative path (no schemes or absolute URLs)`
    }
  }
  return null
}
