import { describe, expect, it } from 'vitest'
import {
  MAX_PLUGIN_SVG_BYTES,
  MAX_PLUGIN_SVG_DEPTH,
  sanitizePluginSvg,
} from './sanitize-svg'

// Renderer output is untrusted by contract (§4.5). The sanitizer
// accepts-or-rejects, never rewrites — these tests attack it with
// the classic SVG XSS corpus plus structural abuse.

const CLOUD = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
  <g><text x="10" y="50" font-size="42" fill="#7630D7">hello</text></g>
</svg>`

describe('sanitizePluginSvg — the golden path', () => {
  it('accepts a clean word-cloud-style SVG unchanged', () => {
    const r = sanitizePluginSvg(CLOUD)
    expect(r).toEqual({ ok: true, svg: CLOUD })
  })

  it('tolerates BOM, xml declaration, whitespace and comments', () => {
    const doc = '\uFEFF  <?xml version="1.0"?>\n<!-- generated -->\n' + CLOUD
    expect(sanitizePluginSvg(doc).ok).toBe(true)
  })

  it('accepts internal refs and data: URLs in hrefs', () => {
    const r = sanitizePluginSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g1"/></defs><rect fill="url(#g1)" width="10" height="10"/><image href="data:image/png;base64,iVBOR" width="8" height="8"/></svg>`,
    )
    expect(r.ok).toBe(true)
  })

  it('accepts filter/gradient/pattern/marker elements', () => {
    const r = sanitizePluginSvg(
      `<svg><defs><filter id="f"><feGaussianBlur stdDeviation="2"/></filter><pattern id="p"><rect width="4" height="4"/></pattern><marker id="m"/></defs><rect filter="url(#f)" fill="url(#p)" width="9" height="9"/></svg>`,
    )
    expect(r.ok).toBe(true)
  })
})

describe('sanitizePluginSvg — the XSS corpus', () => {
  it('rejects script elements in every casing and spacing', () => {
    for (const evil of [
      '<svg><script>alert(1)</script></svg>',
      '<svg><SCRIPT>alert(1)</SCRIPT></svg>',
      '<svg>< script >alert(1)</ script ></svg>',
      '<svg><script/xss>alert(1)</script></svg>',
      '<svg><a href="#" onclick="alert(1)"><text>x</text></a></svg>',
    ]) {
      expect(sanitizePluginSvg(evil).ok, evil).toBe(false)
    }
  })

  it('rejects foreignObject (the HTML smuggling vector)', () => {
    expect(sanitizePluginSvg('<svg><foreignObject><div onclick="x()"/></foreignObject></svg>').ok).toBe(false)
    // mixed case
    expect(sanitizePluginSvg('<svg><ForeignObject/></svg>').ok).toBe(false)
    // split across a comment — rejoins at strip time
    expect(sanitizePluginSvg('<svg><foreign<!-- -->Object/></svg>').ok).toBe(false)
  })

  it('rejects event handler attributes', () => {
    for (const handler of ['onload', 'onclick', 'onanimationstart', 'ONERROR']) {
      const evil = `<svg><rect width="10" height="10" ${handler}="alert(1)"/></svg>`
      expect(sanitizePluginSvg(evil).ok, handler).toBe(false)
    }
    // false-positive guard: "on x =" inside text content is inert
    expect(sanitizePluginSvg('<svg><text>turn on x = 5</text></svg>').ok).toBe(true)
  })

  it('rejects javascript: and external hrefs (data:/# only)', () => {
    for (const evil of [
      '<svg><a href="javascript:alert(1)"><text>x</text></a></svg>',
      "<svg><a href='javascript:alert(1)'><text>x</text></a></svg>",
      '<svg><a xlink:href="https://evil.example.com"><text>x</text></a></svg>',
      '<svg><image href="https://evil.example.com/pixel.gif"/></svg>',
      '<svg><image href="//evil.example.com/pixel.gif"/></svg>',
      '<svg><image src="https://evil.example.com/pixel.gif"/></svg>',
      // unquoted javascript href
      '<svg><a href=javascript:alert(1)><text>x</text></a></svg>',
    ]) {
      expect(sanitizePluginSvg(evil).ok, evil.slice(0, 60)).toBe(false)
    }
  })

  it('rejects CSS exfiltration vectors in <style>', () => {
    expect(sanitizePluginSvg('<svg><style>@import url("https://evil.example.com/x.css");</style><rect/></svg>').ok).toBe(false)
    expect(sanitizePluginSvg('<svg><style>rect { background: url(https://evil.example.com/p); }</style><rect/></svg>').ok).toBe(false)
    expect(sanitizePluginSvg('<svg><style>rect { fill: url("data:image/png;base64,iVBOR"); }</style><rect/></svg>').ok).toBe(true)
  })

  it('rejects doctype/entity (XXE) and CDATA smuggling', () => {
    expect(sanitizePluginSvg('<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg>&xxe;</svg>').ok).toBe(false)
    expect(sanitizePluginSvg('<svg><![CDATA[<script>alert(1)</script>]]></svg>').ok).toBe(false)
  })
})

describe('sanitizePluginSvg — structural abuse', () => {
  it('rejects non-SVG documents and fragments', () => {
    for (const junk of ['', '<html><body></body></html>', '<div/>', 'hello', '<svg', '<svg>']) {
      expect(sanitizePluginSvg(junk).ok, JSON.stringify(junk)).toBe(false)
    }
  })

  it('rejects unknown elements', () => {
    expect(sanitizePluginSvg('<svg><iframe src="https://evil"/></svg>').ok).toBe(false)
    expect(sanitizePluginSvg('<svg><embed src="https://evil"/></svg>').ok).toBe(false)
    expect(sanitizePluginSvg('<svg><animate attributeName="href" values="https://evil"/></svg>').ok).toBe(false)
    expect(sanitizePluginSvg('<svg><set/></svg>').ok).toBe(false)
  })

  it('rejects unbalanced and mismatched tags', () => {
    expect(sanitizePluginSvg('<svg><g><rect width="5" height="5"/></svg>').ok).toBe(false)
    expect(sanitizePluginSvg('<svg></g></svg>').ok).toBe(false)
    expect(sanitizePluginSvg('<svg><g></text></g></svg>').ok).toBe(false)
  })

  it('enforces size and depth caps', () => {
    const big = `<svg>${'<rect width="1" height="1"/>'.repeat(Math.ceil(MAX_PLUGIN_SVG_BYTES / 26) + 10)}</svg>`
    expect(sanitizePluginSvg(big).ok).toBe(false)

    const deep = `<svg>${'<g>'.repeat(MAX_PLUGIN_SVG_DEPTH + 1)}${'</g>'.repeat(MAX_PLUGIN_SVG_DEPTH + 1)}</svg>`
    expect(sanitizePluginSvg(deep).ok).toBe(false)
  })

  it('rejects malformed markup the tag walker cannot fully parse', () => {
    expect(sanitizePluginSvg('<svg><rect width="5" <rect/></svg>').ok).toBe(false)
  })
})
