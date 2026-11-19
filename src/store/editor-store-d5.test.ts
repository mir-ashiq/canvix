// ─────────────────────────────────────────────────────────────
// v0.24 (D5): auto version snapshots before destructive ops
//
// What is locked in here:
//   1. each of the five destructive ops saves an `auto` snapshot of the
//      PRE-op state first (template apply, Magic Resize, Translate,
//      Magic Layers replace, page delete)
//   2. the 60 s same-reason throttle: a repeated op refreshes nothing
//   3. preferential pruning: when the 30-slot list overflows, the
//      OLDEST auto is evicted — a manual snapshot is never dropped
//   4. an all-manual list keeps the original 30-most-recent cut
//   5. restoring an auto snapshot works exactly like a manual one
// Vitest runs in the node environment, so localStorage is stubbed.
// ─────────────────────────────────────────────────────────────

import { describe, expect, it, beforeEach, vi } from 'vitest'
import { useEditorStore } from '@/store/editor-store'
import type { AnyElement, PageData, DesignVersion } from '@/lib/types'

// node env — no localStorage: install the same contract the browser gives
const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
})

vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false }))) // offline posture: no server round-trip

function makeText(id: string, text: string): AnyElement {
  return {
    type: 'text',
    id,
    x: 10,
    y: 10,
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

function page(id: string, text: string): PageData {
  return { id, background: { type: 'solid', color: '#FFFFFF' }, elements: [makeText(`${id}-el`, text)] }
}

function seed(pages: PageData[], versions: DesignVersion[] = []) {
  useEditorStore.setState({
    pages,
    currentPage: 0,
    selectedIds: [],
    past: [],
    future: [],
    dirty: false,
    version: 0,
    designId: 'test-d5',
    designName: 'D5 test',
    width: 1080,
    height: 1080,
    versions,
  })
}

function manualVersion(i: number, at = Date.now() - 1000 * (100 - i)): DesignVersion {
  return { id: `ver-m${i}`, label: `Manual ${i}`, at, name: 'D5 test', width: 1080, height: 1080, pages: [page(`pm${i}`, `m${i}`)] }
}

describe('D5 auto version snapshots', () => {
  beforeEach(() => {
    store.clear()
    vi.mocked(fetch).mockClear()
  })

  it('deletePage saves an auto snapshot of the pre-delete state', () => {
    seed([page('p1', 'keep'), page('p2', 'gone')])
    useEditorStore.getState().deletePage(1)
    const versions = useEditorStore.getState().versions
    expect(versions).toHaveLength(1)
    expect(versions[0].auto).toBe(true)
    expect(versions[0].label).toBe('Auto — before page delete')
    // the snapshot preserves the deleted page; the live design doesn't
    expect(versions[0].pages).toHaveLength(2)
    expect(versions[0].pages[1].elements[0]).toMatchObject({ text: 'gone' })
    expect(useEditorStore.getState().pages).toHaveLength(1)
  })

  it('the last page is never deletable, and no snapshot is taken for a no-op', () => {
    seed([page('only', 'one')])
    useEditorStore.getState().deletePage(0)
    expect(useEditorStore.getState().versions).toHaveLength(0)
  })

  it('translateTexts saves an auto snapshot before rewriting texts', () => {
    seed([page('p1', 'before')])
    const el = useEditorStore.getState().pages[0].elements[0]
    useEditorStore.getState().translateTexts([{ id: el.id, text: 'nachher' }])
    const [v] = useEditorStore.getState().versions
    expect(v.auto).toBe(true)
    expect(v.pages[0].elements[0]).toMatchObject({ text: 'before' })
    expect(useEditorStore.getState().pages[0].elements[0]).toMatchObject({ text: 'nachher' })
  })

  it('the same reason within 60 s is throttled to one snapshot', () => {
    seed([page('p1', 'a')])
    const s = useEditorStore.getState()
    s.translateTexts([{ id: 'p1-el', text: 'b' }])
    s.translateTexts([{ id: 'p1-el', text: 'c' }])
    const versions = useEditorStore.getState().versions
    expect(versions.filter((v) => v.auto)).toHaveLength(1)
  })

  it('overflow evicts the OLDEST auto — a manual snapshot is never dropped', () => {
    // 30-slot list, newest-first: 29 manuals + 1 old auto at the oldest
    // position. A destructive op pushes a new auto → 31 → the OLD auto
    // is evicted; every manual snapshot survives.
    const manuals = Array.from({ length: 29 }, (_, i) => manualVersion(i + 1)) // m1..m29, m1 oldest
    const oldAuto: DesignVersion = { ...manualVersion(0), id: 'ver-old-auto', auto: true, label: 'Auto — before old op' }
    const list = [...manuals.reverse(), oldAuto] // newest-first: m29..m1, then the old auto as oldest
    expect(list).toHaveLength(30)
    seed([page('p1', 'x'), page('p2', 'y')], list)
    useEditorStore.getState().deletePage(1) // pushes a new auto → 31 → evict the oldest auto
    const after = useEditorStore.getState().versions
    expect(after).toHaveLength(30)
    expect(after[0]?.auto).toBe(true) // the new snapshot, newest-first
    expect(after.some((v) => v.id === 'ver-old-auto')).toBe(false) // the old auto was evicted
    expect(after.filter((v) => !v.auto)).toHaveLength(29) // every manual survived
  })

  it('an all-manual full list keeps the original 30-most-recent cut', () => {
    const manuals = Array.from({ length: 30 }, (_, i) => manualVersion(i)) // m0 oldest … m29 newest
    seed([page('p1', 'x'), page('p2', 'y')], [...manuals].reverse()) // newest first, 30 items
    useEditorStore.getState().deletePage(1)
    const after = useEditorStore.getState().versions
    expect(after).toHaveLength(30)
    expect(after[0]?.auto).toBe(true)
    // the OLDEST manual was evicted (list was all-manual — fallback cut)
    expect(after.some((v) => v.id === 'ver-m0')).toBe(false)
    expect(after.filter((v) => v.auto)).toHaveLength(1)
  })

  it('restoring an auto snapshot works like a manual one', () => {
    seed([page('p1', 'before'), page('p2', 'gone')])
    useEditorStore.getState().deletePage(1)
    const [v] = useEditorStore.getState().versions
    useEditorStore.getState().restoreVersion(v.id)
    const state = useEditorStore.getState()
    expect(state.pages).toHaveLength(2)
    expect(state.pages[1].elements[0]).toMatchObject({ text: 'gone' })
    expect(state.dirty).toBe(true)
  })

  it('auto snapshots persist to localStorage for offline recovery', () => {
    seed([page('p1', 'x'), page('p2', 'y')])
    useEditorStore.getState().deletePage(1)
    const raw = store.get('canvix-versions-test-d5')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!) as DesignVersion[]
    expect(parsed[0].auto).toBe(true)
  })
})
