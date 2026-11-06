import { describe, expect, it, beforeEach } from 'vitest'
import {
  faceKey,
  parseTtfUrlFromCss2,
  resolveFontFace,
  resolveFontFaces,
  snapWeight,
  std14For,
  isKnownFamily,
  clearFontSessionCache,
  type FontLadderIo,
} from './fonts'

describe('std14 fallback table', () => {
  it('maps categories to base faces', () => {
    expect(std14For('Inter')).toBe('Helvetica')
    expect(std14For('Poppins')).toBe('Helvetica')
    expect(std14For('Anton')).toBe('Helvetica') // display degrades to sans
    expect(std14For('Pacifico')).toBe('Helvetica') // handwriting degrades to sans
    expect(std14For('Playfair Display')).toBe('Times')
    expect(std14For('Lora')).toBe('Times')
    expect(std14For('JetBrains Mono')).toBe('Courier')
    expect(std14For('Totally Unknown Font')).toBe('Helvetica')
    expect(isKnownFamily('Inter')).toBe(true)
    expect(isKnownFamily('Totally Unknown Font')).toBe(false)
  })
})

describe('snapWeight', () => {
  it('snaps unavailable weights to the nearest family weight', () => {
    expect(snapWeight('Montserrat', 400)).toBe(600) // 600-900 only
    expect(snapWeight('Oswald', 400)).toBe(500)
    expect(snapWeight('Abril Fatface', 700)).toBe(400) // 400 only
    expect(snapWeight('Inter', 400)).toBe(400)
    expect(snapWeight('Inter', 700)).toBe(700)
    expect(snapWeight('Unknown', 700)).toBe(700) // unknown → passthrough
  })
})

describe('parseTtfUrlFromCss2', () => {
  it('extracts the truetype source', () => {
    const css = [
      '@font-face {',
      "  font-family: 'Poppins';",
      '  font-style: normal;',
      '  font-weight: 700;',
      "  src: url(https://fonts.gstatic.com/s/poppins/v24/pxiByp8kv8JHgFVrLCz7V1tvEv-L.ttf) format('truetype');",
      '}',
    ].join('\n')
    expect(parseTtfUrlFromCss2(css)).toBe('https://fonts.gstatic.com/s/poppins/v24/pxiByp8kv8JHgFVrLCz7V1tvEv-L.ttf')
  })

  it('ignores woff/eot responses (fail-closed)', () => {
    expect(parseTtfUrlFromCss2("@font-face{src:url(https://x/a.woff) format('woff')}")).toBeNull()
    expect(parseTtfUrlFromCss2('')).toBeNull()
    expect(parseTtfUrlFromCss2('no urls here')).toBeNull()
  })
})

describe('resolveFontFace (the ladder)', () => {
  beforeEach(() => clearFontSessionCache())

  const fakeFont = new Uint8Array(2048)
  fakeFont[0] = 0x00
  fakeFont[1] = 0x01
  fakeFont[2] = 0x00
  fakeFont[3] = 0x00

  const io = (over: Partial<FontLadderIo> = {}): FontLadderIo => ({
    lookupUrl: async () => 'https://fonts.gstatic.com/s/poppins/v24/x.ttf',
    fetchBytes: async () => fakeFont,
    ...over,
  })

  it('embeds when the lookup and download succeed', async () => {
    const seen: Array<[string, number, boolean]> = []
    const res = await resolveFontFace({ family: 'Poppins', bold: true, italic: false }, {
      lookupUrl: async (family, weight, italic) => {
        seen.push([family, weight, italic])
        return 'https://fonts.gstatic.com/s/poppins/v24/x.ttf'
      },
      fetchBytes: async () => fakeFont,
    })
    expect(res.kind).toBe('ttf')
    if (res.kind === 'ttf') expect(res.bytes).toBe(fakeFont)
    // bold flag snapped to the family's 700
    expect(seen).toEqual([['Poppins', 700, false]])
  })

  it('falls back to std14 when the css2 lookup misses', async () => {
    const res = await resolveFontFace({ family: 'Lora', bold: false, italic: true }, {
      lookupUrl: async () => null,
    })
    expect(res).toEqual({ kind: 'std14', family: 'Lora', bold: false, italic: true, base: 'Times' })
  })

  it('falls back when bytes are not a plausible TTF', async () => {
    const res = await resolveFontFace({ family: 'Inter', bold: false, italic: false }, {
      lookupUrl: async () => 'https://fonts.gstatic.com/s/inter/x.woff2',
      fetchBytes: async () => new Uint8Array([0x77, 0x4f, 0x46, 0x32, ...new Array(600).fill(0)]),
    })
    expect(res.kind).toBe('std14')
  })

  it('never throws — fetch failures degrade to std14', async () => {
    const res = await resolveFontFace({ family: 'Inter', bold: false, italic: false }, {
      lookupUrl: async () => {
        throw new Error('network gone')
      },
    })
    expect(res.kind).toBe('std14')
  })

  it('skips the network for unknown families entirely', async () => {
    let called = false
    const res = await resolveFontFace({ family: 'My Local Font', bold: false, italic: false }, {
      lookupUrl: async () => {
        called = true
        return 'x'
      },
    })
    expect(called).toBe(false)
    expect(res.kind).toBe('std14')
  })

  it('caches per face within the session', async () => {
    let lookups = 0
    const io2: FontLadderIo = {
      lookupUrl: async () => {
        lookups += 1
        return 'https://fonts.gstatic.com/s/poppins/v24/x.ttf'
      },
      fetchBytes: async () => fakeFont,
    }
    await resolveFontFace({ family: 'Poppins', bold: false, italic: false }, io2)
    await resolveFontFace({ family: 'Poppins', bold: false, italic: false }, io2)
    expect(lookups).toBe(1)
    // a different face re-looks-up
    await resolveFontFace({ family: 'Poppins', bold: true, italic: false }, io2)
    expect(lookups).toBe(2)
  })

  it('dedupes requests in resolveFontFaces', async () => {
    let lookups = 0
    const res = await resolveFontFaces(
      [
        { family: 'Inter', bold: false, italic: false },
        { family: 'Inter', bold: false, italic: false },
        { family: 'Inter', bold: false, italic: false },
        { family: 'JetBrains Mono', bold: true, italic: false },
      ],
      {
        lookupUrl: async () => {
          lookups += 1
          return 'https://fonts.gstatic.com/s/x.ttf'
        },
        fetchBytes: async () => fakeFont,
      },
    )
    expect(lookups).toBe(2)
    expect(res.get(faceKey({ family: 'Inter', bold: false, italic: false }))?.kind).toBe('ttf')
    expect(res.get(faceKey({ family: 'JetBrains Mono', bold: true, italic: false }))?.kind).toBe('ttf')
  })
})
