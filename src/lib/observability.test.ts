import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  buildErrorReport,
  logApiRequest,
  requestLoggingEnabled,
  withLogging,
} from './observability'

// H7: the observability floor — logging is opt-in, the wrapper is a
// zero-behavior-change passthrough by default, and the webhook
// payload never carries more than the documented fields.

beforeEach(() => {
  delete process.env.CANVIX_LOG
  vi.restoreAllMocks()
})

afterEach(() => {
  delete process.env.CANVIX_LOG
})

describe('request logging gate', () => {
  it('is off by default and for unknown values', () => {
    expect(requestLoggingEnabled()).toBe(false)
    process.env.CANVIX_LOG = 'off'
    expect(requestLoggingEnabled()).toBe(false)
    process.env.CANVIX_LOG = 'requests'
    expect(requestLoggingEnabled()).toBe(true)
    process.env.CANVIX_LOG = '1'
    expect(requestLoggingEnabled()).toBe(true)
  })
})

describe('withLogging', () => {
  it('is a passthrough (same response, no logs) when disabled', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const handler = vi.fn(async () => new Response('ok', { status: 201 }))
    const wrapped = withLogging('GET /api/x', handler)
    const res = await wrapped(new NextRequest('http://canvix.test/api/x?secret=1'))
    expect(res.status).toBe(201)
    expect(await res.text()).toBe('ok')
    expect(handler).toHaveBeenCalledOnce()
    expect(logSpy).not.toHaveBeenCalled()
  })

  it('logs one JSON line with method, path (no query), status, duration', async () => {
    process.env.CANVIX_LOG = 'requests'
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const wrapped = withLogging('GET /api/designs', async () => new Response('ok'))
    const res = await wrapped(new NextRequest('http://canvix.test/api/designs?cursor=abc&id=x'))
    expect(res.status).toBe(200)
    expect(logSpy).toHaveBeenCalledOnce()
    const line = JSON.parse(logSpy.mock.calls[0][0] as string)
    expect(line.event).toBe('http_request')
    expect(line.method).toBe('GET')
    // privacy: the query string (cursor/id data) must not be logged
    expect(line.path).toBe('/api/designs')
    expect(String(line.path)).not.toContain('cursor')
    expect(line.status).toBe(200)
    expect(typeof line.duration_ms).toBe('number')
    expect(typeof line.ts).toBe('string')
  })

  it('logs status 500 and rethrows when the handler throws', async () => {
    process.env.CANVIX_LOG = 'requests'
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapped = withLogging('POST /api/x', async () => {
      throw new Error('boom')
    })
    await expect(wrapped(new NextRequest('http://canvix.test/api/x', { method: 'POST' }))).rejects.toThrow('boom')
    const line = JSON.parse(logSpy.mock.calls[0][0] as string)
    expect(line.status).toBe(500)
    expect(errSpy).not.toHaveBeenCalled() // the wrapper logs via the info line
  })

  it('passes route params through untouched (typed second arg)', async () => {
    const handler = vi.fn(
      async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
        new Response(JSON.stringify(ctx ? 'has-ctx' : 'no-ctx')),
    )
    const wrapped = withLogging('PUT /api/designs/[id]', handler)
    const ctx = { params: Promise.resolve({ id: 'd1' }) }
    const res = await wrapped(
      new NextRequest('http://canvix.test/api/designs/d1', { method: 'PUT' }),
      ctx,
    )
    expect(handler).toHaveBeenCalledWith(expect.anything(), ctx)
    expect(res.status).toBe(200)
  })
})

describe('logApiRequest (shape)', () => {
  it('rounds duration and carries a request id when present', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    logApiRequest({ method: 'GET', path: '/api/health', status: 200, durationMs: 12.3456, requestId: 'r-1' })
    const line = JSON.parse(logSpy.mock.calls[0][0] as string)
    expect(line.duration_ms).toBe(12.35)
    expect(line.request_id).toBe('r-1')
  })
})

describe('buildErrorReport (webhook payload)', () => {
  it('carries the documented fields, bounded and id-free', () => {
    const report = buildErrorReport(
      new Error('exploded'),
      { path: '/api/designs/d123', method: 'PUT' },
      { routeType: 'route' },
    )
    expect(report.message).toBe('Error: exploded')
    expect(report.path).toBe('/api/designs/d123')
    expect(report.method).toBe('PUT')
    expect(report.routeType).toBe('route')
    expect(typeof report.appVersion).toBe('string')
    expect(typeof report.at).toBe('string')
    expect(Object.keys(report).sort()).toEqual(
      ['appVersion', 'at', 'message', 'method', 'path', 'routeType', 'stackHead'].sort(),
    )
  })

  it('stringifies non-Error throws and bounds the message', () => {
    const report = buildErrorReport('just a string', { path: '/x', method: 'GET' })
    expect(report.message).toBe('Error: just a string')
    const long = buildErrorReport(new Error('x'.repeat(2000)), { path: '/x', method: 'GET' })
    expect(report.message.length).toBeLessThanOrEqual(500)
  })
})

describe('error webhook wiring (instrumentation.onRequestError)', () => {
  it('POSTs the report to CANVIX_ERROR_WEBHOOK_URL over real HTTP', async () => {
    // local receiver on an ephemeral port
    const { createServer } = await import('node:http')
    const received: Array<{ body: string; contentType: string }> = []
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        received.push({ body, contentType: req.headers['content-type'] ?? '' })
        res.writeHead(204)
        res.end()
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    process.env.CANVIX_ERROR_WEBHOOK_URL = `http://127.0.0.1:${port}/hook`

    vi.spyOn(console, 'error').mockImplementation(() => {})
    // the real hook, exactly as Next invokes it
    const { onRequestError } = await import('../instrumentation')
    await onRequestError(
      new Error('route blew up'),
      { path: '/api/designs/xyz?cursor=1', method: 'PUT', headers: {} },
      { routePath: '/api/designs/[id]/route', routeType: 'route' },
    )

    // fire-and-forget POST lands shortly
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(received).toHaveLength(1)
    expect(received[0].contentType).toBe('application/json')
    const payload = JSON.parse(received[0].body)
    expect(payload.message).toBe('Error: route blew up')
    expect(payload.method).toBe('PUT')
    expect(payload.routeType).toBe('route')

    delete process.env.CANVIX_ERROR_WEBHOOK_URL
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('does nothing (no fetch) when the webhook is unset', async () => {
    delete process.env.CANVIX_ERROR_WEBHOOK_URL
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { onRequestError } = await import('../instrumentation')
    // resolves without touching the network
    await onRequestError(
      new Error('quiet'),
      { path: '/x', method: 'GET', headers: {} },
      { routePath: '/x', routeType: 'route' },
    )
  })
})
