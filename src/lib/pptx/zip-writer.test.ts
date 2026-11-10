import { describe, expect, it } from 'vitest'
import { crc32, ZipWriter } from './zip-writer'

// ── an INDEPENDENT zip reader (the pdf-writer.test pattern:
// never parse with the writer's own code) ─────────────────────

interface ZipReadEntry {
  name: string
  data: Uint8Array
  method: number
}

async function readZip(bytes: Uint8Array): Promise<ZipReadEntry[]> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // find EOCD (scan back — no comment in our writer)
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('no EOCD')
  const count = dv.getUint16(eocd + 10, true)
  const cdSize = dv.getUint32(eocd + 12, true)
  const cdOff = dv.getUint32(eocd + 16, true)

  // parse central directory → {name, method, crc, csize, usize, localOff}
  const meta: { name: string; method: number; crc: number; csize: number; usize: number; localOff: number }[] = []
  let p = cdOff
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('bad central sig')
    const method = dv.getUint16(p + 10, true)
    const crc = dv.getUint32(p + 16, true)
    const csize = dv.getUint32(p + 20, true)
    const usize = dv.getUint32(p + 24, true)
    const nameLen = dv.getUint16(p + 28, true)
    const extraLen = dv.getUint16(p + 30, true)
    const commentLen = dv.getUint16(p + 32, true)
    const localOff = dv.getUint32(p + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen))
    meta.push({ name, method, crc, csize, usize, localOff })
    p += 46 + nameLen + extraLen + commentLen
  }
  if (p !== cdOff + cdSize) throw new Error('central size mismatch')

  // extract each entry from its local header
  const out: ZipReadEntry[] = []
  for (const m of meta) {
    if (dv.getUint32(m.localOff, true) !== 0x04034b50) throw new Error('bad local sig')
    const nameLen = dv.getUint16(m.localOff + 26, true)
    const extraLen = dv.getUint16(m.localOff + 28, true)
    const dataStart = m.localOff + 30 + nameLen + extraLen
    const raw = bytes.subarray(dataStart, dataStart + m.csize)
    let data: Uint8Array
    if (m.method === 0) {
      data = raw
    } else {
      const DS = (globalThis as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream
      if (typeof DS !== 'function') throw new Error('no DecompressionStream')
      const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DS('deflate-raw'))
      data = new Uint8Array(await new Response(stream).arrayBuffer())
    }
    out.push({ name: m.name, data, method: m.method })
  }
  return out
}

describe('crc32', () => {
  it('matches the known vectors', () => {
    expect(crc32(new TextEncoder().encode(''))).toBe(0x00000000)
    expect(crc32(new TextEncoder().encode('a'))).toBe(0xe8b7be43)
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
    expect(crc32(new TextEncoder().encode('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339)
  })
})

describe('ZipWriter', () => {
  it('round-trips stored entries byte-identically', async () => {
    const z = new ZipWriter()
    await z.addBytes('a.txt', new TextEncoder().encode('hello world'), { store: true })
    await z.addBytes('b.bin', new Uint8Array([0, 1, 2, 253, 254, 255]), { store: true })
    const bytes = await z.finalize()
    const entries = await readZip(bytes)
    expect(entries.map((e) => e.name)).toEqual(['a.txt', 'b.bin'])
    expect(new TextDecoder().decode(entries[0].data)).toBe('hello world')
    expect([...entries[1].data]).toEqual([0, 1, 2, 253, 254, 255])
  })

  it('deflates when smaller and the round-trip restores the bytes', async () => {
    const payload = ('lorem ipsum dolor sit amet '.repeat(40) + 'ééralé').repeat(4)
    const z = new ZipWriter()
    await z.addText('big.xml', payload)
    const bytes = await z.finalize()
    const entries = await readZip(bytes)
    const DS = (globalThis as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream
    if (typeof DS === 'function') {
      // the platform can deflate → the entry should be deflated
      expect(entries[0].method).toBe(8)
    }
    expect(new TextDecoder().decode(entries[0].data)).toBe(payload)
  })

  it('keeps tiny entries stored and produces a valid empty-ish archive', async () => {
    const z = new ZipWriter()
    await z.addText('x', 'ab') // below the deflate threshold → stored
    await z.addText('dir/nested/name.xml', '<a/>')
    const bytes = await z.finalize()
    const entries = await readZip(bytes)
    expect(entries.length).toBe(2)
    expect(entries[1].name).toBe('dir/nested/name.xml')
    expect(new TextDecoder().decode(entries[1].data)).toBe('<a/>')
  })

  it('reports membership', async () => {
    const z = new ZipWriter()
    await z.addText('present.xml', 'x')
    expect(z.has('present.xml')).toBe(true)
    expect(z.has('missing.xml')).toBe(false)
    expect(z.size).toBe(1)
  })
})
