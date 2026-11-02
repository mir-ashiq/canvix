import { describe, expect, it } from 'vitest'
import {
  HOST_CALL_METHODS,
  MAX_NETWORK_ORIGINS,
  describePermission,
  methodAllowed,
  normalizePermissions,
  parsePermission,
  requiredPermission,
} from './permissions'

// P1 security boundary: permissions are manifest-declared,
// user-granted, broker-enforced — default-deny everywhere.

describe('parsePermission', () => {
  it('accepts the five catalog permissions', () => {
    for (const p of ['design:read', 'design:write', 'element:plugin', 'storage', 'ui:notify']) {
      expect(parsePermission(p)?.permission).toBe(p)
    }
  })

  it('canonicalises network permissions through the CSP origin parser', () => {
    expect(parsePermission('network:https://api.example.com')).toEqual({
      permission: 'network:https://api.example.com',
      name: 'network',
      origin: 'https://api.example.com',
    })
    // trailing junk collapses to the origin
    expect(parsePermission('network:https://api.example.com/path?q=1')?.permission).toBe(
      'network:https://api.example.com',
    )
    expect(parsePermission('network:http://127.0.0.1:8787')?.origin).toBe('http://127.0.0.1:8787')
  })

  it('rejects unknown, malformed and smuggled permissions', () => {
    for (const bad of [
      'design:admin', // not in catalog
      'network:http://evil.example.com', // plain http off-loopback
      'network:', // empty origin
      'network:https://user:pass@example.com', // credentials
      'storage:extra', // smuggled suffix
      '*', '', 'DESIGN:READ',
    ]) {
      expect(parsePermission(bad)).toBeNull()
    }
  })
})

describe('describePermission (consent screen copy)', () => {
  it('mentions the origin for network grants and stays plain-language', () => {
    const d = describePermission(parsePermission('network:https://api.example.com')!)
    expect(d).toContain('https://api.example.com')
    for (const p of ['design:read', 'design:write', 'element:plugin', 'storage', 'ui:notify']) {
      expect(describePermission(parsePermission(p)!).length).toBeGreaterThan(10)
    }
  })
})

describe('normalizePermissions', () => {
  it('splits and dedupes permissions vs network origins', () => {
    const r = normalizePermissions([
      'design:read',
      'design:read',
      'network:https://a.example.com',
      'network:https://a.example.com/',
      'storage',
    ])
    expect(r).toEqual({
      ok: true,
      permissions: ['design:read', 'storage'],
      networkOrigins: ['https://a.example.com'],
    })
  })

  it('fails closed on any unknown entry', () => {
    expect(normalizePermissions(['design:read', 'design:nuke']).ok).toBe(false)
    expect(normalizePermissions('design:read').ok).toBe(false)
    expect(normalizePermissions(undefined).ok).toBe(false)
  })

  it('caps network origins', () => {
    const many = Array.from({ length: MAX_NETWORK_ORIGINS + 1 }, (_, i) => `network:https://s${i}.example.com`)
    expect(normalizePermissions(many).ok).toBe(false)
  })
})

describe('requiredPermission / methodAllowed (broker discipline)', () => {
  it('maps every §4.3 method to its permission', () => {
    expect(requiredPermission('info')).toBeNull()
    expect(requiredPermission('ping')).toBeNull()
    expect(requiredPermission('design.getSnapshot')).toBe('design:read')
    expect(requiredPermission('subscribe')).toBe('design:read')
    expect(requiredPermission('actions.apply')).toBe('design:write')
    expect(requiredPermission('elements.registerRenderer')).toBe('element:plugin')
    expect(requiredPermission('storage.get')).toBe('storage')
    expect(requiredPermission('storage.set')).toBe('storage')
    expect(requiredPermission('ui.notify')).toBe('ui:notify')
    expect(requiredPermission('ui.closePanel')).toBe('ui:notify')
  })

  it('returns undefined for unknown methods (E_METHOD, not E_PERMISSION)', () => {
    expect(requiredPermission('design.exfiltrate')).toBeUndefined()
    expect(requiredPermission('eval')).toBeUndefined()
    expect(requiredPermission('__proto__')).toBeUndefined()
  })

  it('enforces default-deny for granted lists', () => {
    const none: string[] = []
    expect(methodAllowed('info', none)).toBe(true)
    expect(methodAllowed('ping', none)).toBe(true)
    expect(methodAllowed('design.getSnapshot', none)).toBe(false)
    expect(methodAllowed('actions.apply', ['design:read'])).toBe(false)
    expect(methodAllowed('actions.apply', ['design:read', 'design:write'])).toBe(true)
    // a method that does not exist is never allowed
    expect(methodAllowed('design.exfiltrate', ['design:read', 'design:write'])).toBe(false)
  })

  it('keeps host→plugin calls in a separate catalog', () => {
    expect(HOST_CALL_METHODS.has('elements.render')).toBe(true)
    expect(HOST_CALL_METHODS.has('event')).toBe(true)
    // the broker must never accept host-only methods FROM a plugin
    expect(requiredPermission('elements.render')).toBeUndefined()
    expect(requiredPermission('event')).toBeUndefined()
  })
})
