// ─────────────────────────────────────────────────────────────
// v0.7 rendering-performance invariants: structural sharing
//
// These tests lock in the guarantees the memoized canvas depends on:
//   1. updateElementsLive gives NEW identities only to patched elements
//   2. untouched pages keep referential identity across mutations
//   3. undo/redo history snapshots share structure with live state
//   4. history push/undo/redo round-trips document content correctly
// ─────────────────────────────────────────────────────────────

import { describe, expect, it, beforeEach } from 'vitest'
import { useEditorStore } from '@/store/editor-store'
import type { AnyElement, PageData } from '@/lib/types'

function makeText(id: string, text: string, x = 10, y = 10): AnyElement {
  return {
    type: 'text',
    id,
    x,
    y,
    width: 200,
    height: 40,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    text,
    fontSize: 32,
    fontFamily: 'Inter',
    fill: '#111111',
    align: 'left',
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    lineHeight: 1.25,
    letterSpacing: 0,
    uppercase: false,
  } as unknown as AnyElement
}

function seedTwoPages(): { pageA: PageData; pageB: PageData } {
  const pageA: PageData = {
    id: 'page-a',
    background: { type: 'solid', color: '#FFFFFF' },
    elements: [makeText('t1', 'Hello'), makeText('t2', 'World', 10, 80)],
  }
  const pageB: PageData = {
    id: 'page-b',
    background: { type: 'solid', color: '#000000' },
    elements: [makeText('t3', 'Second page')],
  }
  useEditorStore.setState({
    pages: [pageA, pageB],
    currentPage: 0,
    selectedIds: [],
    past: [],
    future: [],
    dirty: false,
    version: 0,
    designId: 'test-design',
  })
  return { pageA, pageB }
}

describe('editor-store structural sharing (v0.7)', () => {
  beforeEach(() => seedTwoPages())

  it('updateElementsLive replaces only the patched element identities', () => {
    const { pages } = useEditorStore.getState()
    useEditorStore.getState().updateElementsLive(['t1'], { text: 'Changed' })

    const next = useEditorStore.getState().pages
    // untouched page keeps identity
    expect(next[1]).toBe(pages[1])
    // touched page is a new object
    expect(next[0]).not.toBe(pages[0])
    const els = next[0].elements
    // untouched element keeps identity → memoized node skips re-render
    expect(els.find((e) => e.id === 't2')).toBe(pages[0].elements.find((e) => e.id === 't2'))
    // patched element has a new identity with the new value
    const t1 = els.find((e) => e.id === 't1')
    expect(t1).not.toBe(pages[0].elements.find((e) => e.id === 't1'))
    expect((t1 as { text: string }).text).toBe('Changed')
  })

  it('mutations never modify the previous pages snapshot in place', () => {
    const before = useEditorStore.getState().pages
    const snapshot = JSON.parse(JSON.stringify(before))
    useEditorStore.getState().updateElementsLive(['t1'], { text: 'Typing…' })
    useEditorStore.getState().addElement(makeText('t9', 'Added', 5, 5))
    useEditorStore.getState().setPageBackground({ type: 'solid', color: '#FFEE00' })
    useEditorStore.getState().undo()
    // the ORIGINAL reference must still match its own deep value
    expect(JSON.parse(JSON.stringify(before))).toEqual(snapshot)
  })

  it('history snapshots share structure with live state (O(1) push)', () => {
    const before = useEditorStore.getState().pages
    useEditorStore.getState().pushHistory()
    const past = useEditorStore.getState().past
    expect(past.length).toBe(1)
    // snapshot stores the same reference — no deep clone
    expect(past[past.length - 1].pages).toBe(before)
  })

  it('undo/redo round-trips content and shares structure', () => {
    const original = useEditorStore.getState().pages
    useEditorStore.getState().pushHistory()
    useEditorStore.getState().updateElementsLive(['t2'], { x: 999 })
    useEditorStore.getState().undo()

    const restored = useEditorStore.getState().pages
    // content round-trips…
    expect((restored[0].elements.find((e) => e.id === 't2') as { x: number }).x).toBe(10)
    // …and the restored reference IS the pre-edit snapshot (structural sharing)
    expect(restored).toBe(original)

    useEditorStore.getState().redo()
    const redone = useEditorStore.getState().pages
    expect((redone[0].elements.find((e) => e.id === 't2') as { x: number }).x).toBe(999)
  })

  it('applyRemoteOp keeps untouched page identity (remote live edit)', () => {
    const before = useEditorStore.getState().pages
    useEditorStore.getState().applyRemoteOp({
      seq: 1,
      id: 'evt-1',
      designId: 'test-design',
      actorId: 'remote-agent',
      kind: 'elements:update',
      payload: { pageId: 'page-a', ids: ['t1'], patch: { x: 4242 } },
      createdAt: new Date().toISOString(),
    })

    const next = useEditorStore.getState().pages
    expect(next[1]).toBe(before[1])
    expect((next[0].elements.find((e) => e.id === 't1') as { x: number }).x).toBe(4242)
    expect(next[0].elements.find((e) => e.id === 't2')).toBe(before[0].elements.find((e) => e.id === 't2'))
  })
})

// ─────────────────────────────────────────────────────────────
// v0.10 offline merge — remote-op application gates
//
// applyRemoteOp must be ORDER-INDEPENDENT for stamped events: replaying a
// stale event after newer state cannot clobber it. That is what makes
// offline queue flush + gap-free replay safe without coordination.
// ─────────────────────────────────────────────────────────────

describe('applyRemoteOp HLC gates (v0.10)', () => {
  beforeEach(() => seedTwoPages())

  function remoteEvent(kind: string, payload: Record<string, unknown>, actor = 'remote-agent') {
    return {
      seq: Math.floor(Math.random() * 1e6),
      id: `evt-${Math.random().toString(36).slice(2)}`,
      designId: 'test-design',
      actorId: actor,
      kind,
      payload,
      createdAt: new Date().toISOString(),
    }
  }

  it('stamped elements:update applies and stamps the element', () => {
    useEditorStore.getState().applyRemoteOp(
      remoteEvent('elements:update', {
        pageId: 'page-a',
        ids: ['t1'],
        _h: '0000000100:00001:remote-agent',
        patch: { x: 777, _m: '0000000100:00001:remote-agent' },
      }),
    )
    const t1 = useEditorStore.getState().pages[0].elements.find((e) => e.id === 't1')!
    expect((t1 as { x: number }).x).toBe(777)
    expect(t1._m).toBe('0000000100:00001:remote-agent')
  })

  it('an OLDER stamped update cannot clobber newer element state (order independence)', () => {
    // newer write lands first
    useEditorStore.getState().applyRemoteOp(
      remoteEvent('elements:update', {
        pageId: 'page-a',
        ids: ['t1'],
        _h: '0000000200:00001:remote-agent',
        patch: { x: 200, _m: '0000000200:00001:remote-agent' },
      }),
    )
    // then a stale replay arrives (offline flush out of order)
    useEditorStore.getState().applyRemoteOp(
      remoteEvent('elements:update', {
        pageId: 'page-a',
        ids: ['t1'],
        _h: '0000000100:00002:other-actor',
        patch: { x: 100, _m: '0000000100:00002:other-actor' },
      }),
    )
    const t1 = useEditorStore.getState().pages[0].elements.find((e) => e.id === 't1')!
    expect((t1 as { x: number }).x).toBe(200)
    expect(t1._m).toBe('0000000200:00001:remote-agent')
  })

  it('legacy events (no stamps) apply as before', () => {
    useEditorStore.getState().applyRemoteOp(
      remoteEvent('elements:update', { pageId: 'page-a', ids: ['t1'], patch: { x: 4242 } }),
    )
    const t1 = useEditorStore.getState().pages[0].elements.find((e) => e.id === 't1')!
    expect((t1 as { x: number }).x).toBe(4242)
  })

  it('element:delete tombstones and removes; a NEWER re-add survives a stale delete', () => {
    // delete at t=100
    useEditorStore.getState().applyRemoteOp(
      remoteEvent('element:delete', { pageId: 'page-a', ids: ['t1'], _h: '0000000100:00001:remote-agent' }),
    )
    expect(useEditorStore.getState().pages[0].elements.find((e) => e.id === 't1')).toBeUndefined()
    expect(useEditorStore.getState().pages[0].tombstones?.t1).toBeTruthy()

    // newer re-add at t=200
    useEditorStore.getState().applyRemoteOp(
      remoteEvent('element:add', {
        pageId: 'page-a',
        _h: '0000000200:00001:remote-agent',
        element: { ...makeText('t1', 'Reborn'), _m: '0000000200:00001:remote-agent' },
      }),
    )
    expect(useEditorStore.getState().pages[0].elements.find((e) => e.id === 't1')).toBeTruthy()
    expect(useEditorStore.getState().pages[0].tombstones?.t1).toBeUndefined()

    // stale delete replay at t=150 must NOT kill the newer re-add
    useEditorStore.getState().applyRemoteOp(
      remoteEvent('element:delete', { pageId: 'page-a', ids: ['t1'], _h: '0000000150:00001:remote-agent' }),
    )
    expect(useEditorStore.getState().pages[0].elements.find((e) => e.id === 't1')).toBeTruthy()
  })

  it('pages:replace MERGES by stamp instead of clobbering (newer local edits survive)', () => {
    // local (newer) edit to t1
    useEditorStore.getState().updateElementsLive(['t1'], { x: 555 })

    // a coarse pages:replace arrives whose t1 copy is STAMPED OLDER than our edit
    useEditorStore.getState().applyRemoteOp(
      remoteEvent('pages:replace', {
        _h: '0000000001:00001:old-actor',
        pages: [
          {
            id: 'page-a',
            background: { type: 'solid', color: '#FFFFFF' },
            elements: [{ ...makeText('t1', 'stale copy'), _m: '0000000001:00001:old-actor' }],
          },
          {
            id: 'page-b',
            background: { type: 'solid', color: '#000000' },
            elements: [makeText('t3', 'Second page')],
          },
        ],
      }),
    )
    const t1 = useEditorStore.getState().pages[0].elements.find((e) => e.id === 't1')!
    expect((t1 as { x: number }).x).toBe(555) // our newer local write survived
    // and a STAMPED-NEWER replace still wins
    useEditorStore.getState().applyRemoteOp(
      remoteEvent('pages:replace', {
        _h: '9999999999:00001:winner',
        pages: [
          {
            id: 'page-a',
            background: { type: 'solid', color: '#FFFFFF' },
            elements: [{ ...makeText('t1', 'fresh replace'), _m: '9999999999:00001:winner' }],
          },
        ],
        width: 640,
        height: 480,
      }),
    )
    const t1b = useEditorStore.getState().pages[0].elements.find((e) => e.id === 't1')!
    expect((t1b as { text: string }).text).toBe('fresh replace')
    expect(useEditorStore.getState().width).toBe(640)
  })

  it('local mutations stamp elements (_m rides every write path)', () => {
    useEditorStore.getState().updateElementsLive(['t1'], { x: 1 })
    expect(useEditorStore.getState().pages[0].elements.find((e) => e.id === 't1')?._m).toBeTruthy()
    useEditorStore.getState().addElement(makeText('t9', 'Added'))
    expect(useEditorStore.getState().pages[0].elements.find((e) => e.id === 't9')?._m).toBeTruthy()
    useEditorStore.getState().setSelection(['t1'])
    useEditorStore.getState().deleteSelection()
    expect(useEditorStore.getState().pages[0].tombstones?.t1).toBeTruthy()
  })
})
