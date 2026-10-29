// ─────────────────────────────────────────────────────────────
// v0.10 offline merge — pure merge semantics
//
// The convergence contract: for ANY pair of divergent replicas, merging
// A-into-B and B-into-A produces the same document. These tests lock the
// per-element LWW + tombstone rules that both the client (remote op
// application, pages:replace) and the server (divergent PUT) rely on.
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest'
import { compareHlc, formatHlc } from './hlc'
import {
  isUnstamped,
  mergeElements,
  mergePages,
  stampElementDeep,
  stampPage,
  stampPages,
} from './merge'
import type { AnyElement, PageData } from '@/lib/types'

let tick = 0
function h(actor: string): string {
  tick += 1
  return formatHlc(1770000000000 + tick, 1, actor)
}

function el(id: string, text: string, _m?: string): AnyElement {
  return { type: 'text', id, text, x: 10, y: 10, _m } as unknown as AnyElement
}

function page(id: string, elements: AnyElement[], extra?: Partial<PageData>): PageData {
  return { id, background: { type: 'solid', color: '#FFFFFF' }, elements, ...extra }
}

describe('mergeElements', () => {
  it('disjoint edits merge as a union (both survive)', () => {
    const a = el('e1', 'A text', h('a'))
    const b = el('e2', 'B text', h('b'))
    const { elements } = mergeElements([a], [b], {}, {})
    expect(elements.map((e) => e.id).sort()).toEqual(['e1', 'e2'])
  })

  it('same element: the newer stamp wins, regardless of merge direction', () => {
    const ours = el('e1', 'old text', h('a'))
    const theirs = el('e1', 'new text', h('b'))
    const ab = mergeElements([ours], [theirs], {}, {}).elements
    const ba = mergeElements([theirs], [ours], {}, {}).elements
    expect((ab[0] as { text: string }).text).toBe('new text')
    expect((ba[0] as { text: string }).text).toBe('new text')
  })

  it('delete-vs-edit: newer write wins in both directions', () => {
    // OURS deleted e1 (tombstone newer than their edit)
    const editA = el('e1', 'edited by A', h('a'))
    const tombB = h('b') // later stamp
    const ab = mergeElements([editA], [], {}, { e1: tombB }).elements
    expect(ab).toHaveLength(0) // delete wins
    const ba = mergeElements([], [editA], { e1: tombB }, {}).elements
    expect(ba).toHaveLength(0) // same verdict from the other side

    // THEIR edit is newer than our delete → edit wins
    const tombOld = h('a')
    const editNew = el('e1', 'newer edit', h('b'))
    const keep = mergeElements([], [editNew], { e1: tombOld }, {}).elements
    expect(keep).toHaveLength(1)
  })

  it('re-add after delete clears the tombstone (newer stamp resurrects)', () => {
    const tomb = h('a')
    const readded = el('e1', 'reborn', h('b'))
    const out = mergeElements([readded], [], { e1: tomb }, {})
    expect(out.elements).toHaveLength(1)
    // and the merged tombstones keep the max for ids that stay dead
    const out2 = mergeElements([], [], { e1: tomb, e2: h('a') }, { e2: h('b') })
    expect(out2.tombstones.e2).toBeTruthy()
    expect(compareHlc(out2.tombstones.e2, out2.tombstones.e1)).toBeGreaterThan(0)
  })

  it('tombstones merge pointwise to the max stamp', () => {
    const t1 = h('a')
    const t2 = h('b')
    const { tombstones } = mergeElements([], [], { x: t1, y: t2 }, { x: t2, z: t1 })
    expect(tombstones.x).toBe(t2)
    expect(tombstones.y).toBe(t2)
    expect(tombstones.z).toBe(t1)
  })

  it('legacy unstamped data loses to any stamped write', () => {
    const legacy = el('e1', 'from 2026')
    const stamped = el('e1', 'stamped edit', h('a'))
    const out = mergeElements([legacy], [stamped], {}, {}).elements
    expect((out[0] as { text: string }).text).toBe('stamped edit')
    // two legacy copies → ours wins (stability, no churn)
    const legacy2 = el('e1', 'other legacy')
    const out2 = mergeElements([legacy], [legacy2], {}, {}).elements
    expect((out2[0] as { text: string }).text).toBe('from 2026')
  })
})

describe('mergePages', () => {
  it('page sets union; matched pages element-merge', () => {
    const ours = [page('p1', [el('a', 'a', h('x'))]), page('p2', [el('b', 'b', h('x'))])]
    const theirs = [page('p1', [el('a', 'a2', h('y')), el('c', 'c', h('y'))]), page('p3', [el('d', 'd', h('y'))])]
    const merged = mergePages(ours, theirs)
    expect(merged.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
    const p1 = merged[0]
    expect(p1.elements.map((e) => e.id).sort()).toEqual(['a', 'c'])
    const p2 = merged[1]
    expect(p2.elements.map((e) => e.id)).toEqual(['b'])
  })

  it('page meta (background) LWW by _pm', () => {
    const ours = page('p1', [], { _pm: h('a'), background: { type: 'solid', color: '#111111' } })
    const theirs = page('p1', [], { _pm: h('b'), background: { type: 'solid', color: '#222222' } })
    const merged = mergePages([ours], [theirs])
    expect((merged[0].background as { color: string }).color).toBe('#222222')
    // reverse direction — same winner
    const merged2 = mergePages([theirs], [ours])
    expect((merged2[0].background as { color: string }).color).toBe('#222222')
  })

  it('element tombstones survive page merges', () => {
    // tombstone (t=200) is NEWER than the attempted re-add (t=100)
    const ours = page('p1', [el('keep', 'k', '0000000100:00001:a')], {
      tombstones: { dead: '0000000200:00001:a' },
    })
    const theirs = page('p1', [el('dead', 'resurrected?', '0000000100:00001:a')])
    const merged = mergePages([ours], [theirs])
    expect(merged[0].elements.map((e) => e.id)).toEqual(['keep'])
    expect(merged[0].tombstones?.dead).toBeTruthy()
    // reverse direction — same verdict
    const merged2 = mergePages([theirs], [ours])
    expect(merged2[0].elements.map((e) => e.id)).toEqual(['keep'])
    expect(merged2[0].tombstones?.dead).toBeTruthy()
  })

  it('convergence: A∘B === B∘A on a mixed divergence scenario', () => {
    // Build a realistic divergence: shared base + each side's edits.
    // One element per id per side (well-formed replica invariant).
    const baseEl = el('shared', 'base') // unstamped shared base
    const ours = [
      page(
        'p1',
        [baseEl, el('only-ours', 'ours', '0000000100:00001:a')],
        { tombstones: { gone: '0000000300:00001:a' } },
      ),
      page('p2', [el('p2el', 'v1', '0000000100:00002:a')]),
    ]
    const theirs = [
      page(
        'p1',
        [
          el('shared', 'theirs edited', '0000000200:00001:b'),
          el('gone', 're-add attempt', '0000000100:00001:a'), // older than the tombstone
          el('fresh', 'theirs new', '0000000150:00001:b'),
        ],
        { _pm: '0000000200:00002:b' },
      ),
      page('p3', [el('p3el', 'theirs', '0000000200:00003:b')]),
    ]
    const ab = mergePages(ours, theirs)
    const ba = mergePages(theirs, ours)
    // CONTENT converges in both directions: same page set, same element set,
    // same winner per element id. (Array ORDER follows the "ours" side —
    // z-order arbitration is the server's job: its merge direction is fixed
    // because the stored document is always "ours" there, so the canonical
    // order is whatever the next autosave persists. Concurrent reorders on
    // one page may differ transiently per replica until then — documented.)
    const canon = (pages: PageData[]) =>
      JSON.stringify(
        [...pages]
          .sort((x, y) => (x.id < y.id ? -1 : 1))
          .map((p) => ({
            id: p.id,
            _pm: p._pm ?? '',
            background: p.background,
            tombstones: p.tombstones ?? {},
            elements: [...p.elements].sort((x, y) => (x.id < y.id ? -1 : 1)),
          })),
      )
    expect(canon(ab)).toBe(canon(ba))
    // deterministic content checks
    expect(ab.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
    const p1 = ab[0]
    // 'shared' → theirs edited (stamped beats the unstamped base);
    // 'only-ours' + 'fresh' kept (no tombstones); 'gone' blocked (100 < 300)
    expect([...p1.elements].sort((x, y) => (x.id < y.id ? -1 : 1)).map((e) => e.id)).toEqual(['fresh', 'only-ours', 'shared'])
    expect((p1.elements.find((e) => e.id === 'shared') as { text: string }).text).toBe('theirs edited')
    expect(p1.tombstones?.gone).toBe('0000000300:00001:a')
  })

  it('isUnstamped detects legacy documents', () => {
    expect(isUnstamped([page('p', [el('e', 'x')])])).toBe(true)
    expect(isUnstamped([page('p', [el('e', 'x', h('a'))])])).toBe(false)
    expect(isUnstamped([page('p', [el('e', 'x')], { tombstones: { e: h('a') } })])).toBe(false)
  })
})

describe('stamping helpers', () => {
  it('stampPages stamps pages and elements deeply (groups)', () => {
    const stamp = h('s')
    const group = {
      type: 'group',
      id: 'g1',
      children: [el('child1', 'c1'), el('child2', 'c2')],
    } as unknown as AnyElement
    const pages = [page('p1', [el('top', 't'), group])]
    const stamped = stampPages(pages, stamp)
    expect(stamped[0]._pm).toBe(stamp)
    expect(stamped[0].elements[0]._m).toBe(stamp)
    const g = stamped[0].elements[1] as unknown as { children: AnyElement[] }
    expect(g.children[0]._m).toBe(stamp)
    // inputs untouched (no in-place mutation)
    expect(pages[0].elements[0]._m).toBeUndefined()
  })

  it('stampElementDeep / stampPage produce fresh identities', () => {
    const original = el('e', 'x')
    const stamped = stampElementDeep(original, h('s'))
    expect(stamped).not.toBe(original)
    expect(stamped._m).toBeTruthy()
    const p = page('p', [el('e', 'x')])
    const sp = stampPage(p, h('s'))
    expect(sp).not.toBe(p)
    expect(sp._pm).toBeTruthy()
  })
})
