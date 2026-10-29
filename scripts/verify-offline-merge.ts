// scripts/verify-offline-merge.ts — v0.10 live regression probe
// Boots nothing itself: point it at a RUNNING server (standalone, cloud
// preview, or a deployed URL) and it drives the offline-merge surface
// end-to-end against the real database:
//
//   1. health
//   2. anonymous probe design → GET returns v0.10 `seq` cursor
//   3. autosave with fresh baseUpdatedAt → fast path (no merge)
//   4. stale baseUpdatedAt (tab was offline) → server-side element-wise
//      merge: offline edit wins, offline addition kept, offline delete
//      tombstoned; `merged:true` + merged pages returned
//   5. the live tab's next save (older stamps) → offline work SURVIVES
//   6. collab events POST: client hlc preserved, legacy stamped by server
//   7. SSE replay: persisted events carry `_h` in the payload
//   8. permanent cleanup of the probe design
//
// Usage: npx tsx scripts/verify-offline-merge.ts [BASE_URL]
// (default http://localhost:3000). Exits non-zero on any failure.

const BASE = (process.argv[2] ?? process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')

let cookies = ''
let failures = 0
let checks = 0

function pass(label: string, detail: string) {
  checks++
  console.log(`  ✓ ${label} — ${detail}`)
}
function fail(label: string, detail: string) {
  failures++
  checks++
  console.error(`  ✗ ${label} — ${detail}`)
}

async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookies ? { cookie: cookies } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) cookies = setCookie.split(/;\s*/)[0]
  let json: any = null
  try {
    json = await res.json()
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json }
}

// HLC stamps — walltime far apart so string compare is unambiguous even
// if the server's clock skews (deterministic test, not clock-dependent)
const T_OLD = '0000000zzz:00001:probe-a' // any pre-v0.10-style early stamp
const T_LIVE = '00000010y0:00002:probe-a' // live tab edit
const T_OFF = '00000011y0:00003:probe-b' // offline tab edit (newer)

function el(id: string, text: string, _m?: string) {
  return { id, type: 'text', x: 10, y: 10, width: 200, height: 60, text, ...(_m ? { _m } : {}) }
}

async function main() {
  console.log(`verify-offline-merge → ${BASE}`)

  // 1. health
  const health = await api('GET', '/api/health')
  if (health.status === 200 && health.json?.ok === true) pass('health', `templates=${health.json.templates}`)
  else fail('health', `status ${health.status}`)

  // 2. probe design + v0.10 GET fields
  const created = await api('POST', '/api/designs', { name: 'offline-merge-probe', width: 800, height: 600 })
  if (created.status !== 201) return fail('probe design', `create → ${created.status}`)
  const designId = created.json.id
  const pageId = 'p1'
  try {
    pass('probe design', `${designId}`)

    const got = await api('GET', `/api/designs/${designId}`)
    const hasSeq = typeof got.json?.seq === 'number'
    if (got.status === 200 && hasSeq) pass('GET seq', `seq=${got.json.seq}`)
    else fail('GET seq', `status ${got.status}, seq=${got.json?.seq}`)
    const staleBase = got.json?.updatedAt as string | undefined // tab B loads HERE

    // 3. fast path — fresh baseUpdatedAt, plain save
    const save1 = await api('PUT', `/api/designs/${designId}`, {
      name: 'offline-merge-probe',
      pages: [{ id: pageId, background: { kind: 'solid', color: '#ffffff' }, elements: [el('E0', 'original', T_OLD), el('E1', 'live-old', T_OLD)] }],
      baseUpdatedAt: got.json.updatedAt,
    })
    if (save1.status === 200 && !save1.json?.merged) pass('fast path', 'fresh baseUpdatedAt → overwrite, no merge')
    else fail('fast path', `status ${save1.status} merged=${save1.json?.merged}`)
    const liveBase = save1.json?.updatedAt as string // tab A's fresh base

    // 4. offline tab PUTs against the STALE base (it loaded before save1):
    //    E0 deleted (tombstone), E1 edited with a NEWER stamp, E2 added
    const offlinePages = [
      {
        id: pageId,
        background: { kind: 'solid', color: '#ffffff' },
        elements: [el('E1', 'offline-newer', T_OFF), el('E2', 'offline-added', T_OFF)],
        tombstones: { E0: T_OFF },
      },
    ]
    const save2 = await api('PUT', `/api/designs/${designId}`, {
      name: 'offline-merge-probe',
      pages: offlinePages,
      baseUpdatedAt: staleBase, // ← divergent: server moved on with save1
    })
    if (save2.status !== 200 || save2.json?.merged !== true)
      fail('divergent merge', `status ${save2.status} merged=${save2.json?.merged}`)
    else {
      const pages = save2.json.pages as any[]
      const page = pages?.find((p) => p.id === pageId)
      const e0 = page?.elements.find((e: any) => e.id === 'E0')
      const e1 = page?.elements.find((e: any) => e.id === 'E1')
      const e2 = page?.elements.find((e: any) => e.id === 'E2')
      pass('divergent merge', 'merged:true returned')
      if (!e0) pass('offline delete', 'E0 tombstoned away')
      else fail('offline delete', 'E0 still present')
      if (e1?.text === 'offline-newer') pass('LWW edit', 'newer offline stamp won E1')
      else fail('LWW edit', `E1.text=${e1?.text}`)
      if (e2) pass('offline addition', 'E2 kept')
      else fail('offline addition', 'E2 missing')
    }

    // 5. live tab saves its own (older-stamped) copy → offline work survives
    const save3 = await api('PUT', `/api/designs/${designId}`, {
      name: 'offline-merge-probe',
      pages: [{ id: pageId, background: { kind: 'solid', color: '#ffffff' }, elements: [el('E0', 'original', T_OLD), el('E1', 'live-old', T_LIVE)] }],
      baseUpdatedAt: liveBase, // also stale now (server moved on with save2)
    })
    if (save3.status !== 200 || save3.json?.merged !== true)
      fail('converging save', `status ${save3.status} merged=${save3.json?.merged}`)
    else {
      const page = (save3.json.pages as any[])?.find((p) => p.id === pageId)
      const e0 = page?.elements.find((e: any) => e.id === 'E0')
      const e1 = page?.elements.find((e: any) => e.id === 'E1')
      const e2 = page?.elements.find((e: any) => e.id === 'E2')
      if (e1?.text === 'offline-newer') pass('converging save', 'older live edit lost E1, offline work survived')
      else fail('converging save', `E1.text=${e1?.text} (offline work clobbered!)`)
      if (e2) pass('addition survives', 'E2 still present after live save')
      else fail('addition survives', 'E2 lost')
      if (!e0) pass('delete survives', 'E0 still tombstoned')
      else fail('delete survives', 'E0 resurrected')
    }

    // 6. collab events — client hlc preserved, legacy gets a server stamp
    const ev = await api('POST', `/api/collab/${designId}/events`, {
      pid: 'probe-pid',
      events: [
        { eventId: 'probe-ev-1', hlc: '00000012y0:00009:probe-b', op: { kind: 'elements:update', pageId, ids: ['E1'], patch: { text: 'via-sse' } } },
        { eventId: 'probe-ev-2', op: { kind: 'elements:update', pageId, ids: ['E2'], patch: { text: 'legacy-client' } } }, // NO hlc → server stamps
      ],
    })
    if (ev.status === 200 && ev.json?.accepted === 2) pass('events POST', '2 ops accepted')
    else fail('events POST', `status ${ev.status} body=${JSON.stringify(ev.json).slice(0, 120)}`)

    // 7. SSE replay — both events stream back with `_h` in the payload
    const ac = new AbortController()
    const sse = await fetch(`${BASE}/api/collab/${designId}/stream?since=0&pid=probe-pid`, {
      headers: cookies ? { cookie: cookies } : {},
      signal: ac.signal,
    })
    const found = { client: false, server: false }
    if (sse.ok && sse.body) {
      const reader = sse.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      const deadline = Date.now() + 8000
      while (Date.now() < deadline && !(found.client && found.server)) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          try {
            const frame = JSON.parse(line.slice(5).trim())
            for (const e of frame.events ?? []) {
              // stream ids are DB row ids (client eventIds aren't persisted)
              // → match ops by their patch payload
              const h = e.payload?._h
              const texts = JSON.stringify(e.payload?.patch ?? {})
              if (texts.includes('via-sse') && h === '00000012y0:00009:probe-b') found.client = true
              if (texts.includes('legacy-client') && typeof h === 'string' && h.endsWith(':srv')) found.server = true
            }
          } catch {
            /* keep-alive / partial */
          }
        }
      }
      ac.abort()
    }
    if (found.client) pass('SSE client hlc', 'payload._h preserved verbatim')
    else fail('SSE client hlc', 'probe-ev-1 not observed with its stamp')
    if (found.server) pass('SSE server stamp', 'legacy op stamped …:srv:')
    else fail('SSE server stamp', 'probe-ev-2 not observed with a server stamp')
  } finally {
    // 8. cleanup — permanent delete
    const del = await api('DELETE', `/api/designs/${designId}?permanent=1`)
    if (del.status === 200) pass('cleanup', 'probe design deleted')
    else fail('cleanup', `status ${del.status} (manual cleanup needed: ${designId})`)
  }

  console.log(`\n${failures === 0 ? 'ALL GREEN' : 'FAILURES PRESENT'} — ${checks - failures}/${checks} checks passed`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('probe crashed:', err)
  process.exit(1)
})
