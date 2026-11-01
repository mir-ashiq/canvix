import { describe, expect, it } from 'vitest'
import { interactionMode } from './editor-utils'

/**
 * v0.11.6 (QA finding F3): the top-bar "Editing mode" control and the
 * Tools-panel Select/Draw toggle held separate state and could disagree —
 * "Draw" pressed while the canvas behaved as read-only Select. Both now
 * label the SAME derivation (interactionMode), so these truth-table rows
 * pin the contract the two controls can no longer violate.
 */
describe('interactionMode', () => {
  it('editing + select → editing (the default canvas mode)', () => {
    expect(interactionMode('editing', 'select')).toBe('editing')
  })

  it('editing + draw → draw (brush active — the top bar must say so)', () => {
    expect(interactionMode('editing', 'draw')).toBe('draw')
  })

  it('viewing wins over any tool — read-only is read-only', () => {
    expect(interactionMode('viewing', 'select')).toBe('viewing')
    expect(interactionMode('viewing', 'draw')).toBe('viewing')
  })

  it('covers exactly three modes (no hidden fourth state)', () => {
    const modes = new Set(
      (['editing', 'viewing'] as const).flatMap((m) =>
        (['select', 'draw'] as const).map((t) => interactionMode(m, t)),
      ),
    )
    expect([...modes].sort()).toEqual(['draw', 'editing', 'viewing'])
  })
})
