import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetRendererCache,
  awaitRender,
  getPluginSystemState,
  placeholderReason,
  renderKey,
  requestRender,
  setPluginSystemState,
  setRenderTransport,
  getRenderEntry,
  type PluginInstallInfo,
  type RenderTransport,
} from './renderer-cache'
import type { PluginElement } from '@/lib/types'

// The renderer cache is where the §4.5 contract becomes host code:
// transports come and go, results are sanitized HERE (the one place
// untrusted SVG enters), failures degrade to error entries — never
// exceptions, never a blocked editor.

function el(over: Partial<PluginElement> = {}): PluginElement {
  return {
    id: 'el_plugin_1',
    type: 'plugin',
    pluginId: 'com.example.test',
    kind: 'cloud',
    pluginVersion: '1.0.0',
    data: { words: ['a', 'b'], seed: 7 },
    x: 0,
    y: 0,
    width: 480,
    height: 320,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    shadow: { enabled: false, color: '#000000', blur: 0, offsetX: 0, offsetY: 0 },
    ...over,
  }
}

function install(over: Partial<PluginInstallInfo> = {}): PluginInstallInfo {
  return {
    installId: 'inst_1',
    pluginId: 'com.example.test',
    name: 'Test plugin',
    version: '1.0.0',
    enabled: true,
    grantedPermissions: ['element:plugin'],
    entry: { service: 'service.html' },
    elements: [{ kind: 'cloud', label: 'Cloud', schema: [] }],
    ...over,
  }
}

/** A controllable transport standing in for a service broker. */
function fakeTransport(over: Partial<RenderTransport> = {}) {
  const t = {
    kinds: new Set(['cloud']),
    isHandshaked: true,
    callPlugin: vi.fn(async () => ({ svg: GOOD_SVG })),
    ...over,
  } as unknown as RenderTransport
  return t
}

const GOOD_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 320"><text x="10" y="20" font-size="14">hello</text></svg>'

beforeEach(() => {
  __resetRendererCache()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('placeholderReason — the §4.9 matrix', () => {
  it('unknown state → loading', () => {
    expect(placeholderReason(el())).toEqual({ reason: 'loading', label: 'Checking installed apps…' })
  })

  it('off state → instance-level message', () => {
    setPluginSystemState('off')
    expect(placeholderReason(el())?.reason).toBe('off')
    expect(placeholderReason(el())?.label).toMatch(/disabled on this Canvix instance/i)
  })

  it('ready + plugin missing → install hint carrying the plugin id', () => {
    setPluginSystemState('ready', [])
    const r = placeholderReason(el())
    expect(r?.reason).toBe('missing')
    expect(r?.label).toContain('com.example.test')
  })

  it('ready + disabled install → disabled message', () => {
    setPluginSystemState('ready', [install({ enabled: false })])
    expect(placeholderReason(el())?.reason).toBe('disabled')
  })

  it('ready + enabled install → null (render normally)', () => {
    setPluginSystemState('ready', [install()])
    expect(placeholderReason(el())).toBeNull()
  })
})

describe('requestRender — the happy path', () => {
  it('renders through the transport and caches the sanitized result', async () => {
    setPluginSystemState('ready', [install()])
    const transport = fakeTransport()
    setRenderTransport('com.example.test', transport)

    const element = el()
    requestRender(element, 'canvas')
    const key = renderKey(element, 'canvas')
    await vi.runAllTimersAsync()

    expect(getRenderEntry(key)).toEqual({
      status: 'ok',
      dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(GOOD_SVG)}`,
      svg: GOOD_SVG,
    })
    expect(transport.callPlugin).toHaveBeenCalledWith('elements.render', {
      kind: 'cloud',
      data: element.data,
      width: 480,
      height: 320,
      mode: 'canvas',
    })
  })

  it('a second request for the same key is a cache hit (one transport call)', async () => {
    setPluginSystemState('ready', [install()])
    const transport = fakeTransport()
    setRenderTransport('com.example.test', transport)

    requestRender(el(), 'canvas')
    requestRender(el(), 'canvas')
    await vi.runAllTimersAsync()
    expect(transport.callPlugin).toHaveBeenCalledTimes(1)
  })

  it('raster results become data URLs; junk results become errors', async () => {
    setPluginSystemState('ready', [install()])
    setRenderTransport('com.example.test', fakeTransport({ callPlugin: vi.fn(async () => ({ raster: 'data:image/png;base64,iVBORw0KGgo=' })) }))
    requestRender(el(), 'canvas')
    await vi.runAllTimersAsync()
    expect(getRenderEntry(renderKey(el(), 'canvas'))).toMatchObject({ status: 'ok', svg: null, dataUrl: 'data:image/png;base64,iVBORw0KGgo=' })

    __resetRendererCache()
    setPluginSystemState('ready', [install()])
    setRenderTransport('com.example.test', fakeTransport({ callPlugin: vi.fn(async () => ({ nope: true })) }))
    requestRender(el(), 'canvas')
    await vi.runAllTimersAsync()
    expect(getRenderEntry(renderKey(el(), 'canvas'))).toMatchObject({ status: 'error' })
  })

  it('data changes and size changes re-render; unrelated changes do not', async () => {
    setPluginSystemState('ready', [install()])
    const transport = fakeTransport()
    setRenderTransport('com.example.test', transport)

    requestRender(el(), 'canvas')
    await vi.runAllTimersAsync()
    // same data + size → same key
    requestRender(el(), 'canvas')
    await vi.runAllTimersAsync()
    expect(transport.callPlugin).toHaveBeenCalledTimes(1)

    // restyle (data change) → new key, new render
    requestRender(el({ data: { words: ['z'], seed: 9 } }), 'canvas')
    await vi.runAllTimersAsync()
    expect(transport.callPlugin).toHaveBeenCalledTimes(2)

    // resize → new key
    requestRender(el({ width: 640 }), 'canvas')
    await vi.runAllTimersAsync()
    expect(transport.callPlugin).toHaveBeenCalledTimes(3)

    // export mode → separate key
    requestRender(el(), 'export')
    await vi.runAllTimersAsync()
    expect(transport.callPlugin).toHaveBeenCalledTimes(4)
  })
})

describe('the sanitizer is the gate — hostile renderer output never caches', () => {
  const hostile = (svg: string) => {
    setPluginSystemState('ready', [install()])
    setRenderTransport('com.example.test', fakeTransport({ callPlugin: vi.fn(async () => ({ svg })) }))
    requestRender(el(), 'canvas')
  }

  it.each([
    ['script tag', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    ['event handler', '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" onload="alert(1)"/></svg>'],
    ['foreignObject', '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject>hi</foreignObject></svg>'],
    ['external href', '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png" width="10" height="10"/></svg>'],
    ['javascript: URI', '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><text x="0" y="10">x</text></a></svg>'],
    ['not svg at all', '<div>hello</div>'],
  ])('rejects %s', async (name, svg) => {
    hostile(svg)
    await vi.runAllTimersAsync()
    const entry = getRenderEntry(renderKey(el(), 'canvas'))
    expect(entry?.status, name).toBe('error')
    expect(entry?.status === 'error' && entry.message.length).toBeGreaterThan(4)
  })
})

describe('failure + recovery (crash containment)', () => {
  it('no transport yet → pending, then the watchdog degrades to an error entry', async () => {
    setPluginSystemState('ready', [install()])
    requestRender(el(), 'canvas')
    const key = renderKey(el(), 'canvas')
    expect(getRenderEntry(key)?.status).toBe('pending')

    await vi.advanceTimersByTimeAsync(12_500)
    const settled = getRenderEntry(key)
    expect(settled?.status).toBe('error')
    if (settled?.status === 'error') {
      expect(settled.message).toMatch(/not responding|registered/)
    }
  })

  it('a transport arriving later rescues the pending render', async () => {
    setPluginSystemState('ready', [install()])
    requestRender(el(), 'canvas')
    const key = renderKey(el(), 'canvas')
    // the iframe boots 2 s later
    await vi.advanceTimersByTimeAsync(2_000)
    setRenderTransport('com.example.test', fakeTransport())
    requestRender(el(), 'canvas') // the node re-requests on epoch change
    await vi.runAllTimersAsync()
    expect(getRenderEntry(key)?.status).toBe('ok')
  })

  it('transport rejection (deadline/crash) becomes an error entry, never a throw', async () => {
    setPluginSystemState('ready', [install()])
    setRenderTransport(
      'com.example.test',
      fakeTransport({ callPlugin: vi.fn(async () => { throw new Error('the plugin did not answer elements.render within 10 s') }) }),
    )
    requestRender(el(), 'canvas')
    await vi.runAllTimersAsync()
    expect(getRenderEntry(renderKey(el(), 'canvas'))).toMatchObject({
      status: 'error',
      message: expect.stringContaining('did not answer'),
    })
  })

  it('unmounting the transport drops its settled renders (fresh frame may differ)', async () => {
    setPluginSystemState('ready', [install()])
    setRenderTransport('com.example.test', fakeTransport())
    requestRender(el(), 'canvas')
    const key = renderKey(el(), 'canvas')
    await vi.runAllTimersAsync()
    expect(getRenderEntry(key)?.status).toBe('ok')

    setRenderTransport('com.example.test', null)
    expect(getRenderEntry(key)).toBeUndefined()
  })
})

describe('awaitRender — the export path', () => {
  it('resolves ok entries and never rejects', async () => {
    setPluginSystemState('ready', [install()])
    setRenderTransport('com.example.test', fakeTransport())
    const entry = await awaitRender(el(), 'export')
    expect(entry.status).toBe('ok')
  })

  it('missing plugin resolves to an error entry (export draws the placeholder)', async () => {
    setPluginSystemState('ready', [])
    const pending = awaitRender(el(), 'export')
    // the boot-grace watchdog is what settles a render with no plugin
    await vi.advanceTimersByTimeAsync(13_000)
    const entry = await pending
    expect(entry.status).toBe('error')
  })
})

describe('install state store', () => {
  it('setPluginSystemState replaces the install map', () => {
    setPluginSystemState('ready', [install(), install({ pluginId: 'other.plugin', installId: 'inst_2' })])
    expect(getPluginSystemState().installs.size).toBe(2)
    setPluginSystemState('ready', [])
    expect(getPluginSystemState().installs.size).toBe(0)
  })
})
