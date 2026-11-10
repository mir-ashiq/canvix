// ─────────────────────────────────────────────────────────────
// zip-writer — a minimal OPC/ZIP writer for the PPTX export
// (Wave 5). The house rule is zero new runtime dependencies, so
// this hand-rolls exactly what an OOXML package needs:
//
//   • STORED and DEFLATED entries (raw-deflate through the
//     platform CompressionStream — the same primitive the PDF
//     image embedder uses; when absent, entries fall back to
//     STORED, which every zip consumer including PowerPoint
//     accepts)
//   • CRC-32 (table-driven, the classic reflected polynomial)
//   • local file headers + central directory + EOCD, all with
//     sizes and CRC known up front (we always hold the bytes in
//     memory, so no data descriptors are needed)
//
// Pure (no DOM) — unit tests re-parse the output with an
// independent reader (the pdf-writer.test / mini-EBML pattern).
// ─────────────────────────────────────────────────────────────

/** CRC-32 (IEEE 802.3, reflected 0xEDB88320) — one table, built once. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** DOS date/time (2-second granularity — the zip container's clock). */
function dosDateTime(d: Date): { time: number; date: number } {
  const time =
    ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f)
  const date =
    (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f)
  return { time, date }
}

interface ZipEntry {
  name: string
  data: Uint8Array
  crc: number
  method: 0 | 8
  compressed: Uint8Array
  time: number
  date: number
}

/** Raw-deflate through the platform CompressionStream, when present. */
async function deflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  const CS = (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream
  if (typeof CS !== 'function') return null
  try {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CS('deflate-raw'))
    const buf = await new Response(stream).arrayBuffer()
    return new Uint8Array(buf)
  } catch {
    return null
  }
}

export class ZipWriter {
  private entries: ZipEntry[] = []
  private encoder = new TextEncoder()

  /** Add a text part (XML) — convenience for the OOXML writers. */
  async addText(name: string, text: string): Promise<void> {
    await this.addBytes(name, this.encoder.encode(text))
  }

  /** Add a binary part. Deflates unless `store` is forced or the
   *  platform cannot deflate (STORED is always valid). */
  async addBytes(name: string, data: Uint8Array, opts: { store?: boolean } = {}): Promise<void> {
    const crc = crc32(data)
    const { time, date } = dosDateTime(new Date())
    let method: 0 | 8 = 0
    let compressed = data
    // tiny parts cost more as headers than they save — keep those stored
    if (!opts.store && data.length > 64) {
      const def = await deflateRaw(data)
      if (def && def.length < data.length) {
        method = 8
        compressed = def
      }
    }
    this.entries.push({ name, data, crc, method, compressed, time, date })
  }

  get size(): number {
    return this.entries.length
  }

  has(name: string): boolean {
    return this.entries.some((e) => e.name === name)
  }

  /** Serialize the package: local headers, central directory, EOCD. */
  async finalize(): Promise<Uint8Array> {
    const chunks: Uint8Array[] = []
    const central: Uint8Array[] = []
    let offset = 0
    const enc = this.encoder

    const u16 = (v: number) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff])
    const u32 = (v: number) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff])
    const cat = (parts: Uint8Array[]) => {
      let n = 0
      for (const p of parts) n += p.length
      const out = new Uint8Array(n)
      let o = 0
      for (const p of parts) {
        out.set(p, o)
        o += p.length
      }
      return out
    }

    for (const e of this.entries) {
      const nameBytes = enc.encode(e.name)
      // local file header: sig · ver · flags(0) · method · time · date ·
      // crc · csize · usize · namelen · extralen(0)
      const local = cat([
        u32(0x04034b50),
        u16(e.method === 8 ? 20 : 10),
        u16(0),
        u16(e.method),
        u16(e.time),
        u16(e.date),
        u32(e.crc),
        u32(e.compressed.length),
        u32(e.data.length),
        u16(nameBytes.length),
        u16(0),
        nameBytes,
      ])
      chunks.push(local, e.compressed)
      central.push(
        cat([
          u32(0x02014b50),
          u16(20), // version made by
          u16(e.method === 8 ? 20 : 10),
          u16(0),
          u16(e.method),
          u16(e.time),
          u16(e.date),
          u32(e.crc),
          u32(e.compressed.length),
          u32(e.data.length),
          u16(nameBytes.length),
          u16(0), // extra
          u16(0), // comment
          u16(0), // disk
          u16(0), // internal attrs
          u32(0), // external attrs
          u32(offset),
          nameBytes,
        ]),
      )
      offset += local.length + e.compressed.length
    }

    const centralBytes = cat(central)
    const eocd = cat([
      u32(0x06054b50),
      u16(0),
      u16(0),
      u16(this.entries.length),
      u16(this.entries.length),
      u32(centralBytes.length),
      u32(offset),
      u16(0),
    ])
    return cat([...chunks, centralBytes, eocd])
  }
}
