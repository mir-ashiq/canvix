/**
 * v0.32.7 · EDIT INTENT — the deterministic classifier's contract.
 * "Not every instruction on a populated canvas is an addition."
 */
import { describe, expect, it } from 'vitest'
import { classifyEditIntent, intentRequiresPlan, intentGuidance } from './intent'
import type { AgentDesignCtx } from './context'

const EMPTY: AgentDesignCtx = { name: 'Blank', width: 1080, height: 1080, elements: [] }
const POPULATED: AgentDesignCtx = {
  name: 'Coffee launch',
  width: 1080,
  height: 1080,
  elements: [{ id: 'a', type: 'text', x: 100, y: 65, width: 800, height: 200, text: 'Sip the Future' }],
}

describe('intent · classification', () => {
  it('an empty canvas is always a create', () => {
    expect(classifyEditIntent('recolor the background', EMPTY)).toMatchObject({ intent: 'create' })
    expect(classifyEditIntent('whatever', EMPTY).intent).toBe('create')
  })

  it('additive language on a populated canvas is an add', () => {
    expect(classifyEditIntent('Add a CTA button below the headline', POPULATED).intent).toBe('add')
    expect(classifyEditIntent('insert a footer with hashtags', POPULATED).intent).toBe('add')
  })

  it('replacement language is a replace', () => {
    expect(classifyEditIntent('Replace the headline with "Grand Opening"', POPULATED).intent).toBe('replace')
    expect(classifyEditIntent('swap the subline for a shorter tagline', POPULATED).intent).toBe('replace')
  })

  it('positioning language is a reposition (no plan, ever)', () => {
    expect(classifyEditIntent('Move the headline down 40px', POPULATED).intent).toBe('reposition')
    expect(classifyEditIntent('center the title', POPULATED).intent).toBe('reposition')
    expect(classifyEditIntent('align the cards', POPULATED).intent).toBe('reposition')
  })

  it('styling language is a restyle (no plan)', () => {
    expect(classifyEditIntent('Recolor the background to dark navy', POPULATED).intent).toBe('restyle')
    expect(classifyEditIntent('make the headline bold and bigger', POPULATED).intent).toBe('restyle')
    expect(classifyEditIntent('change the font to Montserrat', POPULATED).intent).toBe('restyle')
  })

  it('rebuild language is a redesign (destructive, plan first)', () => {
    expect(classifyEditIntent('redesign this from scratch as a food festival poster', POPULATED).intent).toBe('redesign')
    expect(classifyEditIntent('start over with a completely different layout', POPULATED).intent).toBe('redesign')
  })

  it('removal language is a remove (no plan)', () => {
    expect(classifyEditIntent('delete the footer', POPULATED).intent).toBe('remove')
    expect(classifyEditIntent('get rid of the sticker', POPULATED).intent).toBe('remove')
  })

  it('review language is a review', () => {
    expect(classifyEditIntent('What is wrong with this design?', POPULATED).intent).toBe('review')
    expect(classifyEditIntent('review the contrast', POPULATED).intent).toBe('review')
  })

  it('the live defect: "check for overlaps and fix any issues" is a REFINE, not a review or an add', () => {
    const r = classifyEditIntent('Check the design for overlaps and errors, fix any issues, verify it matches the brief, then stop', POPULATED)
    expect(r.intent).toBe('refine')
    expect(r.reason).toBe('fix language on an existing design')
  })

  it('polish language is a refine', () => {
    expect(classifyEditIntent('Make this design more professional', POPULATED).intent).toBe('refine')
    expect(classifyEditIntent('polish the spacing', POPULATED).intent).toBe('refine')
  })

  it('no matching verb on a populated canvas defaults to refine (never an unrequested rebuild)', () => {
    expect(classifyEditIntent('the coffee launch promo', POPULATED).intent).toBe('refine')
  })
})

describe('intent · the plan-first gate respects the intent', () => {
  it('create / add / redesign require a plan', () => {
    expect(intentRequiresPlan('create')).toBe(true)
    expect(intentRequiresPlan('add')).toBe(true)
    expect(intentRequiresPlan('redesign')).toBe(true)
  })
  it('replace / reposition / restyle / remove / refine / review never need a section plan', () => {
    for (const i of ['replace', 'reposition', 'restyle', 'remove', 'refine', 'review'] as const) {
      expect(intentRequiresPlan(i)).toBe(false)
    }
  })
})

describe('intent · guidance', () => {
  it('every intent has concrete guidance mentioning its tool verbs', () => {
    expect(intentGuidance('add')).toContain('ADDITIONS ONLY')
    expect(intentGuidance('reposition')).toContain('move_elements')
    expect(intentGuidance('restyle')).toContain('No plan_layout')
    expect(intentGuidance('redesign')).toContain('clear_page')
    expect(intentGuidance('remove')).toContain('delete_elements')
    expect(intentGuidance('refine')).toContain('polish')
    expect(intentGuidance('review')).toContain('read-only')
  })
})
