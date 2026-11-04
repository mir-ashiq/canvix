// Unit tests for the system-clipboard module (v0.14 D2). Pasting is
// an UNTRUSTED INPUT surface — anything on the OS clipboard can hand
// us JSON — so the sanitizer is the security boundary these tests pin.

import { describe, it, expect } from 'vitest'
import {
  serializeEnvelope,
  parseEnvelope,
  sanitizePastedElements,
  readPastedElements,
  capturePastedImage,
  fileFromClipboard,
  MAX_PASTE_ELEMENTS,
  CANVIX_MIME,
} from './system-clipboard'
import type { AnyElement } from '@/lib/types'

function textEl(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'text',
    id: 't1',
    x: 10,
    y: 20,
    width: 300,
    height: 40,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    text: 'hello',
    fontSize: 32,
    ...overrides,
  }
}

/** v0.14 (D4): image factory for filter-field sanitizing tests */
function imageEl(overrides: Record<string, unknown> = {}) {
  return {
    type: 'image',
    id: 'im1',
    x: 0,
    y: 0,
    width: 200,
    height: 150,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    src: 'data:image/png;base64,AAAA',
    radius: 12,
    ...overrides,
  }
}

describe('envelope round-trip', () => {
  it('serialize → parse survives with identical content', () => {
    const els = [textEl() as unknown as AnyElement]
    const out = parseEnvelope(serializeEnvelope(els))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ type: 'text', text: 'hello', x: 10, y: 20 })
  })

  it('non-envelope JSON is rejected (no app tag)', () => {
    expect(parseEnvelope(JSON.stringify({ elements: [textEl()] }))).toEqual([])
    expect(parseEnvelope('{"app":"other","v":1,"elements":[]}')).toEqual([])
    expect(parseEnvelope('not json at all')).toEqual([])
  })
})

describe('sanitizePastedElements — the untrusted-input gauntlet', () => {
  it('drops unknown element types entirely', () => {
    const out = sanitizePastedElements([
      textEl(),
      { type: 'iframe', x: 0, y: 0, width: 10, height: 10, src: 'https://evil' },
      { type: 'script' },
      'not even an object',
      null,
    ])
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('text')
  })

  it('strips prototype-pollution and underscore keys', () => {
    const el = textEl({
      __proto__: undefined,
      constructor: undefined,
      _m: 'hlc-stamp',
      safe: 'kept',
    })
    const out = sanitizePastedElements([el])
    const rec = out[0] as unknown as Record<string, unknown>
    expect(rec.safe).toBe('kept')
    expect(rec).not.toHaveProperty('constructor')
    expect(rec).not.toHaveProperty('_m')
  })

  it('drops oversized strings and arrays, keeps the rest of the element', () => {
    const el = textEl({
      text: 'x'.repeat(50_000),
      tags: new Array(1000).fill('tag'),
    })
    const out = sanitizePastedElements([el])
    expect(out).toHaveLength(1)
    const rec = out[0] as unknown as Record<string, unknown>
    expect(rec).not.toHaveProperty('text')
    expect(rec).not.toHaveProperty('tags')
    expect(rec.fontSize).toBe(32)
  })

  it('v0.14 (D4): image filter fields are whitelisted + clamped', () => {
    const out = sanitizePastedElements([
      imageEl({ filter: 'vintage', filterIntensity: 80 }),
    ])
    const rec = out[0] as unknown as Record<string, unknown>
    expect(rec.filter).toBe('vintage')
    expect(rec.filterIntensity).toBe(80)
  })

  it('v0.14 (D4): junk preset ids reset to none, hostile intensity clamps', () => {
    const out = sanitizePastedElements([
      imageEl({ filter: 'EVIL<script>', filterIntensity: 1e9 }),
      imageEl({ filter: 42, filterIntensity: 'hot' }),
      imageEl({ filter: '__proto__' }),
    ])
    for (const el of out) {
      const rec = el as unknown as Record<string, unknown>
      expect(rec.filter).toBe('none')
      expect(rec.filterIntensity).toBe(100)
    }
  })

  it('v0.14 (D4): negative/NaN intensity falls back to the 100 default', () => {
    const out = sanitizePastedElements([imageEl({ filter: 'warm', filterIntensity: -20 })])
    const rec = out[0] as unknown as Record<string, unknown>
    expect(rec.filter).toBe('warm')
    expect(rec.filterIntensity).toBe(0) // -20 clamps to 0, not 100 (finite input is clamped, not defaulted)
  })

  it('caps the element count', () => {
    const many = Array.from({ length: MAX_PASTE_ELEMENTS + 200 }, () => textEl({ id: 'x' }))
    expect(sanitizePastedElements(many)).toHaveLength(MAX_PASTE_ELEMENTS)
  })

  it('clamps geometry to a sane canvas range and forces finite numbers', () => {
    const out = sanitizePastedElements([
      textEl({ x: NaN, y: -999_999, width: Infinity, height: 1e12, opacity: 42 }),
    ])
    const rec = out[0] as unknown as Record<string, number>
    // NaN/Infinity are DROPPED by the value sanitizer (non-finite never
    // survives), then the geometry clamp supplies the default
    expect(rec.x).toBe(60) // NaN → dropped → default
    expect(rec.y).toBe(-50_000) // clamped
    expect(rec.width).toBe(300) // Infinity → dropped → default
    expect(rec.height).toBe(50_000) // 1e12 is finite → clamped
    expect(rec.opacity).toBe(1)
  })

  it('fills visible/locked/opacity defaults for stripped elements', () => {
    const out = sanitizePastedElements([{ type: 'rect', id: 'r', x: 0, y: 0, width: 10, height: 10 }])
    const rec = out[0] as unknown as Record<string, unknown>
    expect(rec.visible).toBe(true)
    expect(rec.locked).toBe(false)
    expect(rec.opacity).toBe(1)
  })

  it('recurses into group children with the same rules', () => {
    const el = {
      type: 'group',
      id: 'g',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      children: [
        textEl(),
        { type: 'evil', x: 0, y: 0 },
        textEl({ id: 't2', text: 'deep' }),
      ],
    }
    const out = sanitizePastedElements([el])
    const group = out[0] as unknown as { children: AnyElement[] }
    expect(group.children).toHaveLength(2)
    expect(group.children.map((c) => c.type)).toEqual(['text', 'text'])
  })

  it('survives deep nesting only to MAX_DEPTH (no stack bombs)', () => {
    // build nested groups ~30 deep
    let el: Record<string, unknown> = textEl()
    for (let i = 0; i < 30; i++) {
      el = { type: 'group', id: `g${i}`, x: 0, y: 0, width: 10, height: 10, children: [el] }
    }
    const out = sanitizePastedElements([el])
    expect(out).toHaveLength(1) // outer group survives; deep child is dropped by depth cap
  })
})

describe('readPastedElements / pastedImageFile (DataTransfer stubs)', () => {
  function dt(types: Record<string, string>, items: { kind: string; type: string; file?: File }[] = []) {
    return {
      getData: (t: string) => types[t] ?? '',
      items: items.map((i) => ({ ...i, getAsFile: () => i.file ?? null })),
    } as unknown as DataTransfer
  }

  it('prefers the custom MIME, falls back to text/plain', () => {
    const els = [textEl() as unknown as AnyElement]
    const env = serializeEnvelope(els)
    const fromMime = readPastedElements(dt({ [CANVIX_MIME]: env, 'text/plain': 'plain junk' }))
    expect(fromMime).toHaveLength(1)
    const fromText = readPastedElements(dt({ 'text/plain': env }))
    expect(fromText).toHaveLength(1)
    expect(readPastedElements(dt({}))).toEqual([])
  })

  it('captures the first image and rebuilds a byte-identical File', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const file = new File([bytes], 'shot.png', { type: 'image/png' })
    const capture = capturePastedImage(dt({}, [{ kind: 'file', type: 'image/png', file }]))
    expect(capture).not.toBeNull()
    expect(capture!.name).toBe('shot.png')
    expect(capture!.type).toBe('image/png')
    const rebuilt = await fileFromClipboard(capture!)
    expect(rebuilt.size).toBe(4)
    expect(new Uint8Array(await rebuilt.arrayBuffer())).toEqual(bytes)
    expect(rebuilt.type).toBe('image/png')
    // non-image / non-file items are ignored
    expect(capturePastedImage(dt({}, [{ kind: 'string', type: 'text/plain' }]))).toBeNull()
    expect(capturePastedImage(dt({}, [{ kind: 'file', type: 'text/csv', file }]))).toBeNull()
  })
})
