// ─────────────────────────────────────────────────────────────
// P4 pipeline tests — the plugin element's FULL journey:
//
//   manifest declares → addPluginElement (broker caller identity)
//   → editor store (undoable) → collab op validation (type-agnostic)
//   → snapshot projection (own data back to the plugin) → offline
//   merge (LWW by id) → svg-export embed (nested svg / placeholder)
//   → uninstall semantics (data untouched, placeholder everywhere)
// ─────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it } from 'vitest'
import { useEditorStore } from '@/store/editor-store'
import { applyDesignAction, type ActionCaller } from '@/lib/design-actions'
import { createPluginElement, type AnyElement, type PageData, type PluginElement } from '@/lib/types'
import { validateOpPayload, type CollabOp } from '@/lib/collab/protocol'
import { pluginSnapshot } from '@/lib/plugins/snapshot'
import { mergeElements } from '@/lib/collab/merge'
import { formatHlc } from '@/lib/collab/hlc'
import { exportPageToSVG } from '@/lib/svg-export'
import { __resetRendererCache, setPluginSystemState, setRenderTransport, requestRender, type RenderTransport } from '@/lib/plugins/renderer-cache'

const CALLER: ActionCaller = {
  pluginId: 'com.example.test',
  pluginVersion: '1.0.0',
  elementKinds: ['cloud'],
}

function pluginEl(over: Partial<PluginElement> = {}): PluginElement {
  return createPluginElement('com.example.test', 'cloud', '1.0.0', { words: ['a', 'b'], seed: 1 }, { id: 'plg_1', ...over })
}

function seedPage(elements: AnyElement[]): PageData {
  const page: PageData = { id: 'page_1', background: { type: 'solid', color: '#FFFFFF' }, elements }
  useEditorStore.setState({
    pages: [page],
    currentPage: 0,
    selectedIds: [],
    past: [],
    future: [],
    dirty: false,
    version: 0,
    designId: 'test-design',
  })
  return page
}

beforeEach(() => {
  __resetRendererCache()
})

describe('createPluginElement factory', () => {
  it('stamps the full element shape with a placeholder-friendly default box', () => {
    const el = pluginEl()
    expect(el.type).toBe('plugin')
    expect(el.pluginId).toBe('com.example.test')
    expect(el.kind).toBe('cloud')
    expect(el.pluginVersion).toBe('1.0.0')
    expect(el.data).toEqual({ words: ['a', 'b'], seed: 1 })
    expect(el.width).toBe(480)
    expect(el.height).toBe(320)
    expect(el.id).toBeTruthy()
    expect(el.visible).toBe(true)
  })

  it('honours position/size overrides', () => {
    const el = pluginEl({ x: 40, y: 50, width: 640, height: 480, name: 'My cloud' })
    expect(el).toMatchObject({ x: 40, y: 50, width: 640, height: 480, name: 'My cloud' })
  })
})

describe('addPluginElement (design action)', () => {
  it('rejects callers without a plugin identity (the AI path cannot forge plugin elements)', async () => {
    seedPage([])
    const msg = await applyDesignAction({ type: 'addPluginElement', kind: 'cloud', data: {} })
    expect(msg).toMatch(/only be added by installed apps/i)
    expect(useEditorStore.getState().pages[0]!.elements).toHaveLength(0)
  })

  it('rejects kinds the caller never declared in its manifest', async () => {
    seedPage([])
    const msg = await applyDesignAction({ type: 'addPluginElement', kind: 'intruder', data: {} }, CALLER)
    expect(msg).toMatch(/does not declare/i)
    expect(useEditorStore.getState().pages[0]!.elements).toHaveLength(0)
  })

  it('rejects data that violates the clone caps', async () => {
    seedPage([])
    const msg = await applyDesignAction(
      { type: 'addPluginElement', kind: 'cloud', data: { bomb: 'x'.repeat(80 * 1024) } },
      CALLER,
    )
    expect(msg).toMatch(/larger than|bytes/i)
    expect(useEditorStore.getState().pages[0]!.elements).toHaveLength(0)
  })

  it('adds a fully-formed plugin element through the undoable store path', async () => {
    seedPage([])
    const msg = await applyDesignAction(
      { type: 'addPluginElement', kind: 'cloud', data: { words: ['hi'], seed: 3 }, width: 300, height: 200, x: 11, y: 22, name: 'Cloud 1' },
      CALLER,
    )
    expect(msg).toMatch(/added/i)
    const els = useEditorStore.getState().pages[0]!.elements
    expect(els).toHaveLength(1)
    expect(els[0]).toMatchObject({
      type: 'plugin',
      pluginId: 'com.example.test',
      kind: 'cloud',
      pluginVersion: '1.0.0',
      width: 300,
      height: 200,
      x: 11,
      y: 22,
      name: 'Cloud 1',
    })
    // undoable like any element
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().pages[0]!.elements).toHaveLength(0)
  })

  it('clamps an absurd requested box', async () => {
    seedPage([])
    await applyDesignAction({ type: 'addPluginElement', kind: 'cloud', data: {}, width: 99999, height: 1 }, CALLER)
    const el = useEditorStore.getState().pages[0]!.elements[0] as PluginElement
    expect(el.width).toBe(8000)
    expect(el.height).toBe(16)
  })
})

describe('updatePluginElementData (design action)', () => {
  it('patches only elements owned by the calling plugin', async () => {
    const mine = pluginEl({ id: 'mine' })
    const foreign = pluginEl({ id: 'foreign', pluginId: 'other.plugin', pluginVersion: '2.0.0' })
    seedPage([mine, foreign])

    const msg = await applyDesignAction(
      { type: 'updatePluginElementData', ids: ['mine', 'foreign'], patch: { seed: 99 } },
      CALLER,
    )
    expect(msg).toMatch(/updated 1/i)
    const els = useEditorStore.getState().pages[0]!.elements as PluginElement[]
    expect(els.find((e) => e.id === 'mine')!.data).toEqual({ words: ['a', 'b'], seed: 99 })
    // the foreign element is untouched — not merged, not dropped
    expect(els.find((e) => e.id === 'foreign')!.data).toEqual({ words: ['a', 'b'], seed: 1 })
    expect(els.find((e) => e.id === 'foreign')!.pluginId).toBe('other.plugin')
  })

  it('refuses a patch that would push the merged data over the caps', async () => {
    seedPage([pluginEl()])
    const msg = await applyDesignAction(
      { type: 'updatePluginElementData', ids: ['plg_1'], patch: { bomb: 'y'.repeat(80 * 1024) } },
      CALLER,
    )
    expect(msg).toMatch(/bytes/i)
    const el = useEditorStore.getState().pages[0]!.elements[0] as PluginElement
    expect(el.data).toEqual({ words: ['a', 'b'], seed: 1 }) // unchanged
  })

  it('ignores ids that are not plugin elements at all', async () => {
    seedPage([pluginEl()])
    const msg = await applyDesignAction(
      { type: 'updatePluginElementData', ids: ['nonexistent'], patch: { seed: 2 } },
      CALLER,
    )
    expect(msg).toMatch(/no matching elements|no elements from this app/i)
  })
})

describe('collab op validation — plugin elements are plain payloads', () => {
  it('an elements:add op carrying a plugin element passes validateOpPayload', () => {
    const op: CollabOp = {
      kind: 'elements:add',
      pageId: 'page_1',
      elements: [pluginEl()],
    } as unknown as CollabOp
    expect(validateOpPayload(op)).toBe(true)
  })

  it('a hostile data payload fails the same caps as every other element', () => {
    const op: CollabOp = {
      kind: 'elements:add',
      pageId: 'page_1',
      elements: [pluginEl({ data: { bomb: 'x'.repeat(120_000) } })],
    } as unknown as CollabOp
    expect(validateOpPayload(op)).toBe(false)
  })
})

describe('snapshot projection — the plugin reads its own data back', () => {
  it('projects plugin elements with data verbatim (arrays included)', () => {
    const page: PageData = {
      id: 'p1',
      background: { type: 'solid', color: '#FFFFFF' },
      elements: [pluginEl({ data: { words: ['alpha', 'beta'], palette: ['#7630D7', '#02C0CC'], seed: 5 } })],
    }
    const snap = pluginSnapshot({ pages: [page], currentPage: 0 })
    const view = snap.pages[0]!.elements[0] as Record<string, unknown>
    expect(view.type).toBe('plugin')
    expect(view.pluginId).toBe('com.example.test')
    expect(view.kind).toBe('cloud')
    expect(view.data).toEqual({ words: ['alpha', 'beta'], palette: ['#7630D7', '#02C0CC'], seed: 5 })
    // internal bookkeeping still never crosses
    expect(view._m).toBeUndefined()
  })

  it('plugin elements inside groups are projected too', () => {
    const group: AnyElement = {
      type: 'group',
      id: 'g1',
      x: 0,
      y: 0,
      width: 480,
      height: 320,
      rotation: 0,
      opacity: 1,
      locked: false,
      visible: true,
      shadow: { enabled: false, color: '#000', blur: 0, offsetX: 0, offsetY: 0 },
      children: [pluginEl()],
    }
    const snap = pluginSnapshot({ pages: [{ id: 'p1', background: { type: 'solid', color: '#FFFFFF' }, elements: [group] }], currentPage: 0 })
    const child = snap.pages[0]!.elements[0]!.children![0] as Record<string, unknown>
    expect(child.type).toBe('plugin')
    expect(child.data).toEqual({ words: ['a', 'b'], seed: 1 })
  })
})

describe('offline merge — LWW by id, type-agnostic (§4.9)', () => {
  it('a plugin element edited on two replicas merges by stamp, not by type', () => {
    const older = pluginEl({ data: { words: ['old'], seed: 1 }, _m: formatHlc(1, 1, 'a') })
    const newer = pluginEl({ data: { words: ['new'], seed: 2 }, _m: formatHlc(2, 1, 'b') })
    const ab = mergeElements([older], [newer], {}, {}).elements as PluginElement[]
    const ba = mergeElements([newer], [older], {}, {}).elements as PluginElement[]
    expect(ab[0]!.data.seed).toBe(2)
    expect(ba[0]!.data.seed).toBe(2) // same verdict from both directions
  })

  it('a plugin element added on one replica survives the merge untouched', () => {
    const text = { type: 'text', id: 't1', text: 'hello', _m: formatHlc(1, 1, 'a') } as unknown as AnyElement
    const added = pluginEl({ _m: formatHlc(2, 1, 'b') })
    const merged = mergeElements([text], [added], {}, {}).elements
    expect(merged.map((e) => e.id).sort()).toEqual(['plg_1', 't1'])
    expect(merged.find((e) => e.id === 'plg_1')).toMatchObject({ type: 'plugin', pluginId: 'com.example.test' })
  })
})

describe('svg-export — plugin elements land in the file', () => {
  const page = (el: PluginElement): PageData => ({
    id: 'p1',
    background: { type: 'solid', color: '#FFFFFF' },
    elements: [el],
  })

  it('embeds a primed render as a nested <svg> at the element box', async () => {
    setPluginSystemState('ready', [{
      installId: 'inst_1',
      pluginId: 'com.example.test',
      name: 'Test',
      version: '1.0.0',
      enabled: true,
      grantedPermissions: ['element:plugin'],
      entry: { service: 'service.html' },
      elements: [{ kind: 'cloud', label: 'Cloud', schema: [] }],
    }])
    setRenderTransport('com.example.test', {
      kinds: new Set(['cloud']),
      isHandshaked: true,
      callPlugin: async () => ({
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 320"><text x="8" y="24" font-size="18">wordcloud</text></svg>',
      }),
    } as unknown as RenderTransport)

    const el = pluginEl({ x: 100, y: 50, width: 480, height: 320 })
    requestRender(el, 'export')
    await new Promise((r) => setTimeout(r, 10))

    const svg = exportPageToSVG(page(el), 1080, 720)
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 320" x="100" y="50" width="480" height="320"')
    expect(svg).toContain('wordcloud')
  })

  it('an unrenderable plugin element exports as the placeholder card (visible, honest)', () => {
    // no install, no transport — the §4.9 "not installed" state
    const el = pluginEl({ x: 10, y: 10, width: 400, height: 300, name: 'My cloud' })
    const svg = exportPageToSVG(page(el), 1080, 720)
    expect(svg).toContain('My cloud')
    expect(svg).toContain('com.example.test')
    expect(svg).toContain('stroke-dasharray')
  })
})
