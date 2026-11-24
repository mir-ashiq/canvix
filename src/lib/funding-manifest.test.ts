// ─────────────────────────────────────────────────────────────
// funding.json manifest guard (v0.29.5).
//
// The FOSS United application rides entirely on this manifest —
// the grants directory pulls it weekly from
// raw.githubusercontent.com/mir-ashiq/canvix/refs/heads/main/funding.json.
// A silent regression (bad field, broken reference, drifted total)
// would propagate to the public listing with nobody noticing. This
// test validates the manifest against the fundingjson.org v1.1.0
// contract offline (the official schema's rules, restated here so
// CI never depends on the network) plus Canvix-specific invariants.
// Full official-schema validation (fastjsonschema against the live
// schema document) is recorded in docs/FUNDING-VALIDATION.md.
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../')
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'funding.json'), 'utf8')) as Record<string, unknown>
const wellKnown = readFileSync(path.join(ROOT, 'public/.well-known/funding-manifest-urls'), 'utf8')

const GUID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const TAG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

describe('funding.json — fundingjson.org v1.1.0 contract', () => {
  it('entity: individual maintainer with the correct identity and contact', () => {
    const e = manifest.entity as Record<string, unknown>
    expect(e.type).toBe('individual')
    expect(e.role).toBe('maintainer')
    expect(e.name).toBe('Ashiq Hussain Mir')
    expect(e.email).toBe('imseldrith@gmail.com')
    expect(String(e.description).length).toBeLessThanOrEqual(2000)
    expect((e.webpageUrl as Record<string, unknown>).url).toBe('https://github.com/mir-ashiq')
  })

  it('project: canvix with canvix.app webpage, MIT license, schema-shaped tags', () => {
    const p = (manifest.projects as Record<string, unknown>[])[0]
    expect(p.guid).toMatch(GUID_RE)
    expect(String(p.guid).length).toBeLessThanOrEqual(32)
    expect(p.name).toBe('Canvix')
    expect(String(p.description).length).toBeLessThanOrEqual(2000)
    expect((p.webpageUrl as Record<string, unknown>).url).toBe('https://canvix.app')
    expect((p.repositoryUrl as Record<string, unknown>).url).toBe('https://github.com/mir-ashiq/canvix')
    expect(p.licenses).toEqual(['spdx:MIT'])
    const tags = p.tags as string[]
    expect(tags.length).toBeLessThanOrEqual(10)
    for (const t of tags) {
      expect(t).toMatch(TAG_RE)
      expect(t.length).toBeLessThanOrEqual(32)
    }
  })

  it('funding plans: four INR milestones, valid guids, referenced channels, ₹5,00,000 total', () => {
    const f = manifest.funding as Record<string, unknown>
    const channels = f.channels as Record<string, unknown>[]
    const plans = f.plans as Record<string, unknown>[]
    const channelGuids = new Set(channels.map((c) => c.guid as string))
    const TYPES = ['bank', 'payment-provider', 'cheque', 'cash', 'other']
    for (const c of channels) {
      expect(c.guid).toMatch(GUID_RE)
      expect(TYPES).toContain(c.type)
      expect(String(c.address ?? '').length).toBeLessThanOrEqual(250)
    }
    expect(plans).toHaveLength(4)
    let total = 0
    for (const plan of plans) {
      expect(String(plan.guid)).toMatch(GUID_RE)
      expect(String(plan.guid).length).toBeLessThanOrEqual(32)
      expect(plan.status).toBe('active')
      expect(plan.currency).toBe('INR')
      expect(plan.frequency).toBe('one-time')
      for (const ref of plan.channels as string[]) expect(channelGuids).toContain(ref)
      expect(String(plan.description ?? '').length).toBeLessThanOrEqual(2000)
      total += plan.amount as number
    }
    // M1 1,30,000 · M2 1,20,000 · M3 1,20,000 · M4 1,30,000 — one-time ₹5,00,000
    expect(plans.map((p) => p.amount)).toEqual([130000, 120000, 120000, 130000])
    expect(total).toBe(500000)
  })

  it('no private financial data ships in the manifest (placeholder channel only)', () => {
    const channels = (manifest.funding as Record<string, unknown>).channels as Record<string, string>[]
    for (const c of channels) {
      const blob = `${c.guid} ${c.type} ${c.address ?? ''} ${c.description ?? ''}`
      expect(/\d{9,}/.test(blob)).toBe(false) // no account/IFSC-style digit runs
      expect(/ifsc|swift|iban/i.test(blob)).toBe(false)
    }
  })

  it('the .well-known verification file authorizes exactly the canonical manifest URL', () => {
    const lines = wellKnown.split('\n').map((l) => l.trim()).filter(Boolean)
    expect(lines).toEqual(['https://raw.githubusercontent.com/mir-ashiq/canvix/refs/heads/main/funding.json'])
  })

  it('wellKnown ownership claim is withheld until production serves the file (honesty guard)', () => {
    // When canvix.app/.well-known/funding-manifest-urls is verified live,
    // flip this to 'include' — see docs/FUNDING-VALIDATION.md §website.
    const p = (manifest.projects as Record<string, unknown>[])[0]
    expect((p.webpageUrl as Record<string, unknown>).wellKnown).toBeUndefined()
  })
})
