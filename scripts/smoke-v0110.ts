// scripts/smoke-v0110.ts — focused v0.11.0 production smoke test.
//
// Point at a RUNNING production server (standalone build against the live
// database — the self-host / Vercel-equivalent reference path):
//   npx tsx scripts/smoke-v0110.ts [BASE_URL]   (default http://127.0.0.1:3100)
//
// Focused scope (everything the plugin system depends on staying healthy):
//   1. auth      — register → me → logout → wrong password 401 → login
//   2. ownership — owner saves; anonymous + other account are read-only
//                  (GET readOnly:true, PUT 403, cross-origin PUT 403)
//   3. realtime  — ONE browser identity live in TWO designs at once (the
//                  v0.10.1 P2002 scenario): interleaved heartbeats + cursors
//                  + concurrent-create races all 200; events isolated per
//                  design; the participant visible in BOTH designs' streams
//   4. reconnect — SSE drop → events keep landing → ?since replay gap-free;
//                  retried flush (same eventIds) inserts nothing (idempotent);
//                  `retry: 1500` hint present; keepalives flow
//   5. media     — two-chunk WAV round-trip (offset-guard 409, finalize
//                  guards, byte-exact GET, Range 206/416, immutable headers),
//                  real MP4 upload + range playback semantics, audio+video
//                  element document round-trip
//   6. latency   — every request timed; the 30 s function-hang regression
//                  must not reappear (nothing may approach the ceiling)
//   7. db state  — presence rows for the probe pid exist in BOTH designs
//                  simultaneously (impossible under the old single-column PK)
//
// Probe rows (users, designs, events, presence, media) are removed at the end.

export {}

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createScriptClient } from '../src/lib/db-script'

const BASE = (process.argv[2] ?? process.env.BASE_URL ?? 'http://127.0.0.1:3100').replace(/\/$/, '')
const EVIL = 'https://evil-smoke.example'

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
function note(label: string, detail: string) {
  console.log(`  · ${label} — ${detail}`)
}

// ── latency ledger (the 30 s-hang guard) ─────────────────────
interface ReqStat {
  label: string
  ms: number
  status: number
}
const reqStats: ReqStat[] = []
async function hfetch(label: string, url: string, init?: RequestInit): Promise<Response> {
  const full = url.startsWith('http') ? url : `${BASE}${url}`
  const t0 = Date.now()
  try {
    const res = await fetch(full, init)
    reqStats.push({ label, ms: Date.now() - t0, status: res.status })
    return res
  } catch (err) {
    reqStats.push({ label, ms: Date.now() - t0, status: 0 })
    throw err
  }
}

// ── minimal cookie jar ───────────────────────────────────────
class Jar {
  private jar = new Map<string, string>()
  update(res: Response) {
    const h = res.headers as Headers & { getSetCookie?: () => string[] }
    const raw = typeof h.getSetCookie === 'function' ? h.getSetCookie() : []
    for (const c of raw) {
      const [pair] = c.split(';')
      const eq = pair.indexOf('=')
      if (eq > 0) this.jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
    }
  }
  get header(): string | undefined {
    return this.jar.size ? [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ') : undefined
  }
}

// ── SSE reader (what the browser's EventSource sees) ─────────
interface StreamFrame {
  events: { seq: number; eventId?: string; kind: string; actorId: string }[]
  presence: { id: string; name: string; cursor: unknown }[]
  seq: number
}
class SSEReader {
  frames: StreamFrame[] = []
  comments: string[] = []
  retryHint: string | null = null
  closed = false
  private ctrl = new AbortController()
  private opened = false

  constructor(readonly designId: string, readonly pid: string) {}

  async open(since = 0): Promise<void> {
    const res = await fetch(`${BASE}/api/collab/${this.designId}/stream?since=${since}&pid=${this.pid}`, {
      signal: this.ctrl.signal,
      headers: { accept: 'text/event-stream' },
    })
    if (res.status !== 200) throw new Error(`stream opened with ${res.status}`)
    const reader = res.body!.getReader()
    const dec = new TextDecoder()
    let buf = ''
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          let idx: number
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, idx)
            buf = buf.slice(idx + 2)
            this.handle(chunk)
          }
        }
      } catch {
        /* aborted mid-read — expected on drop */
      }
      this.closed = true
    })()
    // the server emits `: open design=… since=…` on start — await it
    const t0 = Date.now()
    while (!this.opened && Date.now() - t0 < 10_000) await sleep(100)
    if (!this.opened) throw new Error('stream never sent its open comment')
  }

  private handle(chunk: string) {
    for (const line of chunk.split('\n')) {
      if (line.startsWith('data: ')) {
        try {
          this.frames.push(JSON.parse(line.slice(6)) as StreamFrame)
        } catch {
          /* partial frame — ignored */
        }
      } else if (line.startsWith('retry: ')) {
        this.retryHint = line.slice(7).trim()
      } else if (line.startsWith(': ')) {
        const c = line.slice(2)
        this.comments.push(c)
        if (c.startsWith('open ')) this.opened = true
      }
    }
  }

  abort() {
    this.ctrl.abort()
  }

  countEvent(eventId: string): number {
    return this.frames.reduce((n, f) => n + f.events.filter((e) => e.eventId === eventId).length, 0)
  }
  hasPresence(pid: string): boolean {
    return this.frames.some((f) => f.presence.some((p) => p.id === pid))
  }
  lastSeq(): number {
    let s = 0
    for (const f of this.frames) {
      if (f.seq > s) s = f.seq
      for (const e of f.events) if (e.seq > s) s = e.seq
    }
    return s
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

async function waitFor<T>(desc: string, fn: () => T | undefined, timeoutMs = 15_000): Promise<T> {
  const t0 = Date.now()
  for (;;) {
    const v = fn()
    if (v !== undefined) return v
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${desc}`)
    await sleep(150)
  }
}

// ── collab helpers ───────────────────────────────────────────
interface Envelope {
  eventId: string
  hlc: string
  op: Record<string, unknown>
}
let envSeq = 0
function envelope(op: Record<string, unknown>): Envelope {
  envSeq++
  return { eventId: `smoke-${Date.now()}-${envSeq}`, hlc: `${Date.now()}:0:smoke`, op }
}
const addRect = (id: string) => ({
  kind: 'element:add',
  pageId: 'p1',
  element: {
    id,
    type: 'rect',
    x: 12,
    y: 12,
    width: 140,
    height: 90,
    fill: '#02C0CC',
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
  },
})
const rename = (name: string) => ({ kind: 'design:rename', name })

async function flushEvents(designId: string, pid: string, events: Envelope[]) {
  const res = await hfetch(`POST collab/events (${designId.slice(0, 8)})`, `/api/collab/${designId}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pid, name: 'Smoke Probe', color: '#7630D7', events }),
  })
  const body = (await res.json().catch(() => null)) as { accepted?: number; rejected?: string[] } | null
  return { status: res.status, body }
}

async function heartbeat(designId: string, pid: string, cursor = false) {
  const res = await hfetch(`POST collab/presence (${designId.slice(0, 8)})`, `/api/collab/${designId}/presence`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      pid,
      name: 'Smoke Probe',
      color: '#FF5C8A',
      ...(cursor ? { cursor: { page: 0, x: 111.5, y: 42.25, selection: [] } } : {}),
    }),
  })
  return res.status
}

// ── probe payloads ───────────────────────────────────────────
/** minimal mono 16-bit PCM WAV (~4.2 MB → forces two upload chunks), 120 BPM clicks */
function makeWav(): Uint8Array<ArrayBuffer> {
  const sampleRate = 44_100
  const samples = Math.floor((4.2 * 1024 * 1024) / 2)
  const buf = new Uint8Array(44 + samples * 2)
  const dv = new DataView(buf.buffer)
  const w = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i))
  }
  w(0, 'RIFF')
  dv.setUint32(4, 36 + samples * 2, true)
  w(8, 'WAVE')
  w(12, 'fmt ')
  dv.setUint32(16, 16, true)
  dv.setUint16(20, 1, true)
  dv.setUint16(22, 1, true)
  dv.setUint32(24, sampleRate, true)
  dv.setUint32(28, sampleRate * 2, true)
  dv.setUint16(32, 2, true)
  dv.setUint16(34, 16, true)
  w(36, 'data')
  dv.setUint32(40, samples * 2, true)
  const period = Math.floor(sampleRate * 0.5)
  for (let i = 0; i < samples; i++) {
    const t = i % period
    const v = t < 400 ? Math.round(Math.exp(-t / 80) * 22000 * (t % 4 < 2 ? 1 : -1)) : 0
    dv.setInt16(44 + i * 2, v, true)
  }
  return buf
}

/** real H.264+AAC mp4 via ffmpeg (2 s testsrc + 440 Hz sine) */
function makeMp4(): Uint8Array<ArrayBuffer> | null {
  const p = join(tmpdir(), 'canvix-smoke-probe.mp4')
  try {
    if (!existsSync(p)) {
      execFileSync(
        'ffmpeg',
        [
          '-y', '-loglevel', 'error',
          '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=15',
          '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', p,
        ],
        { timeout: 30_000 },
      )
    }
    const buf = readFileSync(p)
    return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  } catch {
    return null
  }
}

// ── probe registry (for the DB cleanup at the end) ───────────
const probe = {
  users: [] as string[],
  designs: [] as string[],
  media: [] as string[],
  pids: [] as string[],
}

// ── media upload helper (the client's chunked-upload lifecycle) ──
async function uploadMedia(mime: string, bytes: Uint8Array<ArrayBuffer>): Promise<string | null> {
  const init = await hfetch('POST /api/media (init)', '/api/media', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mime, size: bytes.length }),
  })
  const j = (await init.json().catch(() => null)) as { id?: string; chunkSize?: number } | null
  if (init.status !== 201 || !j?.id) {
    fail('media init', `status ${init.status}`)
    return null
  }
  const id = j.id
  probe.media.push(id)
  const chunkSize = j.chunkSize ?? 3 * 1024 * 1024
  for (let off = 0; off < bytes.length; off += chunkSize) {
    const part = bytes.subarray(off, Math.min(off + chunkSize, bytes.length))
    const r = await hfetch(`PATCH /api/media chunk@${off}`, `/api/media/${id}?offset=${off}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/octet-stream' },
      body: part,
    })
    if (r.status !== 200) fail('media chunk', `offset ${off} → ${r.status}`)
  }
  const fin = await hfetch('PUT /api/media (finalize)', `/api/media/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedSize: bytes.length }),
  })
  if (fin.status !== 200) fail('media finalize', `status ${fin.status}`)
  return id
}

async function main() {
  console.log(`smoke-v0110 → ${BASE}\n`)
  const TS = Date.now()
  const owner = new Jar()
  const other = new Jar()
  const anon = new Jar()
  const USER_OWNER = `smoke_owner_${TS}`
  const USER_OTHER = `smoke_other_${TS}`
  const PASS = 'smoke-Tr0ub4dor-pass'
  const PID_MAIN = `smoke-main-${TS}`
  const PID_OBS = `smoke-obs-${TS}`
  probe.users.push(USER_OWNER, USER_OTHER)
  probe.pids.push(PID_MAIN, PID_OBS)

  // ═══ 1. auth — registration / login ═════════════════════════
  console.log('── 1. account registration & login')
  {
    let res = await hfetch('POST /api/auth/register', '/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: USER_OWNER, password: PASS }),
    })
    owner.update(res)
    if (res.status === 201) pass('register', `201, ${USER_OWNER}`)
    else fail('register', `status ${res.status}: ${await res.text()}`)

    res = await hfetch('GET /api/auth/me (signed in)', '/api/auth/me', { headers: { cookie: owner.header! } })
    const me = (await res.json().catch(() => null)) as { user?: { username?: string } } | null
    if (me?.user?.username === USER_OWNER) pass('me after register', 'session cookie valid')
    else fail('me after register', `user=${JSON.stringify(me)}`)

    res = await hfetch('POST /api/auth/logout', '/api/auth/logout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.header! },
    })
    owner.update(res)
    res = await hfetch('GET /api/auth/me (logged out)', '/api/auth/me', { headers: { cookie: owner.header! } })
    const me2 = (await res.json().catch(() => null)) as { user?: unknown } | null
    if (me2?.user == null) pass('logout', 'session revoked')
    else fail('logout', 'still signed in')

    const bad = await hfetch('POST /api/auth/login (wrong pw)', '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: USER_OWNER, password: 'wrong-password' }),
    })
    if (bad.status === 401) pass('wrong password', '401')
    else fail('wrong password', `status ${bad.status}`)

    res = await hfetch('POST /api/auth/login', '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: USER_OWNER, password: PASS }),
    })
    owner.update(res)
    if (res.status === 200) pass('login', '200, fresh session')
    else fail('login', `status ${res.status}`)

    res = await hfetch('POST /api/auth/register (other)', '/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: USER_OTHER, password: PASS }),
    })
    other.update(res)
    if (res.status === 201) pass('second account', `201, ${USER_OTHER}`)
    else fail('second account', `status ${res.status}`)

    // duplicate username — LAST (each register POST consumes one hit from
    // the 5/hour/IP bucket; the priority accounts are already created)
    const dup = await hfetch('POST /api/auth/register (dup)', '/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: USER_OWNER, password: PASS }),
    })
    if (dup.status === 409) pass('duplicate username', '409')
    else if (dup.status === 429) note('duplicate username', 'rate-limited (5/h/IP) — expected on back-to-back runs')
    else fail('duplicate username', `status ${dup.status}`)
  }

  // ═══ 2. ownership & read-only access ════════════════════════
  console.log('\n── 2. design ownership & read-only access')
  let designX = ''
  {
    let res = await hfetch('POST /api/designs (owner)', '/api/designs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.header! },
      body: JSON.stringify({ name: 'smoke ownership probe', width: 800, height: 600 }),
    })
    const created = (await res.json().catch(() => null)) as { id?: string } | null
    if (res.status === 201 && created?.id) {
      designX = created.id
      probe.designs.push(designX)
      pass('owner create', `201, ${designX.slice(0, 10)}…`)
    } else fail('owner create', `status ${res.status}`)

    // owner save — fast path (fresh baseUpdatedAt, no merge)
    res = await hfetch('GET /api/designs/[id] (owner)', `/api/designs/${designX}`, { headers: { cookie: owner.header! } })
    const mine = (await res.json().catch(() => null)) as { updatedAt?: string; readOnly?: boolean } | null
    if (mine?.readOnly === false) pass('owner GET', 'readOnly=false')
    else fail('owner GET', `readOnly=${mine?.readOnly}`)

    res = await hfetch('PUT /api/designs/[id] (owner save)', `/api/designs/${designX}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: owner.header! },
      body: JSON.stringify({
        name: 'smoke ownership probe (saved)',
        baseUpdatedAt: mine?.updatedAt,
        pages: [{ id: 'p1', background: { kind: 'solid', color: '#ffffff' }, elements: [] }],
      }),
    })
    const saved = (await res.json().catch(() => null)) as { merged?: boolean } | null
    if (res.status === 200 && !saved?.merged) pass('owner save', '200, fast path (no merge)')
    else fail('owner save', `status ${res.status} merged=${saved?.merged}`)

    // anonymous browser: link-open is read-only
    res = await hfetch('GET /api/designs/[id] (anon)', `/api/designs/${designX}`)
    const anonView = (await res.json().catch(() => null)) as { readOnly?: boolean; name?: string } | null
    if (res.status === 200 && anonView?.readOnly === true) pass('anon GET', '200, readOnly=true (link view)')
    else fail('anon GET', `status ${res.status} readOnly=${anonView?.readOnly}`)

    const anonPut = await hfetch('PUT /api/designs/[id] (anon)', `/api/designs/${designX}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: anon.header ?? '' },
      body: JSON.stringify({ name: 'hijacked' }),
    })
    if (anonPut.status === 403) pass('anon PUT', '403 — cannot edit')
    else fail('anon PUT', `status ${anonPut.status}`)

    // a DIFFERENT signed-in account is equally read-only
    res = await hfetch('GET /api/designs/[id] (other account)', `/api/designs/${designX}`, { headers: { cookie: other.header! } })
    const otherView = (await res.json().catch(() => null)) as { readOnly?: boolean } | null
    if (res.status === 200 && otherView?.readOnly === true) pass('other-account GET', '200, readOnly=true')
    else fail('other-account GET', `status ${res.status} readOnly=${otherView?.readOnly}`)

    const otherPut = await hfetch('PUT /api/designs/[id] (other account)', `/api/designs/${designX}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: other.header! },
      body: JSON.stringify({ name: 'hijacked by other' }),
    })
    if (otherPut.status === 403) pass('other-account PUT', '403 — ownership enforced')
    else fail('other-account PUT', `status ${otherPut.status}`)

    const csrf = await hfetch('PUT /api/designs/[id] (cross-origin)', `/api/designs/${designX}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: EVIL, cookie: owner.header! },
      body: JSON.stringify({ name: 'csrf probe' }),
    })
    if (csrf.status === 403) pass('cross-origin PUT', '403 — CSRF guard')
    else fail('cross-origin PUT', `status ${csrf.status}`)
  }

  // ═══ 3. real-time collaboration across two designs ══════════
  console.log('\n── 3. one browser, two designs (the v0.10.1 P2002 scenario)')
  let designA = ''
  let designB = ''
  {
    for (const [label, name] of [
      ['A', 'smoke realtime A'],
      ['B', 'smoke realtime B'],
    ] as const) {
      const res = await hfetch(`POST /api/designs (${label})`, '/api/designs', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: owner.header! },
        body: JSON.stringify({ name, width: 800, height: 600 }),
      })
      const j = (await res.json().catch(() => null)) as { id?: string } | null
      if (res.status === 201 && j?.id) {
        if (label === 'A') designA = j.id
        else designB = j.id
        probe.designs.push(j.id)
      } else fail(`create design ${label}`, `status ${res.status}`)
    }
    pass('two designs created', 'A + B (one owner)')

    // one OBSERVER browser reads both streams; MAIN is "one browser in two designs"
    const obsA = new SSEReader(designA, PID_OBS)
    const obsB = new SSEReader(designB, PID_OBS)
    await obsA.open(0)
    await obsB.open(0)
    pass('SSE open', 'observer streams live on A and B')

    // interleaved heartbeats + cursors into BOTH designs — every single one
    // of these used to 502 with P2002 before migration 0004
    let hbOk = true
    for (let r = 1; r <= 4; r++) {
      const sA = await heartbeat(designA, PID_MAIN, true)
      const sB = await heartbeat(designB, PID_MAIN, true)
      if (sA !== 200 || sB !== 200) hbOk = false
      await sleep(1_200)
    }
    if (hbOk) pass('heartbeats in both designs', '8/8 interleaved (4×A + 4×B) all 200')
    else fail('heartbeats in both designs', 'some heartbeat did not return 200')

    // concurrent-create race on the same (design, pid) — belt-and-braces path
    const race = await Promise.all([
      heartbeat(designA, PID_MAIN),
      heartbeat(designA, PID_MAIN),
      heartbeat(designA, PID_MAIN),
    ])
    if (race.every((s) => s === 200)) pass('concurrent presence race', '3 simultaneous POSTs all 200 (P2002 fallback)')
    else fail('concurrent presence race', `statuses ${race.join(',')}`)

    // events into A, then into B — must stay isolated
    const eA1 = envelope(addRect('smoke-rect-A1'))
    const eA2 = envelope(rename('smoke realtime A (renamed)'))
    const eB1 = envelope(addRect('smoke-rect-B1'))
    const eB2 = envelope(rename('smoke realtime B (renamed)'))
    const fA = await flushEvents(designA, PID_MAIN, [eA1, eA2])
    const fB = await flushEvents(designB, PID_MAIN, [eB1, eB2])
    if (fA.status === 200 && fA.body?.accepted === 2) pass('flush A', '2 ops accepted')
    else fail('flush A', `status ${fA.status} accepted=${fA.body?.accepted}`)
    if (fB.status === 200 && fB.body?.accepted === 2) pass('flush B', '2 ops accepted')
    else fail('flush B', `status ${fB.status} accepted=${fB.body?.accepted}`)

    try {
      await waitFor('A events on A stream', () =>
        obsA.countEvent(eA1.eventId) === 1 && obsA.countEvent(eA2.eventId) === 1 ? true : undefined,
      )
      await waitFor('B events on B stream', () =>
        obsB.countEvent(eB1.eventId) === 1 && obsB.countEvent(eB2.eventId) === 1 ? true : undefined,
      )
      pass('event delivery', 'A ops → A stream, B ops → B stream (≤15 s)')
    } catch (err) {
      fail('event delivery', (err as Error).message)
    }

    await sleep(2_500) // let a couple more frames (with presence) land
    if (obsA.countEvent(eB1.eventId) === 0 && obsB.countEvent(eA1.eventId) === 0)
      pass('design isolation', 'no cross-design event leakage')
    else fail('design isolation', 'events leaked across designs')

    // the participant must be visible in BOTH designs simultaneously —
    // the exact state the old single-column Presence PK forbade.
    // Frames only emit on event ticks (presence is queried every 2nd tick),
    // so keep the sessions realistically active until a presence-carrying
    // frame lands on each stream — mirroring a live editing session.
    let seenA = obsA.hasPresence(PID_MAIN)
    let seenB = obsB.hasPresence(PID_MAIN)
    for (let r = 1; r <= 6 && !(seenA && seenB); r++) {
      await flushEvents(designA, PID_MAIN, [envelope(rename(`smoke realtime A (tick ${r})`))])
      await flushEvents(designB, PID_MAIN, [envelope(rename(`smoke realtime B (tick ${r})`))])
      await sleep(1_400)
      seenA = seenA || obsA.hasPresence(PID_MAIN)
      seenB = seenB || obsB.hasPresence(PID_MAIN)
    }
    if (seenA && seenB) pass('presence in both designs', 'same pid live on A and B at once')
    else fail('presence in both designs', `A=${seenA} B=${seenB}`)

    // retried flush with identical eventIds — must insert NOTHING
    const dup = await flushEvents(designA, PID_MAIN, [eA1, eA2])
    await sleep(2_000)
    if (dup.status === 200 && (dup.body?.accepted ?? 1) === 0 && obsA.countEvent(eA1.eventId) === 1)
      pass('idempotent retry', 'replayed flush accepted 0, stream unchanged')
    else fail('idempotent retry', `accepted=${dup.body?.accepted} count=${obsA.countEvent(eA1.eventId)}`)

    // ═══ 4. reconnect: drop → gap-free replay ═══════════════
    console.log('\n── 4. reconnect behaviour (SSE drop + gap-free replay)')
    const since = obsA.lastSeq()
    obsA.abort()
    await sleep(700)
    note('connection dropped', `observer A disconnected at seq=${since}`)

    const eA3 = envelope(addRect('smoke-rect-A3'))
    const eA4 = envelope(rename('smoke realtime A (renamed again)'))
    const f3 = await flushEvents(designA, PID_MAIN, [eA3, eA4])
    const dup3 = await flushEvents(designA, PID_MAIN, [eA3]) // duplicate while disconnected
    if (f3.body?.accepted === 2 && dup3.body?.accepted === 0)
      pass('events while disconnected', '2 accepted, duplicate replay accepted 0')
    else fail('events while disconnected', `${f3.body?.accepted}/${dup3.body?.accepted}`)

    const obsA2 = new SSEReader(designA, PID_OBS)
    await obsA2.open(since)
    try {
      await waitFor('replayed events', () =>
        obsA2.countEvent(eA3.eventId) === 1 && obsA2.countEvent(eA4.eventId) === 1 ? true : undefined,
      )
      const gapFree = obsA2.frames.some((f) => f.events.some((e) => e.seq > since))
      if (gapFree) pass('gap-free replay', `reconnect ?since=${since} delivered exactly the missed ops`)
      else fail('gap-free replay', 'no events beyond `since` seen')
    } catch (err) {
      fail('gap-free replay', (err as Error).message)
    }
    if (obsA2.retryHint === '1500') pass('retry hint', 'stream advertises retry: 1500 (invisible reconnect)')
    else fail('retry hint', `retry=${obsA2.retryHint}`)

    // keepalives must flow while the design is quiet
    await sleep(4_000)
    const ka = [...obsB.comments, ...obsA2.comments].filter((c) => c === 'keepalive').length
    if (ka > 0) pass('keepalives', `${ka} keepalive comments received while idle`)
    else fail('keepalives', 'none received in 4 s of idle')

    obsA2.abort()
    obsB.abort()
  }

  // ═══ 5. audio/video upload & playback semantics ═════════════
  console.log('\n── 5. audio/video upload & playback (media store)')
  let wavId: string | null = null
  let mp4Id: string | null = null
  {
    const wav = makeWav()
    // offset-guard replay probe needs a manual first chunk
    const init = await hfetch('POST /api/media (wav init)', '/api/media', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mime: 'audio/wav', size: wav.length }),
    })
    const initJ = (await init.json().catch(() => null)) as { id?: string; chunkSize?: number } | null
    if (init.status === 201 && initJ?.id) {
      const id = initJ.id
      probe.media.push(id)
      const CHUNK = initJ.chunkSize ?? 3 * 1024 * 1024
      const c1 = wav.subarray(0, CHUNK)
      const r1 = await hfetch('PATCH /api/media chunk 1', `/api/media/${id}?offset=0`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/octet-stream' },
        body: c1,
      })
      const r1j = (await r1.json().catch(() => null)) as { size?: number } | null
      if (r1.status === 200 && r1j?.size === c1.length) pass('wav chunk 1', `${c1.length} bytes`)
      else fail('wav chunk 1', `status ${r1.status}`)

      const replay = await hfetch('PATCH /api/media replay', `/api/media/${id}?offset=0`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/octet-stream' },
        body: c1,
      })
      if (replay.status === 409) pass('offset guard', 'replayed chunk rejected 409')
      else fail('offset guard', `status ${replay.status}`)

      const c2 = wav.subarray(CHUNK)
      const r2 = await hfetch('PATCH /api/media chunk 2', `/api/media/${id}?offset=${CHUNK}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/octet-stream' },
        body: c2,
      })
      const r2j = (await r2.json().catch(() => null)) as { size?: number } | null
      if (r2.status === 200 && r2j?.size === wav.length) pass('wav chunk 2', `total ${r2j?.size} bytes (two chunks)`)
      else fail('wav chunk 2', `status ${r2.status} size=${r2j?.size}`)

      const badFin = await hfetch('PUT /api/media (wrong size)', `/api/media/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedSize: wav.length + 7 }),
      })
      if (badFin.status === 409) pass('finalize guard', 'wrong expectedSize → 409')
      else fail('finalize guard', `status ${badFin.status}`)

      wavId = (await uploadFinalize(id, wav.length)) ? id : null
    } else {
      fail('wav init', `status ${init.status}`)
    }

    // full GET — byte-exact round-trip + playback headers
    if (wavId) {
      const got = await hfetch('GET /api/media (wav)', `/api/media/${wavId}`)
      const buf = new Uint8Array(await got.arrayBuffer())
      let equal = buf.length === wav.length
      for (let i = 0; equal && i < wav.length; i++) if (buf[i] !== wav[i]) equal = false
      const ct = got.headers.get('content-type') ?? ''
      const cc = got.headers.get('cache-control') ?? ''
      const ar = got.headers.get('accept-ranges')
      if (equal) pass('wav round-trip', `${buf.length} bytes exact`)
      else fail('wav round-trip', `${buf.length} bytes (want ${wav.length})`)
      if (ct === 'audio/wav' && ar === 'bytes' && cc.includes('immutable'))
        pass('wav playback headers', 'content-type + accept-ranges + immutable cache')
      else fail('wav playback headers', `ct=${ct} ar=${ar} cc=${cc}`)

      const range = await hfetch('GET /api/media (wav range)', `/api/media/${wavId}`, {
        headers: { range: 'bytes=100-199' },
      })
      const rb = new Uint8Array(await range.arrayBuffer())
      const sliceOk = rb.length === 100 && rb.every((b, i) => b === wav[100 + i])
      if (range.status === 206 && sliceOk && (range.headers.get('content-range') ?? '').endsWith(`/${wav.length}`))
        pass('wav Range 206', 'seek slice exact + content-range')
      else fail('wav Range 206', `status ${range.status} len=${rb.length}`)
      const tail = await hfetch('GET /api/media (wav 416)', `/api/media/${wavId}`, {
        headers: { range: `bytes=${wav.length + 5}-` },
      })
      if (tail.status === 416) pass('wav Range 416', 'out-of-range rejected')
      else fail('wav Range 416', `status ${tail.status}`)
    }

    // real MP4 (H.264+AAC) — what a video element uploads
    const mp4 = makeMp4()
    if (!mp4) {
      note('mp4 probe', 'ffmpeg unavailable — video upload checks skipped')
    } else {
      mp4Id = await uploadMedia('video/mp4', mp4)
      if (mp4Id) {
        pass('mp4 upload', `${mp4.length} bytes, single chunk, finalized`)
        const got = await hfetch('GET /api/media (mp4)', `/api/media/${mp4Id}`)
        const buf = new Uint8Array(await got.arrayBuffer())
        let equal = buf.length === mp4.length
        for (let i = 0; equal && i < mp4.length; i++) if (buf[i] !== mp4[i]) equal = false
        const ct = got.headers.get('content-type') ?? ''
        if (equal && ct === 'video/mp4') pass('mp4 round-trip', 'byte-exact + content-type')
        else fail('mp4 round-trip', `equal=${equal} ct=${ct}`)
        // mid-file range — exactly what a seeking <video> issues
        const range = await hfetch('GET /api/media (mp4 range)', `/api/media/${mp4Id}`, {
          headers: { range: `bytes=200-${Math.min(1199, mp4.length - 1)}` },
        })
        const rb = new Uint8Array(await range.arrayBuffer())
        if (range.status === 206 && rb.every((b, i) => b === mp4[200 + i]))
          pass('mp4 Range 206', 'seek slice exact')
        else fail('mp4 Range 206', `status ${range.status}`)
      } else {
        fail('mp4 upload', 'upload failed')
      }
    }

    // document round-trip: audio + video elements survive save/load intact
    if (wavId && mp4Id) {
      let res = await hfetch('POST /api/designs (media doc)', '/api/designs', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: owner.header! },
        body: JSON.stringify({
          name: 'smoke media doc',
          width: 800,
          height: 600,
          pages: [
            {
              id: 'p1',
              background: { kind: 'solid', color: '#ffffff' },
              elements: [
                {
                  id: 'AUD1',
                  type: 'audio',
                  x: 40, y: 40, width: 420, height: 96,
                  rotation: 0, opacity: 1, locked: false, visible: true,
                  shadow: { enabled: false, color: '#000000', blur: 12, offsetX: 0, offsetY: 6 },
                  src: `/api/media/${wavId}`,
                  name: 'probe-clicks.wav',
                  duration: 49.9,
                  volume: 0.9,
                  loop: false,
                  autoplay: true,
                  peaks: [0.1, 0.9, 0.2, 0.7],
                  bpm: 120,
                  beats: [0.1, 0.6, 1.1, 1.6],
                },
                {
                  id: 'VID1',
                  type: 'video',
                  x: 40, y: 160, width: 320, height: 240,
                  rotation: 0, opacity: 1, locked: false, visible: true,
                  shadow: { enabled: false, color: '#000000', blur: 12, offsetX: 0, offsetY: 6 },
                  src: `/api/media/${mp4Id}`,
                  poster: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
                  duration: 2,
                  volume: 0.8,
                  muted: false,
                  loop: true,
                  autoplay: true,
                  trimStart: 0.2,
                  trimEnd: 1.8,
                },
              ],
            },
          ],
        }),
      })
      const created = (await res.json().catch(() => null)) as { id?: string } | null
      if (res.status === 201 && created?.id) {
        probe.designs.push(created.id)
        const got = await hfetch('GET /api/designs/[id] (media doc)', `/api/designs/${created.id}`)
        const doc = (await got.json().catch(() => null)) as {
          pages?: { elements?: Record<string, unknown>[] }[]
        } | null
        const aud = doc?.pages?.[0]?.elements?.find((e) => e.id === 'AUD1')
        const vid = doc?.pages?.[0]?.elements?.find((e) => e.id === 'VID1')
        const audOk =
          aud && aud.src === `/api/media/${wavId}` && aud.bpm === 120 && Array.isArray(aud.peaks) && Array.isArray(aud.beats)
        const vidOk = vid && vid.src === `/api/media/${mp4Id}` && vid.trimStart === 0.2 && vid.trimEnd === 1.8 && typeof vid.poster === 'string'
        if (audOk && vidOk) pass('A/V document round-trip', 'audio (peaks/bpm/beats) + video (poster/trim) intact')
        else fail('A/V document round-trip', `aud=${JSON.stringify(aud).slice(0, 80)} vid=${JSON.stringify(vid).slice(0, 80)}`)
      } else {
        fail('A/V document round-trip', `create status ${res.status}`)
      }
    }

    // rejection guards still hold
    const badMime = await hfetch('POST /api/media (bad mime)', '/api/media', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mime: 'image/png', size: 1000 }),
    })
    if (badMime.status === 415) pass('mime rejection', 'image/png → 415')
    else fail('mime rejection', `status ${badMime.status}`)
    const csrf = await hfetch('POST /api/media (cross-origin)', '/api/media', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: EVIL },
      body: JSON.stringify({ mime: 'audio/wav', size: 10 }),
    })
    if (csrf.status === 403) pass('media CSRF', 'cross-site init rejected')
    else fail('media CSRF', `status ${csrf.status}`)
  }

  // ═══ 6. latency summary (the 30 s-hang guard) ═══════════════
  console.log('\n── 6. request latency (30 s-hang regression guard)')
  {
    const sorted = [...reqStats].sort((a, b) => b.ms - a.ms)
    const max = sorted[0]
    const slow = sorted.slice(0, 5)
    note('requests', `${reqStats.length} tracked, median ${sorted[Math.floor(sorted.length / 2)].ms} ms`)
    for (const s of slow) note('slowest', `${s.ms} ms — ${s.label} (${s.status})`)
    if (max && max.ms < 10_000) pass('latency ceiling', `max ${max.ms} ms — nowhere near the 30 s function limit`)
    else if (max) fail('latency ceiling', `max ${max.ms} ms on ${s_clean(max.label)} — investigate`)
  }

  // ═══ 7. database state ══════════════════════════════════════
  console.log('\n── 7. database state (composite Presence PK)')
  {
    const db = createScriptClient(readEnvDatabaseUrl())
    try {
      const n = await db.presence.count({ where: { id: PID_MAIN } })
      if (n === 2) pass('presence rows', 'same pid present in BOTH designs (old schema: impossible)')
      else fail('presence rows', `count=${n} (expected 2)`)
    } finally {
      await db.$disconnect()
    }
  }
}

function s_clean(label: string) {
  return label.replace(/\s+/g, ' ').trim()
}

async function uploadFinalize(id: string, expectedSize: number): Promise<boolean> {
  const fin = await hfetch('PUT /api/media (finalize)', `/api/media/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedSize }),
  })
  if (fin.status === 200) {
    pass('wav finalize', 'upload marked complete')
    return true
  }
  fail('wav finalize', `status ${fin.status}`)
  return false
}

/** the standalone server does not read .env — mirror the URL from it for the cleanup client */
function readEnvDatabaseUrl(): string {
  try {
    const env = readFileSync(join(process.cwd(), '.env'), 'utf8')
    const line = env.split('\n').find((l) => l.startsWith('DATABASE_URL='))
    if (line) return line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '')
  } catch {
    /* fallthrough */
  }
  const url = process.env.DATABASE_URL
  if (!url || url.startsWith('file:')) throw new Error('no postgres DATABASE_URL found (.env or env)')
  return url
}

async function cleanup() {
  console.log('\n── cleanup')
  try {
    const db = createScriptClient(readEnvDatabaseUrl())
    const p = await db.presence.deleteMany({ where: { id: { in: probe.pids } } })
    const m = await db.media.deleteMany({ where: { id: { in: probe.media } } })
    const d = await db.design.deleteMany({ where: { id: { in: probe.designs } } })
    const u = await db.user.deleteMany({ where: { username: { in: probe.users } } })
    await db.$disconnect()
    note('probe rows removed', `${d.count} designs (events cascade), ${p.count} presence, ${m.count} media, ${u.count} users (+sessions)`)
  } catch (err) {
    fail('cleanup', (err as Error).message)
  }
}

main()
  .catch((err) => {
    fail('probe crashed', err instanceof Error ? err.message : String(err))
  })
  .then(() => cleanup())
  .then(() => {
    console.log(`\n${failures === 0 ? 'ALL GREEN' : 'FAILURES PRESENT'} — ${checks - failures}/${checks} checks passed`)
    process.exit(failures === 0 ? 0 : 1)
  })

