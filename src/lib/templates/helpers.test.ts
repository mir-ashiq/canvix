import { describe, expect, it } from 'vitest'
import { GRAPHICS } from '../editor-utils'
import { BASE_TEMPLATES } from './index'
import { gr } from './helpers'

/**
 * Two shipped templates call `gr('star')`, but the GRAPHICS catalogue
 * had no `star` entry. `gr()` silently fell back to GRAPHICS[0] (the
 * heart), so those templates rendered a heart where a star was meant.
 * Pin the catalogue entry and guard every template against unresolved
 * graphic ids so the silent fallback cannot hide another gap.
 */
describe('template graphics', () => {
  it("gr('star') resolves to the star graphic, not the heart fallback", () => {
    const star = GRAPHICS.find((g) => g.id === 'star')
    expect(star, 'GRAPHICS must contain a star entry').toBeDefined()
    expect(gr('star', {}).pathData).toBe(star?.path)
    expect(star?.path).not.toBe(GRAPHICS[0].path)
  })

  it('every path element in the built-in templates uses a known graphic', () => {
    const knownPaths = new Set(GRAPHICS.map((g) => g.path))
    const unknown = new Set<string>()

    for (const template of BASE_TEMPLATES) {
      for (const page of template.pages) {
        for (const el of page.elements) {
          if (el.type === 'path' && el.pathData && !knownPaths.has(el.pathData)) {
            unknown.add(`${template.slug}: ${el.pathData}`)
          }
        }
      }
    }

    expect([...unknown]).toEqual([])
  })
})
