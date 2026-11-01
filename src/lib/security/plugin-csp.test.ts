import { describe, expect, it } from 'vitest'
import { parseGrantedOrigin, pluginServeCsp } from './plugin-csp'

// H3: the draft CSP the v0.13 plugin serve route (P1) will attach.
// Pinned byte-for-byte so the consent screen, the route and the
// security suite (P4) all agree on what “strict” means.

describe('parseGrantedOrigin', () => {
  it('accepts plain https origins and canonicalises them', () => {
    expect(parseGrantedOrigin('https://api.example.com')).toBe('https://api.example.com')
    expect(parseGrantedOrigin('  https://api.example.com/very/long/path  ')).toBe(
      'https://api.example.com',
    )
  })

  it('accepts loopback http for development builds only', () => {
    expect(parseGrantedOrigin('http://127.0.0.1:8787/health')).toBe('http://127.0.0.1:8787')
    expect(parseGrantedOrigin('http://localhost:3000')).toBe('http://localhost:3000')
    expect(parseGrantedOrigin('http://example.com')).toBeNull()
    expect(parseGrantedOrigin('http://192.168.1.5:8787')).toBeNull()
  })

  it('rejects junk, credentials and fragments', () => {
    expect(parseGrantedOrigin('')).toBeNull()
    expect(parseGrantedOrigin('not a url')).toBeNull()
    expect(parseGrantedOrigin('ftp://example.com')).toBeNull()
    expect(parseGrantedOrigin('https://user:pass@example.com')).toBeNull()
    expect(parseGrantedOrigin('https://example.com/#leak')).toBeNull()
  })
})

describe('pluginServeCsp', () => {
  it('zero grants collapse connect-src to none — a real exfiltration wall', () => {
    const csp = pluginServeCsp([])
    expect(csp).toBe(
      [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'unsafe-inline'",
        'img-src data: blob:',
        "connect-src 'none'",
        'font-src data:',
        "frame-ancestors 'self'",
        "form-action 'none'",
        "base-uri 'none'",
      ].join('; '),
    )
  })

  it('lists granted origins verbatim, deduplicated and canonical', () => {
    const csp = pluginServeCsp([
      'https://api.example.com/v1',
      'https://api.example.com',
      'https://cdn.other.org',
      'http://evil.example',
    ])
    expect(csp).toContain('connect-src https://api.example.com https://cdn.other.org')
  })

  it('never widens: invalid entries are dropped, not fatal', () => {
    const csp = pluginServeCsp(['garbage', 'http://127.0.0.1:9911/x'])
    expect(csp).toContain('connect-src http://127.0.0.1:9911')
  })
})
