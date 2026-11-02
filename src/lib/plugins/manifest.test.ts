import { describe, expect, it } from 'vitest'
import { checkEntryHtml, isSafeEntryPath, validateManifest } from './manifest'

// §4.1 rules, pinned. The golden fixture IS the Word Cloud
// reference plugin's manifest (§5) — if the validator rejects it,
// the validator is wrong.

const HOST = { hostAppVersion: '0.13.0' }

const WORDCLOUD = {
  canvixPluginApi: '1',
  id: 'com.canvix.wordcloud',
  name: 'Word Cloud',
  description: 'Turn page text into a word-cloud graphic',
  version: '1.0.0',
  author: { name: 'Canvix team' },
  engines: { canvix: '>=0.13.0 <0.14.0' },
  entry: { panel: 'panel.html' },
  files: ['panel.html', 'app.js'],
  permissions: ['design:read', 'design:write', 'element:plugin', 'storage'],
  elements: [
    {
      kind: 'cloud',
      label: 'Word cloud',
      initialData: { words: [], palette: ['#7630D7', '#02C0CC'], seed: 1 },
      schema: [
        { key: 'seed', type: 'number', label: 'Random seed', min: 1, max: 9999 },
        { key: 'mask', type: 'select', label: 'Shape', options: [
          { value: 'rect', label: 'Rectangle' },
          { value: 'circle', label: 'Circle' },
        ] },
      ],
    },
  ],
}

// A loose type for the fixture — tests mutate everything.
interface ManifestFixture {
  canvixPluginApi?: string
  id?: string
  name?: string
  description?: string
  version?: string
  author?: { name: string }
  engines: { canvix: string }
  entry: { panel?: string }
  permissions: string[]
  files?: string[]
  elements?: Array<{
    kind: string
    label: string
    initialData: Record<string, unknown>
    schema: Array<Record<string, unknown>>
  }>
}

// The schema declares a `mask` select; initialData carries 'rect'.
// Every fixture here is a fresh deep clone so tests stay independent.
const wordcloud = (): ManifestFixture => {
  const m = JSON.parse(JSON.stringify(WORDCLOUD)) as ManifestFixture
  m.elements![0].initialData.mask = 'rect'
  return m
}

describe('validateManifest — the golden fixture', () => {
  it('accepts the Word Cloud manifest (first-party id allowed)', () => {
    const r = validateManifest(wordcloud(), { ...HOST, allowFirstParty: true })
    expect(r.ok ? [] : r.errors).toEqual([])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.manifest.id).toBe('com.canvix.wordcloud')
      expect(r.manifest.elements![0].kind).toBe('cloud')
      expect(r.networkOrigins).toEqual([])
    }
  })

  it('rejects the reserved com.canvix.* id for third-party installs', () => {
    const r = validateManifest(wordcloud(), HOST)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join('\n')).toMatch(/reserved/)
  })

  it('a third-party twin with a different id passes', () => {
    const m = wordcloud()
    m.id = 'net.example.wordcloud'
    expect(validateManifest(m, HOST).ok).toBe(true)
  })
})

describe('validateManifest — version gates', () => {
  it('accepts matching api major with equal/lower minor', () => {
    for (const api of ['1', '1.0']) {
      const m = wordcloud()
      m.id = 'net.example.wordcloud'
      m.canvixPluginApi = api
      expect(validateManifest(m, HOST).ok).toBe(true)
    }
  })

  it('rejects newer api (major and minor) with actionable messages', () => {
    const newer = wordcloud()
    newer.id = 'net.example.wordcloud'
    newer.canvixPluginApi = '2'
    const r1 = validateManifest(newer, HOST)
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.errors.join('\n')).toMatch(/update Canvix/)

    const additive = wordcloud()
    additive.id = 'net.example.wordcloud'
    additive.canvixPluginApi = '1.5'
    const r2 = validateManifest(additive, HOST)
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.errors.join('\n')).toMatch(/v1\.5/)
  })

  it('rejects garbage api strings', () => {
    for (const api of ['one', '', '1.', 'v1', '1.2.3', 1, null]) {
      const m = wordcloud()
      m.id = 'net.example.wordcloud'
      ;(m as unknown as Record<string, unknown>).canvixPluginApi = api
      expect(validateManifest(m, HOST).ok).toBe(false)
    }
  })

  it('engines.canvix is checked against the host version', () => {
    const older = wordcloud()
    older.id = 'net.example.wordcloud'
    older.engines.canvix = '>=0.12.0 <0.13.0'
    const r = validateManifest(older, HOST)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join('\n')).toMatch(/this instance is 0\.13\.0/)

    const garbage = wordcloud()
    garbage.id = 'net.example.wordcloud'
    garbage.engines.canvix = 'whenever it feels right'
    expect(validateManifest(garbage, HOST).ok).toBe(false)
  })
})

describe('validateManifest — structural rules', () => {
  const base = () => {
    const m = wordcloud()
    m.id = 'net.example.wordcloud'
    return m
  }

  it('collects every error in one pass', () => {
    const m = base()
    delete m.name
    m.version = 'one'
    m.entry = { panel: '/abs/panel.html' }
    m.permissions = ['design:read', 'root']
    const r = validateManifest(m, HOST)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(4)
  })

  it('rejects non-objects, arrays and oversize manifests', () => {
    expect(validateManifest(null, HOST).ok).toBe(false)
    expect(validateManifest([], HOST).ok).toBe(false)
    expect(validateManifest('plugin', HOST).ok).toBe(false)
    const m = base()
    m.description = 'x'.repeat(65 * 1024)
    expect(validateManifest(m, HOST).ok).toBe(false)
  })

  it('id grammar and reserved words (doc §4.1 regex: first label ≥2 chars)', () => {
    for (const bad of ['', 'X', '-lead', 'a', 'a.b', 'dot..dot', 'UPPER', 'canvix', 'com.canvix.x', 'a.b.c.d.e', 'x'.repeat(81)]) {
      const m = base()
      m.id = bad
      expect(validateManifest(m, HOST).ok, `id "${bad}"`).toBe(false)
    }
    for (const good of ['ab', 'net.example.wordcloud', 'x-y.z-w', 'plugs.time-series', 'ab.c']) {
      const m = base()
      m.id = good
      expect(validateManifest(m, HOST).ok, `id "${good}"`).toBe(true)
    }
  })

  it('entry paths must be relative and safe (files list follows the entry)', () => {
    for (const bad of ['/abs.html', '../escape.html', 'a/../b.html', 'a\\\\b.html', 'no-ext', 'x.ht', 'a//b.html', 'https://evil/x.html']) {
      const m = base()
      m.entry = { panel: bad }
      expect(validateManifest(m, HOST).ok, `entry "${bad}"`).toBe(false)
    }
    for (const good of ['panel.html', 'ui/panel.html', 'a/b/c/d/panel.html']) {
      const m = base()
      m.entry = { panel: good }
      m.files = [good, 'app.js']
      expect(validateManifest(m, HOST).ok, `entry "${good}"`).toBe(true)
    }
  })

  it('a plugin with neither entry.panel nor elements does nothing → rejected', () => {
    const m = base()
    delete m.entry.panel
    delete m.elements
    const r = validateManifest(m, HOST)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join('\n')).toMatch(/does nothing/)
  })

  it('elements-only plugins are valid (properties slot + placeholders, no panel)', () => {
    const m = base()
    delete m.entry.panel
    expect(validateManifest(m, HOST).ok).toBe(true)
  })

  it('network permissions surface their validated origins', () => {
    const m = base()
    m.permissions.push('network:https://api.example.com', 'network:https://api.example.com/x')
    const r = validateManifest(m, HOST)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.networkOrigins).toEqual(['https://api.example.com'])
  })
})

describe('validateManifest — element schemas', () => {
  const base = () => {
    const m = wordcloud()
    m.id = 'net.example.wordcloud'
    return m
  }

  it('kind grammar, uniqueness and caps', () => {
    const m = base()
    m.elements = Array.from({ length: 21 }, (_, i) => ({ ...m.elements![0], kind: `k${i}` }))
    expect(validateManifest(m, HOST).ok).toBe(false)

    const dup = base()
    dup.elements = [dup.elements![0], { ...dup.elements![0] }]
    expect(validateManifest(dup, HOST).ok).toBe(false)

    const bad = base()
    bad.elements![0].kind = 'Cloud'
    expect(validateManifest(bad, HOST).ok).toBe(false)
  })

  it('schema/initialData coherence is enforced', () => {
    const missing = base()
    delete missing.elements![0].initialData.seed
    const r1 = validateManifest(missing, HOST)
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.errors.join('\n')).toMatch(/missing "seed"/)

    const wrongType = base()
    wrongType.elements![0].initialData.seed = 'one'
    expect(validateManifest(wrongType, HOST).ok).toBe(false)

    const outOfRange = base()
    outOfRange.elements![0].initialData.seed = 99999
    expect(validateManifest(outOfRange, HOST).ok).toBe(false)

    const badSelect = base()
    badSelect.elements![0].initialData.mask = 'hexagon'
    expect(validateManifest(badSelect, HOST).ok).toBe(false)

    const badColor = base()
    badColor.elements![0].initialData.palette = ['red']
    badColor.elements![0].schema.push({ key: 'bg', type: 'color', label: 'Bg' })
    badColor.elements![0].initialData.bg = 'red'
    expect(validateManifest(badColor, HOST).ok).toBe(false)
  })

  it('field specs validate their own shape', () => {
    const m = base()
    m.elements![0].schema = [
      { key: 'Bad-Key', type: 'number', label: 'x' }, // bad key
    ]
    expect(validateManifest(m, HOST).ok).toBe(false)

    const n = base()
    n.elements![0].schema = [{ key: 'n', type: 'number', label: 'n', min: 10, max: 5 }]
    n.elements![0].initialData = { ...n.elements![0].initialData, n: 7 }
    expect(validateManifest(n, HOST).ok).toBe(false)

    const s = base()
    s.elements![0].schema = [{ key: 's', type: 'select', label: 's', options: [{ value: 'only', label: 'One' }] }]
    expect(validateManifest(s, HOST).ok).toBe(false)
  })

  it('initialData hostile payloads fail the clone caps', () => {
    const m = base()
    m.elements![0].initialData.deep = { a: { b: { c: { d: { e: { f: { g: { h: { i: { j: { k: { l: { m: 1 } } } } } } } } } } } } }
    expect(validateManifest(m, HOST).ok).toBe(false)
  })
})

describe('isSafeEntryPath', () => {
  it('is exported for the install route to reuse on every declared file', () => {
    expect(isSafeEntryPath('panel.html')).toBe(true)
    expect(isSafeEntryPath('../x.html')).toBe(false)
    expect(isSafeEntryPath(42)).toBe(false)
  })
})

describe('checkEntryHtml (packaging rule)', () => {
  it('accepts clean panel HTML', () => {
    expect(
      checkEntryHtml('<!doctype html><html><body><div id="app"></div><script src="app.js"></script></body></html>'),
    ).toBeNull()
  })

  it('rejects inline script blocks, javascript: URIs and on-handlers', () => {
    expect(checkEntryHtml('<script>doThing()</script>')).toMatch(/inline <script>/)
    expect(checkEntryHtml('<a href="javascript:steal()">x</a>')).toMatch(/javascript:/)
    expect(checkEntryHtml('<button onclick="x()">go</button>')).toMatch(/event handlers/)
  })

  it('script src must be a relative in-bundle path', () => {
    expect(checkEntryHtml('<script src="https://evil.example.com/app.js"></script>')).toMatch(/relative/)
    expect(checkEntryHtml('<script src="//evil.example.com/app.js"></script>')).toMatch(/relative/)
    expect(checkEntryHtml('<script src="../outside/app.js"></script>')).toMatch(/inside the plugin/)
    expect(checkEntryHtml('<script src="js/app.js"></script>')).toBeNull()
  })

  it('caps the HTML size', () => {
    expect(checkEntryHtml('<p>' + 'x'.repeat(513 * 1024) + '</p>')).toMatch(/cap is/)
  })
})
