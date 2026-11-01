import { describe, expect, it } from 'vitest'
import { presenceKey } from './presence-diff'

/**
 * v0.11.5 (F4): the stream pump diffs presence per tick with presenceKey.
 * Contract under test — the key changes iff what the client RENDERS changes:
 *   changes: join, leave, name, color, cursor (content)
 *   silent : lastSeen bumps, row reordering, cursor key order, null vs
 *            undefined cursor
 * A false "change" costs a spurious frame per heartbeat and defeats the
 * v0.9.2 idle backoff; a false "same" costs an invisible collaborator.
 */

const alice = { id: 'p_alice', name: 'Alice', color: '#FF5C8A', cursor: null }
const bob = { id: 'p_bob', name: 'Bob', color: '#00C4CC', cursor: null }

describe('presenceKey', () => {
  it('is stable for identical snapshots', () => {
    expect(presenceKey([alice, bob])).toBe(presenceKey([alice, bob]))
  })

  it('is stable for empty snapshots', () => {
    expect(presenceKey([])).toBe(presenceKey([]))
  })

  it('changes when a collaborator joins', () => {
    expect(presenceKey([alice])).not.toBe(presenceKey([alice, bob]))
  })

  it('changes when a collaborator leaves', () => {
    expect(presenceKey([alice, bob])).not.toBe(presenceKey([alice]))
  })

  it('changes when a display name changes', () => {
    expect(presenceKey([alice])).not.toBe(presenceKey([{ ...alice, name: 'Alice II' }]))
  })

  it('changes when a color changes', () => {
    expect(presenceKey([alice])).not.toBe(presenceKey([{ ...alice, color: '#7630D7' }]))
  })

  it('changes when a cursor appears or moves', () => {
    const idle = presenceKey([alice])
    const page1 = presenceKey([{ ...alice, cursor: { page: 0, x: 10, y: 20 } }])
    const moved = presenceKey([{ ...alice, cursor: { page: 0, x: 30, y: 20 } }])
    expect(idle).not.toBe(page1)
    expect(page1).not.toBe(moved)
  })

  it('changes when a cursor selection changes', () => {
    const plain = presenceKey([{ ...bob, cursor: { page: 0, x: 1, y: 2 } }])
    const selecting = presenceKey([
      { ...bob, cursor: { page: 0, x: 1, y: 2, selection: ['el_1'] } },
    ])
    expect(plain).not.toBe(selecting)
  })

  it('ignores row order (lastSeen-desc reordering on heartbeats)', () => {
    expect(presenceKey([alice, bob])).toBe(presenceKey([bob, alice]))
  })

  it('ignores lastSeen entirely (heartbeats must stay silent)', () => {
    // lastSeen is not part of the type on purpose — prove extra fields
    // cannot leak into the key
    const withStale = [{ ...alice, lastSeen: new Date('2026-01-01') }] as never[]
    const withFresh = [{ ...alice, lastSeen: new Date('2026-12-31') }] as never[]
    expect(presenceKey(withStale)).toBe(presenceKey(withFresh))
  })

  it('treats null and undefined cursors as equal', () => {
    expect(presenceKey([alice])).toBe(
      presenceKey([{ id: 'p_alice', name: 'Alice', color: '#FF5C8A', cursor: undefined }]),
    )
  })

  it('ignores cursor object key order', () => {
    const a = presenceKey([{ ...alice, cursor: { page: 0, x: 1, y: 2, selection: ['a', 'b'] } }])
    const b = presenceKey([{ ...alice, cursor: { selection: ['a', 'b'], y: 2, x: 1, page: 0 } }])
    expect(a).toBe(b)
  })

  it('does not let field values blur into each other', () => {
    // distinct separators must keep (id, name) pairs unambiguous
    const one = [{ id: 'ab', name: 'c', color: '#111111', cursor: null }]
    const two = [
      { id: 'a', name: 'bc', color: '#111111', cursor: null },
    ]
    expect(presenceKey(one)).not.toBe(presenceKey(two))
  })
})
