import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Sound wave tests for the offline SFX pack + the sfxId plumbing:
//   1. catalogue integrity — unique ids, sane fields, ids are
//      filesystem-safe (they become /sfx/<id>.wav URLs)
//   2. every catalogue id has a real WAV file on disk (the pack
//      ships in public/sfx — a missing file would 404 at play time)
//   3. every file is a parseable RIFF/WAVE mono 16-bit PCM at 44.1 kHz
//   4. sanitizeAnimation / sanitizePageTransition accept known ids,
//      DROP unknown ones (hostile input can only pick bundled files)
//   5. the player validates ids and no-ops in Node (no Audio)

import { SFX_PACK, SFX_CATEGORIES, isSfxId, sfxById, sfxUrl } from './sfx-pack'
import { sanitizeAnimation, sanitizePageTransition } from '@/lib/animations'
import { playSfx, resetSfxPlayer } from '@/lib/sfx'

const SFX_DIR = join(process.cwd(), 'public', 'sfx')

describe('sfx pack catalogue', () => {
  it('16 sounds across 4 categories, unique safe ids', () => {
    expect(SFX_PACK).toHaveLength(16)
    const ids = new Set(SFX_PACK.map((s) => s.id))
    expect(ids.size).toBe(SFX_PACK.length)
    for (const s of SFX_PACK) {
      expect(s.id).toMatch(/^[a-z0-9-]+$/)
      expect(s.label.length).toBeGreaterThan(0)
      expect(s.seconds).toBeGreaterThan(0)
      expect(s.seconds).toBeLessThanOrEqual(1.5)
      expect(Object.keys(SFX_CATEGORIES)).toContain(s.category)
    }
  })

  it('every id has a real WAV file on disk', () => {
    for (const s of SFX_PACK) {
      const file = join(SFX_DIR, `${s.id}.wav`)
      expect(existsSync(file), `public/sfx/${s.id}.wav must exist`).toBe(true)
    }
  })

  it('every file is RIFF/WAVE, mono, 16-bit, 44.1 kHz', () => {
    for (const s of SFX_PACK) {
      const buf = readFileSync(join(SFX_DIR, `${s.id}.wav`))
      expect(buf.toString('ascii', 0, 4)).toBe('RIFF')
      expect(buf.toString('ascii', 8, 12)).toBe('WAVE')
      expect(buf.readUInt16LE(22)).toBe(1) // mono
      expect(buf.readUInt32LE(24)).toBe(44100)
      expect(buf.readUInt16LE(34)).toBe(16) // bits per sample
      // the catalogue duration matches the file payload
      const seconds = buf.readUInt32LE(40) / 2 / 44100
      expect(Math.abs(seconds - s.seconds)).toBeLessThan(0.05)
    }
  })

  it('isSfxId / sfxById / sfxUrl behave', () => {
    expect(isSfxId('chime')).toBe(true)
    expect(isSfxId('not-a-sound')).toBe(false)
    expect(isSfxId(42)).toBe(false)
    expect(isSfxId(undefined)).toBe(false)
    expect(sfxById('pop')?.label).toBe('Pop')
    expect(sfxById('missing')).toBeUndefined()
    expect(sfxUrl('pop')).toBe('/sfx/pop.wav')
  })
})

describe('sfxId sanitization', () => {
  it('sanitizeAnimation keeps a known id and drops unknown/hostile ones', () => {
    const good = sanitizeAnimation({ kind: 'fade', duration: 0.8, delay: 0, easing: 'easeOut', sfxId: 'whoosh-soft' })
    expect(good?.sfxId).toBe('whoosh-soft')

    expect(sanitizeAnimation({ kind: 'fade', duration: 0.8, delay: 0, easing: 'easeOut', sfxId: '../../etc/passwd' })?.sfxId).toBeUndefined()
    expect(sanitizeAnimation({ kind: 'fade', duration: 0.8, delay: 0, easing: 'easeOut', sfxId: 42 as unknown as string })?.sfxId).toBeUndefined()
    // pre-sound documents (no sfxId) stay byte-shape-compatible: the
    // key is simply absent, not null
    const legacy = sanitizeAnimation({ kind: 'fade', duration: 0.8, delay: 0, easing: 'easeOut' })
    expect(legacy).not.toHaveProperty('sfxId')
  })

  it('sanitizePageTransition clamps and keeps/drops sfxId', () => {
    const good = sanitizePageTransition({ kind: 'slide', duration: 0.7, direction: 'left', sfxId: 'swoosh-reverse' })
    expect(good).toEqual({ kind: 'slide', duration: 0.7, direction: 'left', sfxId: 'swoosh-reverse' })

    expect(sanitizePageTransition({ kind: 'fade', duration: 99, sfxId: 'nope' })).toEqual({ kind: 'fade', duration: 2.5 })
    expect(sanitizePageTransition({ kind: 'none' })).toBeUndefined()
    expect(sanitizePageTransition('garbage' as unknown as object)).toBeUndefined()
  })
})

describe('sfx player (Node — no Audio global)', () => {
  it('playSfx no-ops safely for unknown ids and without Audio', () => {
    resetSfxPlayer()
    expect(() => playSfx('chime')).not.toThrow()
    expect(() => playSfx('not-a-sound')).not.toThrow()
    expect(() => playSfx('pop', 5)).not.toThrow()
  })
})
