// Unit tests for the v0.9.1 CSRF guard (same-origin enforcement on
// cookie-authenticated mutations).
//
// The contract: browsers ALWAYS attach Origin (or a Referer fallback) to
// cross-site requests; when either header is present it must match the
// request's own host. Non-browser clients send neither — allowed (no
// ambient cookie authority to abuse).

import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { isSameOrigin } from './csrf'

function req(headers: Record<string, string> = {}, url = 'http://canvix.test/api/designs'): NextRequest {
  return new NextRequest(url, { method: 'POST', headers })
}

describe('isSameOrigin', () => {
  it('allows requests with no Origin/Referer (curl, MCP, health probes)', () => {
    expect(isSameOrigin(req())).toBe(true)
    expect(isSameOrigin(req({ 'user-agent': 'curl/8.0' }))).toBe(true)
  })

  it('allows same-origin Origin headers (exact host match)', () => {
    expect(isSameOrigin(req({ host: 'canvix.test', origin: 'http://canvix.test' }))).toBe(true)
    expect(isSameOrigin(req({ host: 'canvix.test', origin: 'https://canvix.test/editor' }))).toBe(true)
  })

  it('allows the port to match via the URL host', () => {
    expect(
      isSameOrigin(req({ host: 'localhost:3000', origin: 'http://localhost:3000' }, 'http://localhost:3000/api/x'))
    ).toBe(true)
  })

  it('rejects cross-origin Origin headers', () => {
    expect(isSameOrigin(req({ host: 'canvix.test', origin: 'https://evil.example' }))).toBe(false)
    expect(isSameOrigin(req({ host: 'canvix.test', origin: 'http://canvix.test.evil.com' }))).toBe(false)
    expect(isSameOrigin(req({ host: 'canvix.test', origin: 'https://sub.canvix.test' }))).toBe(false)
  })

  it('rejects cross-origin Referer fallbacks', () => {
    expect(
      isSameOrigin(req({ host: 'canvix.test', referer: 'https://evil.example/attack.html' }))
    ).toBe(false)
  })

  it('allows same-origin Referer fallbacks', () => {
    expect(
      isSameOrigin(req({ host: 'canvix.test', referer: 'https://canvix.test/dashboard' }))
    ).toBe(true)
  })

  it('rejects malformed Origin headers rather than guessing', () => {
    expect(isSameOrigin(req({ host: 'canvix.test', origin: 'not a url' }))).toBe(false)
    expect(isSameOrigin(req({ host: 'canvix.test', origin: 'https://' }))).toBe(false)
  })

  it('treats an empty Origin value as absent (browsers never send it empty)', () => {
    // Documented behaviour: `Origin: ` (empty) cannot be a browser fetch —
    // real browsers either omit the header or send a valid URL. Non-browser
    // clients have no ambient cookie authority, so this is safe to allow.
    expect(isSameOrigin(req({ host: 'canvix.test', origin: '' }))).toBe(true)
  })

  it('honours x-forwarded-host behind a reverse proxy', () => {
    expect(
      isSameOrigin(req({ host: '127.0.0.1:3000', 'x-forwarded-host': 'canvix.example.com', origin: 'https://canvix.example.com' }))
    ).toBe(true)
    expect(
      isSameOrigin(req({ host: '127.0.0.1:3000', 'x-forwarded-host': 'canvix.example.com', origin: 'https://evil.example' }))
    ).toBe(false)
  })

  it('rejects when no host information exists at all', () => {
    expect(isSameOrigin(req({ origin: 'https://evil.example' }))).toBe(false)
  })
})
