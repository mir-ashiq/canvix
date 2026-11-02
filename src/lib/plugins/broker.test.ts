import { describe, expect, it, vi } from 'vitest'
import { PluginBroker, PANEL_ACTION_TYPES, RPC_RATE_CALLS, NOTIFY_TEXT_MAX, type BrokerHost, type BrokerInstall, type PostableWindow } from './broker'
import { PluginStorage, type StorageLike } from './plugin-storage'
import { rpcOk } from './rpc'
import type { PageData } from '@/lib/types'

// The broker is where the security model becomes real: origin
// identity, one-time handshake, rate budget, default-deny
// permissions, whitelist actions, read-only suspension. Every
// property below is a §4.3/§4.6/§4.7 requirement, and each one
// fails CLOSED (an error envelope or silence — never a pass).

class FakeWindow {
  sent: unknown[] = []
  postMessage(message: unknown): void {
    this.sent.push(message)
  }
}

function memoryStorage(): StorageLike {
  const map = new Map<string, string>()
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size
    },
  }
}

const PAGES: PageData[] = [
  {
    id: 'page_1',
    background: { type: 'solid', color: '#FFFFFF' },
    elements: [
      {
        id: 'el_1',
        type: 'text',
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        rotation: 0,
        opacity: 1,
        locked: false,
        visible: true,
        text: 'words',
        fontSize: 40,
        fontFamily: 'Inter',
        bold: false,
        italic: false,
        underline: false,
        strike: false,
        uppercase: false,
        fill: '#000000',
        align: 'center',
        lineHeight: 1.2,
        letterSpacing: 0,
      } as never,
    ],
  } as PageData,
]

interface TestOpts {
  permissions?: string[]
  readOnly?: boolean
}

function makeBroker(opts: TestOpts = {}) {
  const install: BrokerInstall = {
    installId: 'inst_1',
    pluginId: 'com.example.test',
    version: '1.0.0',
    permissions: opts.permissions ?? ['design:read', 'design:write', 'storage', 'ui:notify'],
  }
  const applyAction = vi.fn(async () => 'applied')
  const notify = vi.fn()
  const closePanel = vi.fn()
  const logError = vi.fn()
  const host: BrokerHost = {
    getDesignState: () => ({ pages: PAGES, currentPage: 0, readOnly: opts.readOnly ?? false }),
    applyAction,
    notify,
    closePanel,
    logError,
  }
  const clock = { t: 1_000_000 }
  const broker = new PluginBroker({
    install,
    host,
    storage: new PluginStorage(install.pluginId, memoryStorage()),
    hostVersion: '0.13.2',
    now: () => clock.t,
  })
  const frame = new FakeWindow()
  broker.attach(frame as unknown as PostableWindow, 'handshake-token-1', () => {})
  const ev = (data: unknown, source: unknown = frame) => ({ source, data }) as unknown as MessageEvent
  // dispatch() is async — flush enough microtask turns for send() to land
  const flush = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  }
  const call = async (method: string, params?: unknown, extra: Record<string, unknown> = {}) => {
    broker.handleMessage(ev({ v: 1, id: `c${frame.sent.length}`, dir: 'call', method, params, ...extra }))
    await flush()
  }
  const last = () => frame.sent[frame.sent.length - 1] as { id?: string; ok?: boolean; error?: { code: string; message: string }; result?: unknown }
  const callOk = async (method: string, params?: unknown) => {
    await call(method, params, { handshake: 'handshake-token-1' })
  }
  return { broker, frame, ev, call, callOk, last, host: { applyAction, notify, closePanel, logError }, clock }
}

describe('origin discipline', () => {
  it('ignores messages from any window other than the mounted frame', () => {
    const { broker, frame } = makeBroker()
    const stranger = new FakeWindow()
    broker.handleMessage({ source: stranger, data: { v: 1, id: 'x', dir: 'call', method: 'ping', handshake: 'handshake-token-1' } } as unknown as MessageEvent)
    broker.handleMessage({ source: null, data: { v: 1, id: 'x', dir: 'call', method: 'ping', handshake: 'handshake-token-1' } } as MessageEvent)
    broker.handleMessage({ source: new FakeWindow() as unknown as PostableWindow, data: { v: 1, id: 'x', dir: 'call', method: 'ping', handshake: 'handshake-token-1' } } as unknown as MessageEvent)
    expect(frame.sent).toHaveLength(0)
    expect(broker.isVerified).toBe(false)
  })

  it('ignores non-object payloads', () => {
    const { broker, frame, ev } = makeBroker()
    broker.handleMessage(ev('ping'))
    broker.handleMessage(ev(null))
    broker.handleMessage(ev(42))
    expect(frame.sent).toHaveLength(0)
  })
})

describe('handshake (one-time token echo)', () => {
  it('rejects the first call lacking the handshake with E_PERMISSION and stays unverified', () => {
    const { broker, ev, last } = makeBroker()
    broker.handleMessage(ev({ v: 1, id: 'c1', dir: 'call', method: 'ping' }))
    expect(last().error?.code).toBe('E_PERMISSION')
    expect(last().error?.message).toContain('handshake')
    expect(broker.isVerified).toBe(false)
  })

  it('rejects a wrong token and stays unverified', async () => {
    const { broker, frame, ev, last } = makeBroker()
    broker.handleMessage(ev({ v: 1, id: 'c1', dir: 'call', method: 'ping', handshake: 'wrong-token-99' }))
    await Promise.resolve()
    expect(last().error?.code).toBe('E_PERMISSION')
    expect(broker.isVerified).toBe(false)
    // and the frame got exactly one rejection
    expect(frame.sent).toHaveLength(1)
  })

  it('accepts the right token once; later calls need not repeat it', async () => {
    const { broker, ev, last } = makeBroker()
    broker.handleMessage(ev({ v: 1, id: 'c1', dir: 'call', method: 'ping', handshake: 'handshake-token-1' }))
    await Promise.resolve()
    expect(last().ok).toBe(true)
    expect(broker.isVerified).toBe(true)
    broker.handleMessage(ev({ v: 1, id: 'c2', dir: 'call', method: 'ping' }))
    await Promise.resolve()
    expect((last() as { ok?: boolean }).ok).toBe(true)
  })

  it('a failed handshake does not consume rate budget', async () => {
    const { broker, ev, last } = makeBroker()
    for (let i = 0; i < RPC_RATE_CALLS + 20; i++) {
      broker.handleMessage(ev({ v: 1, id: `bad${i}`, dir: 'call', method: 'ping', handshake: 'nope-nope' }))
    }
    expect(last().error?.code).toBe('E_PERMISSION')
    broker.handleMessage(ev({ v: 1, id: 'good', dir: 'call', method: 'ping', handshake: 'handshake-token-1' }))
    await Promise.resolve()
    expect((last() as { ok?: boolean }).ok).toBe(true)
  })
})

describe('envelope validation', () => {
  it('answers protocol mismatch with E_VERSION', async () => {
    const { broker, ev, last } = makeBroker()
    broker.handleMessage(ev({ v: 2, id: 'c1', dir: 'call', method: 'ping', handshake: 'handshake-token-1' }))
    await Promise.resolve()
    expect(last().error?.code).toBe('E_VERSION')
  })

  it('answers malformed envelopes with E_MALFORMED; unknown dirs are ignored silently', async () => {
    const { broker, frame, ev, last } = makeBroker()
    // a dir that is neither call nor result is noise — no answer at all
    broker.handleMessage(ev({ v: 1, id: 'c0', dir: 'side', method: 'ping' }))
    expect(frame.sent).toHaveLength(0)
    broker.handleMessage(ev({ v: 1, id: '!!bad id!!', dir: 'call', method: 'ping', handshake: 'handshake-token-1' }))
    await Promise.resolve()
    expect(last().error?.code).toBe('E_MALFORMED')
  })

  it('answers unknown methods with E_METHOD', async () => {
    const { broker, ev, last } = makeBroker()
    broker.handleMessage(ev({ v: 1, id: 'c1', dir: 'call', method: 'host.readFile', handshake: 'handshake-token-1' }))
    await Promise.resolve()
    expect(last().error?.code).toBe('E_METHOD')
    // prototype-chain tricks must not "find" methods either
    broker.handleMessage(ev({ v: 1, id: 'c2', dir: 'call', method: 'constructor', handshake: 'handshake-token-1' }))
    await Promise.resolve()
    expect(last().error?.code).toBe('E_METHOD')
  })

  it('answers oversized params with E_PAYLOAD', async () => {
    const { broker, ev, last } = makeBroker()
    broker.handleMessage(ev({ v: 1, id: 'c1', dir: 'call', method: 'storage.set', params: { key: 'k', value: 'x'.repeat(300 * 1024) }, handshake: 'handshake-token-1' }))
    await Promise.resolve()
    expect(last().error?.code).toBe('E_PAYLOAD')
  })
})

describe('rate limit', () => {
  it('allows RPC_RATE_CALLS per minute then answers E_THROTTLE', async () => {
    const { broker, ev, last } = makeBroker()
    for (let i = 0; i < RPC_RATE_CALLS; i++) {
      broker.handleMessage(ev({ v: 1, id: `p${i}`, dir: 'call', method: 'ping', handshake: 'handshake-token-1' }))
    }
    await Promise.resolve()
    expect((last() as { ok?: boolean }).ok).toBe(true)
    broker.handleMessage(ev({ v: 1, id: 'over', dir: 'call', method: 'ping' }))
    await Promise.resolve()
    expect(last().error?.code).toBe('E_THROTTLE')
  })

  it('recovers when the window slides', async () => {
    const { broker, ev, last, clock } = makeBroker()
    for (let i = 0; i < RPC_RATE_CALLS; i++) {
      broker.handleMessage(ev({ v: 1, id: `p${i}`, dir: 'call', method: 'ping', handshake: 'handshake-token-1' }))
    }
    broker.handleMessage(ev({ v: 1, id: 'over', dir: 'call', method: 'ping' }))
    expect(last().error?.code).toBe('E_THROTTLE')
    clock.t += 61_000
    broker.handleMessage(ev({ v: 1, id: 'fresh', dir: 'call', method: 'ping' }))
    await Promise.resolve()
    expect((last() as { ok?: boolean }).ok).toBe(true)
  })
})

describe('permissions (default-deny)', () => {
  it('denies a granted-but-not-consented method with E_PERMISSION', async () => {
    const { callOk, last } = makeBroker({ permissions: ['design:read'] }) // no design:write
    await callOk('actions.apply', { action: { type: 'addText', text: 'x' } })
    expect(last().error?.code).toBe('E_PERMISSION')
  })

  it('denies storage when storage was not granted', async () => {
    const { callOk, last } = makeBroker({ permissions: [] })
    await callOk('storage.set', { key: 'k', value: 1 })
    expect(last().error?.code).toBe('E_PERMISSION')
    await callOk('storage.keys')
    expect(last().error?.code).toBe('E_PERMISSION')
  })

  it('ui.notify requires ui:notify', async () => {
    const { callOk, last } = makeBroker({ permissions: [] })
    await callOk('ui.notify', { text: 'hello' })
    expect(last().error?.code).toBe('E_PERMISSION')
  })

  it('info and ping need no permission', async () => {
    const { callOk, last } = makeBroker({ permissions: [] })
    await callOk('ping')
    expect((last() as { ok?: boolean }).ok).toBe(true)
    await callOk('info')
    const info = last().result as { api: { major: number; minor: number }; host: string; plugin: { id: string }; capabilities: { panel: boolean; renderer: boolean } }
    expect(info.api.major).toBe(1)
    expect(info.host).toBe('0.13.2')
    expect(info.plugin.id).toBe('com.example.test')
    expect(info.capabilities).toEqual({ panel: true, renderer: false })
  })
})

describe('design.getSnapshot', () => {
  it('returns the projected read-only snapshot', async () => {
    const { callOk, last } = makeBroker({ permissions: ['design:read'] })
    await callOk('design.getSnapshot')
    const r = last()
    expect(r.ok).toBe(true)
    const snap = r.result as { pages: { elements: { id: string; type: string; text: string }[] }[]; currentPage: number }
    expect(snap.pages[0]!.elements[0]!.id).toBe('el_1')
    expect(snap.pages[0]!.elements[0]!.text).toBe('words')
  })

  it('denies without design:read', async () => {
    const { callOk, last } = makeBroker({ permissions: [] })
    await callOk('design.getSnapshot')
    expect(last().error?.code).toBe('E_PERMISSION')
  })
})

describe('subscribe + pushEvent', () => {
  it('rejects unknown topics with E_PAYLOAD', async () => {
    const { callOk, last } = makeBroker({ permissions: ['design:read'] })
    await callOk('subscribe', { topic: 'cookies' })
    expect(last().error?.code).toBe('E_PAYLOAD')
  })

  it('pushes events only for subscribed topics', async () => {
    const { broker, frame, callOk } = makeBroker({ permissions: ['design:read'] })
    await callOk('subscribe', { topic: 'selection' })
    broker.pushEvent('selection', { ids: ['el_1'] })
    broker.pushEvent('document', { pages: 1 }) // not subscribed — dropped
    const pushes = frame.sent.filter((m) => (m as { method?: string }).method === 'event')
    expect(pushes).toHaveLength(1)
    expect((pushes[0] as { params: { topic: string; payload: unknown } }).params).toEqual({ topic: 'selection', payload: { ids: ['el_1'] } })
  })

  it('settles the ack when the plugin answers, and drops it after dispose', async () => {
    const { broker, frame, ev, callOk } = makeBroker({ permissions: ['design:read'] })
    await callOk('subscribe', { topic: 'selection' })
    broker.pushEvent('selection', { ids: [] })
    const push = frame.sent.find((m) => (m as { method?: string }).method === 'event') as { id: string }
    expect(push).toBeTruthy()
    broker.handleMessage(ev(rpcOk(push.id, { ok: true }))) // ack — no throw
    broker.pushEvent('selection', { ids: ['x'] })
    broker.dispose()
    const count = frame.sent.filter((m) => (m as { method?: string }).method === 'event').length
    expect(count).toBe(2) // post-dispose push produced nothing
  })

  it('ignores plugin results before the handshake completed', () => {
    const { broker, frame, ev } = makeBroker()
    broker.handleMessage(ev(rpcOk('whatever', { ok: true })))
    expect(frame.sent).toHaveLength(0)
  })
})

describe('actions.apply', () => {
  it('executes a whitelisted action through the host', async () => {
    const { callOk, host, last } = makeBroker()
    await callOk('actions.apply', { action: { type: 'addText', text: 'hi' } })
    expect(last().ok).toBe(true)
    expect(host.applyAction).toHaveBeenCalledWith({ type: 'addText', text: 'hi' })
    expect((last().result as { message: string }).message).toBe('applied')
  })

  it('rejects action types outside the panel whitelist with E_PAYLOAD', async () => {
    const { callOk, last } = makeBroker()
    for (const type of ['generateImage', 'translate', 'addPluginElement', 'updatePluginElementData', '__proto__', '']) {
      await callOk('actions.apply', { action: { type } })
      expect(last().error?.code).toBe('E_PAYLOAD')
    }
    expect(PANEL_ACTION_TYPES.has('addText')).toBe(true)
  })

  it('suspends writes on read-only designs with E_PERMISSION', async () => {
    const { callOk, last } = makeBroker({ readOnly: true })
    await callOk('actions.apply', { action: { type: 'addText', text: 'x' } })
    expect(last().error?.code).toBe('E_PERMISSION')
  })

  it('rejects non-object action params with E_PAYLOAD', async () => {
    const { callOk, last } = makeBroker()
    await callOk('actions.apply', { action: 'addText' })
    expect(last().error?.code).toBe('E_PAYLOAD')
    await callOk('actions.apply', {})
    expect(last().error?.code).toBe('E_PAYLOAD')
  })

  it('a host-side throw answers E_INTERNAL and logs privately', async () => {
    const { callOk, last, host } = makeBroker()
    host.applyAction.mockRejectedValueOnce(new Error('internal detail'))
    await callOk('actions.apply', { action: { type: 'addText', text: 'x' } })
    expect(last().error?.code).toBe('E_INTERNAL')
    expect(host.logError).toHaveBeenCalled()
    expect(JSON.stringify(last())).not.toContain('internal detail')
  })
})

describe('storage methods', () => {
  it('round-trips values inside the plugin namespace', async () => {
    const { callOk, last } = makeBroker({ permissions: ['storage'] })
    await callOk('storage.set', { key: 'palette', value: ['#fff', '#000'] })
    await callOk('storage.get', { key: 'palette' })
    expect((last().result as { value: unknown }).value).toEqual(['#fff', '#000'])
    await callOk('storage.keys')
    expect((last().result as { keys: string[] }).keys).toEqual(['palette'])
    await callOk('storage.remove', { key: 'palette' })
    await callOk('storage.get', { key: 'palette' })
    expect((last().result as { value: unknown }).value).toBeNull()
  })

  it('surfaces quota errors as E_PAYLOAD-coded errors', async () => {
    const { callOk, last } = makeBroker({ permissions: ['storage'] })
    await callOk('storage.set', { key: 'big', value: 'z'.repeat(70 * 1024) })
    expect(last().ok).toBe(false)
    expect(last().error?.code).toBe('E_PAYLOAD')
    expect(last().error?.message).toContain('storage')
  })

  it('rejects malformed keys with E_PAYLOAD', async () => {
    const { callOk, last } = makeBroker({ permissions: ['storage'] })
    await callOk('storage.set', { key: '../escape', value: 1 })
    expect(last().ok).toBe(false)
    expect(last().error?.code).toBe('E_PAYLOAD')
  })
})

describe('ui methods', () => {
  it('notifies with sanitized, capped text', async () => {
    const { callOk, host } = makeBroker({ permissions: ['ui:notify'] })
    await callOk('ui.notify', { text: `a${'b'.repeat(NOTIFY_TEXT_MAX)}c` })
    expect(host.notify).toHaveBeenCalledTimes(1)
    const text = host.notify.mock.calls[0]![0] as string
    expect(text.length).toBe(NOTIFY_TEXT_MAX)
    await callOk('ui.notify', { text: 'ok\x00\x07fine' })
    expect(host.notify.mock.calls[1]![0]).toBe('okfine')
  })

  it('rejects non-string or empty notify text', async () => {
    const { callOk, last } = makeBroker({ permissions: ['ui:notify'] })
    await callOk('ui.notify', { text: 42 })
    expect(last().error?.code).toBe('E_PAYLOAD')
    await callOk('ui.notify', { text: '   ' })
    expect(last().error?.code).toBe('E_PAYLOAD')
  })

  it('closePanel reaches the host', async () => {
    const { callOk, host } = makeBroker({ permissions: ['ui:notify'] })
    await callOk('ui.closePanel')
    expect(host.closePanel).toHaveBeenCalledTimes(1)
  })
})

describe('elements.registerRenderer (P4 preview semantics)', () => {
  it('answers E_METHOD in panel context even with the permission granted', async () => {
    const { callOk, last } = makeBroker({ permissions: ['element:plugin'] })
    await callOk('elements.registerRenderer', { kind: 'cloud', fn: 1 })
    expect(last().error?.code).toBe('E_METHOD')
  })
})

describe('lifecycle', () => {
  it('a disposed broker goes silent', async () => {
    const { broker, frame, ev } = makeBroker()
    broker.handleMessage(ev({ v: 1, id: 'c1', dir: 'call', method: 'ping', handshake: 'handshake-token-1' }))
    await Promise.resolve()
    expect(frame.sent).toHaveLength(1)
    broker.dispose()
    broker.handleMessage(ev({ v: 1, id: 'c2', dir: 'call', method: 'ping' }))
    await Promise.resolve()
    expect(frame.sent).toHaveLength(1)
    broker.pushEvent('selection', {}) // must not throw even with subscriptions
  })

  it('registerRenderer stays reserved for service context (catalog sanity)', async () => {
    // the method is in the wire catalog so P4 service iframes can use it;
    // panel brokers must keep refusing it (tested above)
    const { callOk, last } = makeBroker({ permissions: ['element:plugin'] })
    await callOk('elements.registerRenderer', { kind: 'k' })
    expect(last().error?.code).toBe('E_METHOD')
  })
})
