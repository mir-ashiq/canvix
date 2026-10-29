// scripts/verify-media.ts — v0.11 media store live regression probe.
// Point at a RUNNING server; exercises the full chunked-upload lifecycle
// against the real database:
//   init → append (multi-chunk) → offset-guard replay → finalize guards
//   → full GET (bytes + headers) → Range GET (206) → out-of-range (416)
//   → mime/size rejections → CSRF → design roundtrip with an audio element
// Usage: npx tsx scripts/verify-media.ts [BASE_URL]   (default localhost:3000)

export {} // module scope — keeps top-level names out of other scripts

const BASE = (process.argv[2] ?? process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')

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

const CHUNK = 3 * 1024 * 1024

/** minimal mono 16-bit PCM WAV (~4 MB → forces two upload chunks) */
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
  // 120 BPM click track (not needed by the store, but a realistic payload)
  const period = Math.floor(sampleRate * 0.5)
  for (let i = 0; i < samples; i++) {
    const t = i % period
    const v = t < 400 ? Math.round(Math.exp(-t / 80) * 22000 * (t % 4 < 2 ? 1 : -1)) : 0
    dv.setInt16(44 + i * 2, v, true)
  }
  return buf
}

async function main() {
  console.log(`verify-media → ${BASE}`)
  const wav = makeWav()

  // 1. init
  const init = await fetch(`${BASE}/api/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mime: 'audio/wav', size: wav.length }),
  })
  const initJson = (await init.json().catch(() => null)) as { id?: string; chunkSize?: number } | null
  if (init.status === 201 && initJson?.id) pass('init', `id=${initJson.id.slice(0, 10)}… chunkSize=${initJson.chunkSize}`)
  else return fail('init', `status ${init.status}`)
  const id = initJson!.id!

  try {
    // 2. chunk 1
    const c1 = new Uint8Array(wav.buffer, 0, CHUNK)
    const r1 = await fetch(`${BASE}/api/media/${id}?offset=0`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: c1,
    })
    const r1j = (await r1.json().catch(() => null)) as { size?: number } | null
    if (r1.status === 200 && r1j?.size === c1.length) pass('append chunk 1', `${c1.length} bytes stored`)
    else fail('append chunk 1', `status ${r1.status} size=${r1j?.size}`)

    // 3. replaying chunk 1 at the same offset must be rejected (409) —
    //    the offset guard is what makes retried chunks safe
    const rr = await fetch(`${BASE}/api/media/${id}?offset=0`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: c1,
    })
    if (rr.status === 409) pass('offset guard', 'replayed chunk rejected with 409')
    else fail('offset guard', `status ${rr.status} (duplicate chunk accepted!)`)

    // 4. chunk 2
    const c2 = new Uint8Array(wav.buffer, CHUNK, wav.length - CHUNK)
    const r2 = await fetch(`${BASE}/api/media/${id}?offset=${CHUNK}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: c2,
    })
    const r2j = (await r2.json().catch(() => null)) as { size?: number } | null
    if (r2.status === 200 && r2j?.size === wav.length) pass('append chunk 2', `total ${r2j?.size} bytes`)
    else fail('append chunk 2', `status ${r2.status} size=${r2j?.size}`)

    // 5. GET before finalize → 404
    const early = await fetch(`${BASE}/api/media/${id}`)
    if (early.status === 404) pass('pre-finalize GET', '404 until finalized')
    else fail('pre-finalize GET', `status ${early.status}`)

    // 6. finalize with the wrong size → 409
    const badFin = await fetch(`${BASE}/api/media/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedSize: wav.length + 10 }),
    })
    if (badFin.status === 409) pass('finalize guard', 'wrong expectedSize rejected with 409')
    else fail('finalize guard', `status ${badFin.status}`)

    // 7. finalize correctly
    const fin = await fetch(`${BASE}/api/media/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedSize: wav.length }),
    })
    if (fin.status === 200) pass('finalize', 'upload marked complete')
    else fail('finalize', `status ${fin.status}`)

    // 8. full GET — bytes must round-trip exactly
    const got = await fetch(`${BASE}/api/media/${id}`)
    if (got.status !== 200) {
      fail('full GET', `status ${got.status}`)
    } else {
      const buf = new Uint8Array(await got.arrayBuffer())
      const ct = got.headers.get('content-type') ?? ''
      const cl = Number(got.headers.get('content-length') ?? 0)
      const ar = got.headers.get('accept-ranges')
      const cc = got.headers.get('cache-control') ?? ''
      if (buf.length === wav.length) pass('full GET length', `${buf.length} bytes`)
      else fail('full GET length', `${buf.length} (want ${wav.length})`)
      let equal = buf.length === wav.length
      for (let i = 0; equal && i < wav.length; i += 997) if (buf[i] !== wav[i]) equal = false
      if (buf.length === wav.length) {
        for (let i = 0; i < wav.length; i++) if (buf[i] !== wav[i]) { equal = false; break }
      }
      if (equal) pass('full GET bytes', 'content identical (chunked append intact)')
      else fail('full GET bytes', 'content differs from the uploaded file')
      if (ct === 'audio/wav') pass('content-type', ct)
      else fail('content-type', ct)
      if (cl === wav.length) pass('content-length', String(cl))
      else fail('content-length', String(cl))
      if (ar === 'bytes' && cc.includes('immutable')) pass('headers', 'accept-ranges + immutable cache')
      else fail('headers', `accept-ranges=${ar} cache=${cc}`)
    }

    // 9. Range GET → 206 partial
    const range = await fetch(`${BASE}/api/media/${id}`, { headers: { range: 'bytes=100-199' } })
    const rbuf = new Uint8Array(await range.arrayBuffer().catch(() => new ArrayBuffer(0)))
    if (range.status === 206 && rbuf.length === 100) {
      const cr = range.headers.get('content-range') ?? ''
      const matches = rbuf.every((b, i) => b === wav[100 + i])
      if (matches && cr === `bytes 100-199/${wav.length}`) pass('range GET', '206 + correct slice + content-range')
      else fail('range GET', `slice match=${matches} content-range=${cr}`)
    } else fail('range GET', `status ${range.status} len=${rbuf.length}`)

    // 10. out-of-range → 416
    const oor = await fetch(`${BASE}/api/media/${id}`, { headers: { range: `bytes=${wav.length + 5}-` } })
    if (oor.status === 416) pass('range 416', 'out-of-range rejected')
    else fail('range 416', `status ${oor.status}`)

    // 11. design roundtrip — an audio element (peaks/beats/src) survives jsonb
    const created = await fetch(`${BASE}/api/designs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'media-probe',
        width: 800,
        height: 600,
        pages: [
          {
            id: 'p1',
            background: { kind: 'solid', color: '#ffffff' },
            elements: [
              {
                id: 'AU1',
                type: 'audio',
                x: 40, y: 40, width: 420, height: 96,
                rotation: 0, opacity: 1, locked: false, visible: true,
                shadow: { enabled: false, color: '#000000', blur: 12, offsetX: 0, offsetY: 6 },
                src: `/api/media/${id}`,
                name: 'probe-clicks',
                duration: 47.8,
                volume: 0.8,
                loop: false,
                autoplay: true,
                peaks: [0.1, 0.9, 0.2],
                bpm: 120,
                beats: [0.1, 0.6, 1.1],
              },
            ],
          },
        ],
      }),
    })
    if (created.status !== 201) {
      fail('design roundtrip', `create → ${created.status}`)
    } else {
      const d = (await created.json()) as { id: string }
      const got2 = await fetch(`${BASE}/api/designs/${d.id}`)
      const dj = (await got2.json()) as { pages?: Array<{ elements?: Array<Record<string, unknown>> }> }
      const el = dj.pages?.[0]?.elements?.find((e) => e.id === 'AU1')
      if (
        el &&
        el.type === 'audio' &&
        el.src === `/api/media/${id}` &&
        Array.isArray(el.peaks) && Array.isArray(el.beats) && el.bpm === 120
      ) {
        pass('design roundtrip', 'audio element (peaks/beats/bpm/src) survives save + load')
      } else {
        fail('design roundtrip', `element after load: ${JSON.stringify(el).slice(0, 120)}`)
      }
      const del = await fetch(`${BASE}/api/designs/${d.id}?permanent=1`, { method: 'DELETE' })
      if (del.status === 200) pass('probe design cleanup', 'deleted')
      else fail('probe design cleanup', `status ${del.status} (manual: ${d.id})`)
    }
  } finally {
    // media row cleanup via raw SQL is not possible over HTTP — the file
    // stays (bounded, GC'd only if unfinalized). Note it honestly.
    console.log('  (media bytes remain in the store — no delete API by design; unfinalized rows GC after 24 h)')
  }

  // 12. rejections
  const badMime = await fetch(`${BASE}/api/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mime: 'image/png', size: 1000 }),
  })
  if (badMime.status === 415) pass('mime rejection', 'image/png → 415')
  else fail('mime rejection', `status ${badMime.status}`)

  const badSize = await fetch(`${BASE}/api/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mime: 'audio/wav', size: 999 * 1024 * 1024 }),
  })
  if (badSize.status === 413) pass('size rejection', '999 MB → 413')
  else fail('size rejection', `status ${badSize.status}`)

  // 13. CSRF — cross-site mutation rejected
  const csrf = await fetch(`${BASE}/api/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: JSON.stringify({ mime: 'audio/wav', size: 10 }),
  })
  if (csrf.status === 403) pass('CSRF', 'cross-site init rejected')
  else fail('CSRF', `status ${csrf.status}`)

  console.log(`\n${failures === 0 ? 'ALL GREEN' : 'FAILURES PRESENT'} — ${checks - failures}/${checks} checks passed`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('probe crashed:', err)
  process.exit(1)
})
