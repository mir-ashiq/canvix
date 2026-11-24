// design-spec/parse.ts — the shared structured-output parser.
// Extraction (fences, prose, trailing commas), hostile coercion,
// and the exact-text passthrough guarantee.
import { describe, expect, it } from 'vitest'
import { extractJsonObject, parseSpecResponse, SPEC_MODEL_TEXT_CAP } from './parse'
import type { DesignSpec } from './types'

function validSpecJson(): string {
  return JSON.stringify({
    version: 'v2',
    name: 'Poster',
    format: { width: 1080, height: 1080, preset: 'poster' },
    palette: { seeds: ['#090B1A', '#8B5CF6', '#22D3EE'], mood: 'neutral' },
    typography: { scale: 1.333 },
    blocks: [
      {
        kind: 'hero',
        weight: 1,
        content: [
          { role: 'headline', source: 'user-required', text: 'Design Beyond Limits' },
          { role: 'subline', source: 'model', text: 'Create smarter. Design faster.', maxWords: 5 },
        ],
      },
    ],
  })
}

describe('extractJsonObject', () => {
  it('accepts pre-parsed objects', () => {
    expect(extractJsonObject({ a: 1 })).toEqual({ a: 1 })
  })
  it('strips ```json fences', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })
  it('recovers the object from surrounding prose', () => {
    expect(extractJsonObject('Sure! Here is your design: {"a":1} hope it helps')).toEqual({ a: 1 })
  })
  it('repairs trailing commas', () => {
    expect(extractJsonObject('{"a":1,}')).toEqual({ a: 1 })
  })
  it('returns null on garbage', () => {
    expect(extractJsonObject('no json here at all')).toBeNull()
    expect(extractJsonObject(42)).toBeNull()
    expect(extractJsonObject('')).toBeNull()
  })
})

describe('parseSpecResponse', () => {
  it('parses a well-formed spec', () => {
    const r = parseSpecResponse(validSpecJson(), 1080, 1080)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.spec.format).toMatchObject({ width: 1080, height: 1080, preset: 'poster' })
    expect(r.spec.palette.seeds).toEqual(['#090B1A', '#8B5CF6', '#22D3EE'])
    expect(r.spec.blocks).toHaveLength(1)
    expect(r.spec.blocks[0].content).toHaveLength(2)
  })

  it('preserves user-required text EXACTLY — no case folding, no slicing', () => {
    const r = parseSpecResponse(validSpecJson(), 1080, 1080)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const slot = r.spec.blocks[0].content[0]
    expect(slot.source).toBe('user-required')
    expect(slot.text).toBe('Design Beyond Limits')
  })

  it('caps model slot text but never required slot text', () => {
    const long = 'x'.repeat(900)
    const json = JSON.stringify({
      format: { width: 1080, height: 1080 },
      blocks: [
        {
          kind: 'hero',
          content: [
            { role: 'body', source: 'model', text: long },
            { role: 'headline', source: 'user-required', text: long },
          ],
        },
      ],
    })
    const r = parseSpecResponse(json)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const [model, required] = r.spec.blocks[0].content
    expect(model.text.length).toBe(SPEC_MODEL_TEXT_CAP)
    expect(required.text.length).toBe(900)
  })

  it('coerces hostile input: numbers as strings, bad hexes, unknown kinds', () => {
    const json = JSON.stringify({
      name: 42,
      format: { width: '1080', height: 1080 },
      palette: { seeds: ['#090B1A', 'red', 7], mood: 'spooky' },
      blocks: [
        { kind: 'hologram', content: [{ role: 'headline', text: 'x' }] },
        { kind: 'hero', weight: 99, content: [{ role: 'headline', source: 'user-required', text: 'OK' }] },
      ],
    })
    const r = parseSpecResponse(json)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const spec: DesignSpec = r.spec
    expect(spec.name).toBe('AI design') // number name → default, never a crash
    expect(spec.format.width).toBe(1080)
    expect(spec.palette.seeds).toEqual(['#090B1A'])
    expect(spec.palette.mood).toBe('neutral')
    expect(spec.blocks).toHaveLength(1)
    expect(spec.blocks[0].weight).toBe(3)
  })

  it('fails honestly when no usable blocks exist', () => {
    const r = parseSpecResponse('{"format":{"width":100}}')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('no usable blocks')
  })

  it('drops slots with empty text', () => {
    const json = JSON.stringify({
      blocks: [{ kind: 'hero', content: [{ role: 'body', text: '   ' }, { role: 'body', text: 'Real' }] }],
    })
    const r = parseSpecResponse(json)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.spec.blocks[0].content).toHaveLength(1)
  })

  it('snaps scale to the nearest legal value and validates fonts', () => {
    const json = JSON.stringify({
      typography: { heading: 'Not A Font', body: 'Inter', scale: 1.6 },
      blocks: [{ kind: 'hero', content: [{ role: 'body', text: 'x' }] }],
    })
    const r = parseSpecResponse(json)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.spec.typography.heading).toBeUndefined()
    expect(r.spec.typography.body).toBe('Inter')
    expect(r.spec.typography.scale).toBe(1.618)
  })
})
