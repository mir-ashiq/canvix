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
//
// v0.32.7: the well-known guards now cover every fetchable form of
// the manifest URL — the directory and the official validator do
// exact-string membership, and one canonical form was repeatedly
// "not found in the .well-known list" (see §8 there). The domain
// copy public/funding.json and the repo-root .well-known file are
// guarded here byte-for-byte.
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../')
const manifestRaw = readFileSync(path.join(ROOT, 'funding.json'), 'utf8')
const manifest = JSON.parse(manifestRaw) as Record<string, unknown>
const wellKnown = readFileSync(path.join(ROOT, 'public/.well-known/funding-manifest-urls'), 'utf8')
const repoWellKnown = readFileSync(path.join(ROOT, '.well-known/funding-manifest-urls'), 'utf8')
const domainManifest = readFileSync(path.join(ROOT, 'public/funding.json'), 'utf8')

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

  it('the .well-known verification file authorizes every fetchable form of the manifest URL', () => {
    // The checkers do exact-string membership, not normalization: the
    // directory crawl looked for the github.com/raw/refs/heads form and
    // the official validator was handed the github.com/blob form —
    // v0.32.6's single raw.githubusercontent form matched neither
    // ("manifest URL … was not found in the .well-known list"). Every
    // line below is a fetchable form of the same manifest: the raw
    // forms serve it byte-identical; the blob form is GitHub's file
    // view of it; the last is the domain-hosted copy (asserted below).
    const lines = wellKnown.split('\n').map((l) => l.trim()).filter(Boolean)
    expect(lines).toEqual([
      'https://raw.githubusercontent.com/mir-ashiq/canvix/refs/heads/main/funding.json',
      'https://raw.githubusercontent.com/mir-ashiq/canvix/main/funding.json',
      'https://github.com/mir-ashiq/canvix/blob/main/funding.json',
      'https://github.com/mir-ashiq/canvix/raw/refs/heads/main/funding.json',
      'https://github.com/mir-ashiq/canvix/raw/main/funding.json',
      'https://canvix.app/funding.json',
    ])
  })

  it('the repository .well-known file mirrors the served one byte for byte', () => {
    // github.com cannot serve /.well-known per repository, so the official
    // v1.1.0 schema documents the wellKnown proof for repositoryUrl as a
    // file IN the repository — this one, at the conventional repo path.
    expect(repoWellKnown).toBe(wellKnown)
  })

  it('repositoryUrl wellKnown points at the in-repo verification file (activated 2026-11-26)', () => {
    const p = (manifest.projects as Record<string, unknown>[])[0]
    expect((p.repositoryUrl as Record<string, unknown>).wellKnown).toBe(
      'https://github.com/mir-ashiq/canvix/blob/main/.well-known/funding-manifest-urls',
    )
  })

  it('public/funding.json is a byte-identical copy of the repository manifest', () => {
    // canvix.app/funding.json — the manifest hosted on the domain itself
    // and listed in the well-known file. Drift between the two copies
    // would publish two different manifests under the same listing.
    expect(domainManifest).toBe(manifestRaw)
    const copy = JSON.parse(domainManifest) as Record<string, unknown>
    expect(copy.$schema).toBe('https://fundingjson.org/schema/v1.1.0.json')
  })

  it('wellKnown ownership claim is ACTIVE and points at the live verification file (activated 2026-11-24)', () => {
    // Activation history: the claim was withheld until
    // https://canvix.app/.well-known/funding-manifest-urls served the exact
    // manifest URL in production — verified live on 2026-11-24 (deploy 52eb8e0)
    // before this property was added. If this ever breaks, production stopped
    // serving the file: fix the deployment, not the test.
    const p = (manifest.projects as Record<string, unknown>[])[0]
    expect((p.webpageUrl as Record<string, unknown>).wellKnown).toBe(
      'https://canvix.app/.well-known/funding-manifest-urls',
    )
  })
})
