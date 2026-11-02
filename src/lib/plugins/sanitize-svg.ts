// ─────────────────────────────────────────────────────────────
// Plugin SVG sanitizer — validates renderer output before the
// host uses it anywhere (research/PLUGIN-SYSTEM.md §4.5).
//
// A plugin renderer returns { svg } which the host rasterizes on
// the canvas (Konva Image), embeds into SVG exports, and feeds to
// video export. The canvas path is safe by construction (scripts
// never execute in an <img>-loaded SVG), but the EXPORT path
// embeds the string into files people open elsewhere — so the
// sanitizer must hold on its own.
//
// Design: ACCEPT OR REJECT — never rewrite. Reconstructing SVG
// safely without a DOM is where sanitizers go to die; a pure
// allow/deny scan has no transformation bugs to exploit. The
// regexes are conservative on purpose: false rejections cost a
// placeholder card, false accepts cost an XSS.
//
// Parser-hardening notes (the tricks these regexes resist):
//   · comments are stripped FIRST so `<scr<!-- -->ipt>` re-joins
//     before any content check runs
//   · the tag scanner cannot run an attribute past the next `<`
//     (`[^>"'<]`), so a 2 MB hostile document cannot trigger
//     quadratic backtracking
//   · entity-encoded hrefs (`&#106;avascript:`) fail the
//     data:/# prefix allowlist — decoding never widens it
//
// Runs in node (vitest) and browser (runtime) — no DOMParser.
// ─────────────────────────────────────────────────────────────

/** Renderer output cap (§4.5). */
export const MAX_PLUGIN_SVG_BYTES = 2 * 1024 * 1024
/** Max elements per output (bounds rasterizer work). */
export const MAX_PLUGIN_SVG_ELEMENTS = 20_000
/** Max tag nesting depth. */
export const MAX_PLUGIN_SVG_DEPTH = 64

export type SvgSanitizeResult =
  | { ok: true; svg: string }
  | { ok: false; error: string }

/** Tags a plugin renderer may emit. Anything else → reject (lowercase — tags are lowercased before lookup). */
const ALLOWED_TAGS = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'title', 'desc',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textpath',
  'image', 'lineargradient', 'radialgradient', 'stop', 'pattern',
  'clippath', 'mask', 'filter', 'feblend', 'fecolormatrix', 'fecomponenttransfer',
  'fecomposite', 'feconvolvematrix', 'fediffuselighting', 'fedisplacementmap',
  'fedistantlight', 'fedropshadow', 'feflood', 'fefunca', 'fefuncb', 'fefuncg',
  'fefuncr', 'fegaussianblur', 'feimage', 'femerge', 'femergenode', 'femorphology',
  'feoffset', 'fepointlight', 'fespecularlighting', 'fespotlight', 'fetile',
  'feturbulence', 'marker', 'style', 'switch', 'a',
])

const COMMENT_RE = /<!--[\s\S]*?-->/g
const XML_DECL_RE = /^\uFEFF?\s*<\?xml[^>]*\?>\s*/
const STYLE_BLOCK_RE = /<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi
// attrs may not run past the next '<' — see hardening note above.
// LAZY: the attrs group must yield a trailing '/' to the
// self-close capture, or <rect/> would wrongly stack as open.
const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^>"'<])*?)(\/?)>/g
const ATTR_VALUE_RE = /([a-zA-Z:][a-zA-Z0-9:_.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g
const URL_ATTRS = new Set(['href', 'xlink:href', 'src'])
const RAW_ON_ATTR_RE = /\son[a-z]+\s*=/i
const RAW_JS_URI_RE = /\s(?:xlink:)?(?:href|src)\s*=\s*["']?\s*javascript\s*:/i
const JS_URI_PREFIX_RE = /^\s*javascript\s*:/i
const CSS_URL_RE = /url\(\s*('([^']*)'|"([^"]*)"|([^)'"]*))\s*\)/gi
const CSS_IMPORT_RE = /@import/i

function fail(error: string): SvgSanitizeResult {
  return { ok: false, error }
}

/** Every url(...) target in a CSS context must be data: or an internal #ref. */
function cssUrlsAreLocal(css: string): string | null {
  if (CSS_IMPORT_RE.test(css)) return '@import is not allowed in renderer CSS'
  CSS_URL_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CSS_URL_RE.exec(css)) !== null) {
    const url = (m[2] ?? m[3] ?? m[4] ?? '').trim()
    if (!url.startsWith('data:') && !url.startsWith('#')) {
      return `CSS may only reference data: URLs (found "${url.slice(0, 40)}")`
    }
  }
  return null
}

/**
 * Validate a plugin renderer's SVG output. On success the value
 * is safe to rasterize and to embed in exports — it is returned
 * UNCHANGED (accept-or-reject, no rewriting).
 */
export function sanitizePluginSvg(raw: string): SvgSanitizeResult {
  if (typeof raw !== 'string') return fail('renderer output must be a string')
  if (raw.length > MAX_PLUGIN_SVG_BYTES) {
    return fail(`renderer output is ${raw.length} bytes — the cap is ${MAX_PLUGIN_SVG_BYTES}`)
  }

  // 1. comments first — payloads split across comments rejoin here
  let s = raw.replace(COMMENT_RE, '')

  // 2. document shape: optional <?xml?>, then exactly an <svg>…</svg> doc
  s = s.replace(XML_DECL_RE, '')
  if (!s.startsWith('<svg')) return fail('renderer output must start with <svg (optional <?xml declaration)')
  if (!s.trimEnd().endsWith('</svg>')) return fail('renderer output must end with </svg>')

  // 3. document-level rejections: XXE vectors, CDATA games, stray PIs
  if (/<!DOCTYPE/i.test(s)) return fail('doctype declarations are not allowed')
  if (/<!ENTITY/i.test(s)) return fail('entity declarations are not allowed')
  if (/<!\[CDATA\[/.test(s)) return fail('CDATA sections are not allowed')
  if (s.includes('<?')) return fail('processing instructions are not allowed')

  // 4. script / foreignObject in any casing or spacing
  if (/<\s*\/?\s*script/i.test(s)) return fail('script elements are not allowed')
  if (/foreignobject/i.test(s)) return fail('foreignObject is not allowed')

  // 5. <style> blocks: validate CSS, replace with inert placeholders
  let styleError: string | null = null
  s = s.replace(STYLE_BLOCK_RE, (_m, _attrs: string, body: string) => {
    styleError ??= cssUrlsAreLocal(body)
    return '<g/>'
  })
  if (styleError) return fail(styleError)

  // 6. tag walk: allowlist, balance, depth, count, attributes
  let count = 0
  const stack: string[] = []
  TAG_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TAG_RE.exec(s)) !== null) {
    const closing = m[1] === '/'
    const tag = m[2].toLowerCase()
    const attrs = m[3] ?? ''
    const selfClosing = m[4] === '/'

    if (!ALLOWED_TAGS.has(tag)) {
      return fail(`element <${tag}> is not allowed in renderer output`)
    }
    if (closing) {
      if (stack.length === 0 || stack[stack.length - 1] !== tag) {
        return fail(`mismatched closing tag </${tag}>`)
      }
      stack.pop()
      continue
    }
    count += 1
    if (count > MAX_PLUGIN_SVG_ELEMENTS) {
      return fail(`more than ${MAX_PLUGIN_SVG_ELEMENTS} elements in renderer output`)
    }
    if (!selfClosing) stack.push(tag)
    if (stack.length > MAX_PLUGIN_SVG_DEPTH) {
      return fail(`renderer output nests deeper than ${MAX_PLUGIN_SVG_DEPTH} levels`)
    }

    // raw attr text: handlers and javascript: URIs, quoted or not
    if (RAW_ON_ATTR_RE.test(attrs)) {
      return fail('event handler attributes are not allowed')
    }
    if (RAW_JS_URI_RE.test(attrs)) {
      return fail('javascript: URIs are not allowed')
    }
    // unquoted href/src values (quoted values checked precisely below)
    if (/(?:xlink:)?href\s*=\s*(?!["'#])/i.test(attrs) || /src\s*=\s*(?!["'#])/i.test(attrs)) {
      return fail('href/src attributes must be quoted')
    }

    // quoted attribute values: precise name-aware checks
    ATTR_VALUE_RE.lastIndex = 0
    let am: RegExpExecArray | null
    while ((am = ATTR_VALUE_RE.exec(attrs)) !== null) {
      const name = am[1].toLowerCase()
      const value = am[3] ?? am[4] ?? ''
      if (/^on[a-z]+$/i.test(name)) {
        return fail(`event handler attribute "${name}" is not allowed`)
      }
      if (JS_URI_PREFIX_RE.test(value)) {
        return fail(`javascript: URIs are not allowed (attribute "${name}")`)
      }
      if (URL_ATTRS.has(name)) {
        if (!value.startsWith('data:') && !value.startsWith('#')) {
          return fail(`attribute "${name}" may only use data: URLs or internal #refs (found "${value.slice(0, 40)}")`)
        }
      }
      // CSS in attribute values (style="…") gets the same url() rules
      if (name === 'style') {
        const cssErr = cssUrlsAreLocal(value)
        if (cssErr) return fail(cssErr)
      }
    }
  }
  if (stack.length > 0) {
    return fail(`unclosed element <${stack[stack.length - 1]}>`)
  }
  // anything left after the walk that still looks like a tag = junk
  const residue = s.replace(TAG_RE, '')
  if (/<[a-zA-Z]/.test(residue)) {
    return fail('malformed markup in renderer output')
  }
  return { ok: true, svg: raw }
}
