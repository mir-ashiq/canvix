import { describe, expect, it } from 'vitest'
import type { PageData } from '@/lib/types'
import {
  createLineElement,
  createShapeElement,
  createStickerElement,
  createTextElement,
} from '@/lib/types'
import { exportDesignToPptx } from '@/lib/pptx-export'

const page = (elements: unknown[], extra: Partial<PageData> = {}): PageData =>
  ({ id: 'p1', background: { type: 'solid', color: '#FFFFFF' }, elements, ...extra }) as unknown as PageData

/** Decode the produced pptx (a zip) into part name → text/binary. */
async function partsOf(blob: Blob): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const dv = new DataView(bytes.buffer)
  const dec = new TextDecoder()
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  expect(eocd).toBeGreaterThanOrEqual(0)
  const count = dv.getUint16(eocd + 10, true)
  const out = new Map<string, Uint8Array>()
  let p = dv.getUint32(eocd + 16, true)
  for (let i = 0; i < count; i++) {
    const method = dv.getUint16(p + 10, true)
    const csize = dv.getUint32(p + 20, true)
    const nameLen = dv.getUint16(p + 28, true)
    const extraLen = dv.getUint16(p + 30, true)
    const commentLen = dv.getUint16(p + 32, true)
    const localOff = dv.getUint32(p + 42, true)
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen))
    const lNameLen = dv.getUint16(localOff + 26, true)
    const lExtraLen = dv.getUint16(localOff + 28, true)
    const start = localOff + 30 + lNameLen + lExtraLen
    const raw = bytes.subarray(start, start + csize)
    let data = raw
    if (method === 8) {
      const DS = (globalThis as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream
      if (typeof DS === 'function') {
        const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DS('deflate-raw'))
        data = new Uint8Array(await new Response(stream).arrayBuffer())
      }
    }
    out.set(name, data)
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

const xml = (b: Uint8Array): string => new TextDecoder().decode(b)

describe('exportDesignToPptx (node — no DOM, native elements only)', () => {
  it('builds a package with the full OOXML skeleton and a mapped slide', async () => {
    const text = createTextElement({
      x: 40,
      y: 60,
      width: 600,
      text: 'Slide title\nSecond line with <tags> & "quotes"',
      align: 'center',
      fontFamily: 'Poppins',
      fontSize: 48,
      bold: true,
    })
    const rect = createShapeElement('rect', { x: 0, y: 0, width: 800, height: 600, fill: '#7D2AE8' })
    const ellipse = createShapeElement('ellipse', { x: 100, y: 100, width: 200, height: 120, fill: '#02C0CC' })
    const star = createShapeElement('star', { x: 400, y: 150, width: 160, height: 160, fill: '#FFD166' })
    const line = createLineElement({ x: 20, y: 500, width: 300, stroke: '#333333' })
    const sticker = createStickerElement('🚀', { x: 700, y: 40, fontSize: 64 })

    const result = await exportDesignToPptx({
      designWidth: 800,
      designHeight: 600,
      pages: [
        page([rect, ellipse, star, line, sticker, text], {
          notes: 'Say the thing about the slide.\nThen pause.',
        }),
      ],
      title: 'Deck',
    })

    expect(result.pages).toBe(1)
    expect(result.natives).toBe(6)
    expect(result.rasters).toBe(0) // node has no DOM → fallbacks skipped
    expect(result.notes).toBe(1)
    expect(result.bytes).toBeGreaterThan(3000)

    const parts = await partsOf(result.blob)
    // the skeleton
    for (const name of [
      '[Content_Types].xml',
      '_rels/.rels',
      'docProps/core.xml',
      'docProps/app.xml',
      'ppt/presentation.xml',
      'ppt/_rels/presentation.xml.rels',
      'ppt/theme/theme1.xml',
      'ppt/slideMasters/slideMaster1.xml',
      'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      'ppt/slideLayouts/slideLayout1.xml',
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
      'ppt/slides/slide1.xml',
      'ppt/slides/_rels/slide1.xml.rels',
      // notes present → notes master + notes slide
      'ppt/notesMasters/notesMaster1.xml',
      'ppt/notesMasters/_rels/notesMaster1.xml.rels',
      'ppt/notesSlides/notesSlide1.xml',
      'ppt/notesSlides/_rels/notesSlide1.xml.rels',
    ]) {
      expect(parts.has(name), `missing part ${name}`).toBe(true)
    }

    // presentation: EMU slide size + slide list + notes master wired
    const pres = xml(parts.get('ppt/presentation.xml')!)
    expect(pres).toContain('<p:sldSz cx="7620000" cy="5715000"/>') // 800×600 px × 9525
    expect(pres).toContain('<p:sldId id="256" r:id="rId2"/>')
    expect(pres).toContain('<p:notesMasterIdLst>')

    // slide: every native element landed, text escaped properly
    const slide = xml(parts.get('ppt/slides/slide1.xml')!)
    expect(slide).toContain('prst="rect"')
    expect(slide).toContain('prst="ellipse"')
    expect(slide).toContain('<a:custGeom>') // the star
    expect(slide).toContain('prst="line"')
    expect(slide).toContain('Segoe UI Emoji')
    expect(slide).toContain('🚀')
    expect(slide).toContain('algn="ctr"')
    expect(slide).toContain('sz="3600"') // 48px × 0.75 × 100
    expect(slide).toContain('&lt;tags&gt; &amp; &quot;quotes&quot;')
    expect(slide).toContain('<a:t>Slide title</a:t>')
    expect(slide).toContain('<a:t>Second line with &lt;tags&gt; &amp; &quot;quotes&quot;</a:t>')
    expect(slide).toContain('val="7d2ae8"')
    // top-left-rotating vs centre-rotating origins: no rotation here →
    // offsets are the plain element box
    expect(slide).toContain('<a:off x="0" y="0"/><a:ext cx="7620000" cy="5715000"/>')

    // slide rels: layout + no images (none used)
    const rels = xml(parts.get('ppt/slides/_rels/slide1.xml.rels')!)
    expect(rels).toContain('slideLayout1.xml')
    expect(rels).not.toContain('media/')

    // content types cover every emitted XML part (rels/media have
    // Defaults; the manifest itself needs no override)
    const ct = xml(parts.get('[Content_Types].xml')!)
    for (const part of parts.keys()) {
      if (part === '[Content_Types].xml') continue
      if (part.endsWith('.rels')) continue
      if (/\.(png|jpe?g)$/.test(part)) continue
      const override = `PartName="/${part}"`
      expect(ct, `content type for ${part}`).toContain(override)
    }

    // notes carry the speaker text, escaped, per line
    const notes = xml(parts.get('ppt/notesSlides/notesSlide1.xml')!)
    expect(notes).toContain('Say the thing about the slide.')
    expect(notes).toContain('Then pause.')
    const notesRels = xml(parts.get('ppt/notesSlides/_rels/notesSlide1.xml.rels')!)
    expect(notesRels).toContain('notesMaster1.xml')
    expect(notesRels).toContain('../slides/slide1.xml')
  })

  it('re-bases rotation origins: top-left rotators shift, centre rotators do not', async () => {
    // same box, same rotation, different origins → different <a:off>
    const rect = createShapeElement('rect', {
      x: 100, y: 50, width: 200, height: 100, fill: '#FF0000',
    })
    rect.rotation = 90
    const ellipse = createShapeElement('ellipse', {
      x: 100, y: 50, width: 200, height: 100, fill: '#00FF00',
    })
    ellipse.rotation = 90

    const result = await exportDesignToPptx({
      designWidth: 400,
      designHeight: 300,
      pages: [page([rect, ellipse])],
    })
    const parts = await partsOf(result.blob)
    const slide = xml(parts.get('ppt/slides/slide1.xml')!)

    // rect (top-left origin): centre after 90° cw around (100,50):
    //   (100 - 50, 50 + 100) = (50, 150) → off = (50-100, 150-50) = (-50, 100)
    expect(slide).toContain('<a:off x="-476250" y="952500"/>') // (-50,100) px × 9525
    // ellipse (centre origin): centre stays (200,100) → off = (100,50)
    expect(slide).toContain('<a:off x="952500" y="476250"/>') // (100,50) px × 9525
    // both carry rot="5400000" (90° × 60000)
    expect(slide.match(/rot="5400000"/g)?.length).toBe(2)
  })

  it('letterboxes per-page sizes onto the deck size (video-export parity)', async () => {
    const text = createTextElement({ x: 0, y: 0, width: 400, text: 'hi', fontSize: 40 })
    // a 400×400 page in an 800×600 deck: f=1.5, offsets (100, 0)
    const result = await exportDesignToPptx({
      designWidth: 800,
      designHeight: 600,
      pages: [{ id: 'p', background: { type: 'solid', color: '#FFF' }, elements: [text], width: 400, height: 400 } as PageData],
    })
    const parts = await partsOf(result.blob)
    const slide = xml(parts.get('ppt/slides/slide1.xml')!)
    // text box: x 0→100 (offset) + 0×1.5, width 400→600
    expect(slide).toContain('<a:off x="952500" y="0"/>') // 100 px
    expect(slide).toMatch(/<a:ext cx="5715000" cy="\d+"\/>/) // 600 px wide
    // font scaled: 40px × 1.5 = 60px → sz 4500
    expect(slide).toContain('sz="4500"')
  })

  it('drops rasters silently in node (no DOM) and still produces a valid deck', async () => {
    // chart element → raster path → skipped without document
    const chart = {
      type: 'chart', id: 'c1', x: 10, y: 10, width: 300, height: 200, rotation: 0,
      opacity: 1, locked: false, visible: true,
      shadow: { enabled: false, color: '#000', blur: 0, offsetX: 0, offsetY: 0 },
      kind: 'bar', data: { labels: ['a', 'b'], values: [1, 2] },
    } as unknown as PageData['elements'][number]
    const result = await exportDesignToPptx({
      designWidth: 400,
      designHeight: 300,
      pages: [page([chart])],
    })
    expect(result.natives).toBe(0)
    expect(result.rasters).toBe(0)
    expect(result.blob.size).toBeGreaterThan(2000)
    const parts = await partsOf(result.blob)
    expect(parts.has('ppt/slides/slide1.xml')).toBe(true)
  })

  it('escapes hostile text and refuses empty designs', async () => {
    const hostile = createTextElement({ x: 0, y: 0, width: 100, text: '<script>alert("x")</script>]]>&', fontSize: 20 })
    const result = await exportDesignToPptx({
      designWidth: 200,
      designHeight: 200,
      pages: [page([hostile])],
    })
    const parts = await partsOf(result.blob)
    const slide = xml(parts.get('ppt/slides/slide1.xml')!)
    expect(slide).toContain('&lt;script&gt;')
    expect(slide).not.toContain('<script>')

    await expect(
      exportDesignToPptx({ designWidth: 200, designHeight: 200, pages: [] }),
    ).rejects.toThrow('no pages')
  })

  it('writes a real deck to /tmp/pptx-smoke.pptx (soffice conversion artifact)', async () => {
    const title = createTextElement({
      x: 60, y: 60, width: 680, text: 'Canvix → PowerPoint', align: 'center', fontSize: 56, bold: true,
    })
    const body = createTextElement({
      x: 80, y: 200, width: 640, text: 'Native text, shapes and notes —\nverified through LibreOffice.', fontSize: 28, align: 'left',
    })
    const rect = createShapeElement('rect', { x: 0, y: 0, width: 800, height: 600, fill: '#1B2A4A' })
    const ellipse = createShapeElement('ellipse', { x: 600, y: 380, width: 180, height: 180, fill: '#02C0CC' })
    const star = createShapeElement('star', { x: 80, y: 380, width: 140, height: 140, fill: '#FFD166' })
    const result = await exportDesignToPptx({
      designWidth: 800,
      designHeight: 600,
      pages: [
        page([rect, title, body, ellipse, star], { notes: 'The smoke deck note.' }),
        page([createShapeElement('rect', { x: 0, y: 0, width: 800, height: 600, fill: '#F4E3C1' })]),
      ],
      title: 'Canvix smoke deck',
    })
    const { writeFileSync } = await import('node:fs')
    writeFileSync('/tmp/pptx-smoke.pptx', Buffer.from(await result.blob.arrayBuffer()))
    expect(result.pages).toBe(2)
    expect(result.natives).toBe(6) // 5 on slide 1 + the background rect on slide 2
  })
})

// ── v0.22: transitions, entrance timing, re-wrap safety, sounds ──

describe('exportDesignToPptx — v0.22 transitions/animations/autofit', () => {
  it('always emits normAutofit (PowerPoint shrinks instead of spilling)', async () => {
    const text = createTextElement({ x: 0, y: 0, width: 300, text: 'wrap safety', fontSize: 30 })
    const result = await exportDesignToPptx({ designWidth: 400, designHeight: 300, pages: [page([text])] })
    const slide = xml((await partsOf(result.blob)).get('ppt/slides/slide1.xml')!)
    expect(slide).toContain('<a:normAutofit/>')
  })

  it('maps fade/slide transitions with speed and directional push', async () => {
    const rect = () => createShapeElement('rect', { x: 0, y: 0, width: 100, height: 100, fill: '#FFF' })
    const result = await exportDesignToPptx({
      designWidth: 400,
      designHeight: 300,
      pages: [
        page([rect()], { transition: { kind: 'fade', duration: 0.9 } }),
        page([rect()], { transition: { kind: 'slide', duration: 2.0, direction: 'left' } }),
        page([rect()]), // none
      ],
    })
    expect(result.transitions).toBe(2)
    const parts = await partsOf(result.blob)
    const s1 = xml(parts.get('ppt/slides/slide1.xml')!)
    const s2 = xml(parts.get('ppt/slides/slide2.xml')!)
    const s3 = xml(parts.get('ppt/slides/slide3.xml')!)
    expect(s1).toContain('<p:transition spd="med"><p:fade/></p:transition>')
    expect(s2).toContain('<p:transition spd="slow"><p:push dir="l"/></p:transition>')
    expect(s3).not.toContain('<p:transition')
    // schema position: transition comes AFTER clrMapOvr, before timing/end
    expect(s1.indexOf('<p:clrMapOvr>')).toBeLessThan(s1.indexOf('<p:transition'))
    expect(s1.indexOf('<p:transition')).toBeLessThan(s1.indexOf('</p:sld>'))
  })

  it('carries entrance animations as one click group with delays', async () => {
    const t1 = createTextElement({ x: 0, y: 0, width: 200, text: 'first', fontSize: 20 })
    const t2 = createTextElement({ x: 0, y: 100, width: 200, text: 'second', fontSize: 20 })
    t1.animation = { kind: 'fade', duration: 0.9, delay: 0, easing: 'easeOut' }
    t2.animation = { kind: 'pan', duration: 0.5, delay: 1.2, easing: 'easeOut', direction: 'left' }
    // rotate is an emphasis loop — documented NOT carried
    const t3 = createTextElement({ x: 0, y: 200, width: 200, text: 'third', fontSize: 20 })
    t3.animation = { kind: 'rotate', duration: 2, delay: 0, easing: 'linear' }
    const result = await exportDesignToPptx({ designWidth: 400, designHeight: 300, pages: [page([t1, t2, t3])] })
    expect(result.animated).toBe(3) // seen by the mapper…
    const slide = xml((await partsOf(result.blob)).get('ppt/slides/slide1.xml')!)
    expect(slide).toContain('<p:timing>')
    expect(slide).toContain('nodeType="clickEffect"')
    expect(slide).toContain('nodeType="withEffect"')
    expect(slide).toContain('delay="1200"') // t2's 1.2 s delay
    expect(slide).toContain('filter="wipeLeft"') // pan left
    expect(slide).toContain('filter="fade"')
    expect(slide).not.toContain('presetClass="emph"') // rotate dropped honestly
    expect(slide).toContain('<p:bldP spid="') // build companions
  })

  it('wires the transition SFX as an embedded wav with an audio rel', async () => {
    const rect = createShapeElement('rect', { x: 0, y: 0, width: 100, height: 100, fill: '#FFF' })
    // a minimal RIFF/WAVE header + payload (the real fetch seam is
    // browser-only; node tests inject bytes — the fontLadderIo posture)
    const wav = new Uint8Array(128)
    wav.set([0x52, 0x49, 0x46, 0x46, 0x7c, 0, 0, 0, 0x57, 0x41, 0x56, 0x45], 0)
    const result = await exportDesignToPptx({
      designWidth: 400,
      designHeight: 300,
      pages: [page([rect], { transition: { kind: 'fade', duration: 0.5, sfxId: 'whoosh-soft' } })],
      sfxIo: { fetchBytes: async () => wav },
    })
    expect(result.sounds).toBe(1)
    const parts = await partsOf(result.blob)
    const slide = xml(parts.get('ppt/slides/slide1.xml')!)
    expect(slide).toContain('<p:sndAc><p:stSnd><p:snd r:embed="rId')
    const rels = xml(parts.get('ppt/slides/_rels/slide1.xml.rels')!)
    expect(rels).toMatch(/relationships\/audio" Target="\.\.\/media\/sfx1\.wav"/)
    const ct = xml(parts.get('[Content_Types].xml')!)
    expect(ct).toContain('<Default Extension="wav" ContentType="audio/x-wav"/>')
    const embedded = parts.get('ppt/media/sfx1.wav')
    expect(embedded).toBeTruthy()
    expect(embedded!.length).toBe(128)
    expect(embedded![0]).toBe(0x52) // 'R' (RIFF)
  })

  it('omits sound machinery when no page has an SFX', async () => {
    const rect = createShapeElement('rect', { x: 0, y: 0, width: 100, height: 100, fill: '#FFF' })
    const result = await exportDesignToPptx({
      designWidth: 400,
      designHeight: 300,
      pages: [page([rect], { transition: { kind: 'fade', duration: 0.5 } })],
    })
    expect(result.sounds).toBe(0)
    const parts = await partsOf(result.blob)
    const ct = xml(parts.get('[Content_Types].xml')!)
    expect(ct).not.toContain('wav')
  })
})

describe('exportDesignToPptx — media part placement (v0.22 fix)', () => {
  it('degrades node image preload to null instead of crashing, and media lands under ppt/media/', async () => {
    // 1×1 red JPEG. In node there is no Image constructor — the
    // preload resolves null (the v0.22 robustness fix) and the image
    // rides the raster/skip path instead of rejecting the export.
    const jpeg =
      'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDIzNP/AABEIAAEAAQMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/aAAwDAQACEQMRAD8A/9k='
    const img = {
      type: 'image', id: 'i1', x: 10, y: 10, width: 80, height: 80, rotation: 0,
      opacity: 1, locked: false, visible: true, src: jpeg, naturalWidth: 1, naturalHeight: 1,
    } as unknown as PageData['elements'][number]
    const result = await exportDesignToPptx({ designWidth: 200, designHeight: 200, pages: [page([img])] })
    // the export completes; in node the image had no decodable bitmap
    expect(result.pages).toBe(1)
    const parts = await partsOf(result.blob)
    expect(parts.has('ppt/slides/slide1.xml')).toBe(true)
    // placement contract: whatever media parts exist live under ppt/media/
    for (const name of parts.keys()) {
      if (name.startsWith('media/')) throw new Error(`media part at package root: ${name}`)
    }
    // the sound part (browser fetch / injected io) lands under ppt/media/
    const wav = new Uint8Array(128)
    wav.set([0x52, 0x49, 0x46, 0x46], 0)
    const rect = createShapeElement('rect', { x: 0, y: 0, width: 10, height: 10, fill: '#FFF' })
    const withSound = await exportDesignToPptx({
      designWidth: 200,
      designHeight: 200,
      pages: [page([rect], { transition: { kind: 'fade', duration: 0.5, sfxId: 'pop' } })],
      sfxIo: { fetchBytes: async () => wav },
    })
    const parts2 = await partsOf(withSound.blob)
    expect(parts2.has('ppt/media/sfx1.wav')).toBe(true)
  })
})
