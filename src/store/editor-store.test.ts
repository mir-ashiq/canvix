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
