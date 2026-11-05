// ─────────────────────────────────────────────────────────────
// webm-muxer tests (v0.15 R2)
//
// The muxer is verified with an INDEPENDENT mini EBML parser
// (written from the spec, not shared with the muxer code) so the
// tests can disagree with the writer about how to read a file —
// that's the whole point. On top of the parser:
//
//   A. vint grammar — the reserved all-ones trap, marker bits,
//      boundary values (127/16 383/…), oversized rejection
//   B. header truth — DocType webm, MaxSizeLength 8
//   C. Info — TimecodeScale 1 ms, Duration float patched, apps
//   D. Tracks — one video track, codec id, dimensions, no lacing
//   E. clusters — keyframe flags, relative timecodes, split
//      policy (5 s cap, keyframe splits, int16 guard,
//      out-of-order re-base), first-block-is-keyframe contract
//   F. Cues — one point per cluster, positions point at real
//      cluster element starts
//   G. segment size patch — exactly file length − data start
//   H. honesty — one-shot finalize, empty-payload refusal
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest'
import { WebMMuxer, type MuxedVideoFrame, vintBytes, vintLength } from './webm-muxer'

// ── the independent parser ────────────────────────────────────

interface Node {
  id: number
  /** body byte range in the file */
  start: number
  end: number
  children: Node[]
}

function readVint(file: Uint8Array, at: number): { value: number; len: number } {
  const first = file[at]
  let markerBits = 0
  for (let i = 7; i >= 0; i--) {
    if ((first >> i) & 1) {
      markerBits = 8 - i
      break
    }
  }
  if (markerBits === 0) throw new Error(`parser: vint marker missing at ${at}`)
  let value = first & (0xff >> markerBits)
  for (let i = 1; i < markerBits; i++) {
    value = value * 256 + file[at + i]
  }
  if (value === 2 ** (7 * markerBits) - 1) {
    // all-ones payload = "unknown size" — the muxer must never emit it
    throw new Error(`parser: unknown-size vint at ${at}`)
  }
  return { value, len: markerBits }
}

function readId(file: Uint8Array, at: number): { id: number; len: number } {
  const first = file[at]
  if (first === 0) throw new Error(`parser: id leading zero at ${at}`)
  let len = 1
  for (let i = 7; i >= 0; i--) {
    if ((first >> i) & 1) {
      len = 8 - i
      break
    }
  }
  let id = 0
  for (let i = 0; i < len; i++) id = id * 256 + file[at + i]
  return { id, len }
}

function parseInto(file: Uint8Array, start: number, end: number, out: Node[]): void {
  let at = start
  while (at < end) {
    const { id, len: idLen } = readId(file, at)
    const { value: size, len: sizeLen } = readVint(file, at + idLen)
    const bodyStart = at + idLen + sizeLen
    const bodyEnd = bodyStart + size
    if (bodyEnd > end) throw new Error(`parser: element 0x${id.toString(16)} overruns parent (at ${at}, size ${size})`)
    out.push({ id, start: bodyStart, end: bodyEnd, children: [] })
    at = bodyEnd
  }
  if (at !== end) throw new Error('parser: trailing bytes in parent')
}

function parse(file: Uint8Array): Node[] {
  const out: Node[] = []
  parseInto(file, 0, file.length, out)
  return out
}

function childrenOf(file: Uint8Array, node: Node): Node[] {
  parseInto(file, node.start, node.end, node.children)
  return node.children
}

function find(nodes: Node[], id: number): Node | undefined {
  return nodes.find((n) => n.id === id)
}

function uintValue(file: Uint8Array, node: Node): number {
  let v = 0
  for (let i = node.start; i < node.end; i++) v = v * 256 + file[i]
  return v
}

function floatValue(file: Uint8Array, node: Node): number {
  const b = new Uint8Array(node.end - node.start)
  b.set(file.subarray(node.start, node.end))
  const be = new Uint8Array(8)
  for (let i = 0; i < 8; i++) be[i] = b[7 - i]
  return new Float64Array(be.buffer)[0]
}

function stringValue(file: Uint8Array, node: Node): string {
  return new TextDecoder().decode(file.subarray(node.start, node.end))
}

/** walk to a nested child by path of ids */
function dig(file: Uint8Array, node: Node, ...ids: number[]): Node {
  let cur = node
  for (const id of ids) {
    const next = find(childrenOf(file, cur), id)
    if (!next) throw new Error(`parser: child 0x${id.toString(16)} not found`)
    cur = next
  }
  return cur
}

// ── helpers ───────────────────────────────────────────────────

const FPS = 30
const DUR_MS = 10_000

function frameAt(i: number, keyframe: boolean, size = 64): MuxedVideoFrame {
  const data = new Uint8Array(size)
  data.fill(i & 0xff)
  return { data, keyframe, timestampUs: Math.round((i * 1e6) / FPS), durationUs: Math.round(1e6 / FPS) }
}

function muxFrames(frames: MuxedVideoFrame[], durationMs = DUR_MS): Uint8Array {
  const muxer = new WebMMuxer({ width: 960, height: 640, codec: 'V_VP9', durationMs })
  for (const f of frames) muxer.addFrame(f)
  return muxer.finalize()
}

function simpleBlocks(file: Uint8Array, cluster: Node): Node[] {
  return childrenOf(file, cluster).filter((n) => n.id === 0xa3)
}

/** decode a SimpleBlock body */
function blockInfo(file: Uint8Array, block: Node): { track: number; relTc: number; keyframe: boolean; dataStart: number } {
  const b = file
  const track = b[block.start] & 0x7f
  const relTc = (b[block.start + 1] << 8) | b[block.start + 2]
  const signed = relTc >= 0x8000 ? relTc - 0x10000 : relTc
  return { track, relTc: signed, keyframe: (b[block.start + 3] & 0x80) !== 0, dataStart: block.start + 4 }
}

// ── A. vint grammar ───────────────────────────────────────────

describe('webm-muxer: EBML vint grammar', () => {
  it('encodes single-byte values below the reserved boundary', () => {
    expect(vintBytes(0)).toEqual(new Uint8Array([0x80]))
    expect(vintBytes(1)).toEqual(new Uint8Array([0x81]))
    expect(vintBytes(126)).toEqual(new Uint8Array([0xfe]))
  })

  it('reserves all-ones — 127 jumps to two bytes', () => {
    expect(vintLength(127)).toBe(2)
    expect(vintBytes(127)).toEqual(new Uint8Array([0x40, 0x7f]))
    expect(vintLength(16_382)).toBe(2)
    expect(vintLength(16_383)).toBe(3)
    expect(vintLength(2 ** 21 - 2)).toBe(3)
    expect(vintLength(2 ** 21 - 1)).toBe(4)
  })

  it('round-trips through the independent parser at every boundary', () => {
    const values = [0, 1, 126, 127, 128, 16_382, 16_383, 2 ** 21 - 2, 2 ** 21 - 1, 2 ** 28 - 2, 999_999]
    for (const v of values) {
      const b = vintBytes(v)
      const back = readVint(b, 0)
      expect(back.value, `v=${v}`).toBe(v)
      expect(back.len, `v=${v}`).toBe(b.length)
    }
  })

  it('rejects negative, fractional and absurd values', () => {
    expect(() => vintLength(-1)).toThrow()
    expect(() => vintLength(1.5)).toThrow()
    expect(() => vintLength(2 ** 56)).toThrow()
  })
})

// ── B–D. header / info / tracks ───────────────────────────────

describe('webm-muxer: file skeleton', () => {
  const file = muxFrames([frameAt(0, true), frameAt(1, false), frameAt(2, false)])
  const top = parse(file)
  const ebml = find(top, 0x1a45dfa3)!
  const segment = find(top, 0x18538067)!

  it('writes exactly two top-level elements: EBML header + Segment', () => {
    expect(top.map((n) => n.id)).toEqual([0x1a45dfa3, 0x18538067])
  })

  it('declares the webm doctype with the size headroom it needs', () => {
    const kids = childrenOf(file, ebml)
    expect(stringValue(file, find(kids, 0x4282)!)).toBe('webm')
    expect(uintValue(file, find(kids, 0x4287)!)).toBe(2)
    expect(uintValue(file, find(kids, 0x42f3)!)).toBe(8) // MaxSizeLength — we patch 8-byte sizes
  })

  it('patches the segment size to exactly cover the file', () => {
    // the segment element starts after the EBML header element —
    // its body start (from the parser) is exactly 12 bytes after
    // its element start (4-byte id + 8-byte size placeholder).
    const segElementStart = segment.start - 12
    const { value, len } = readVint(file, segElementStart + 4)
    expect(len).toBe(8)
    expect(value).toBe(file.length - segment.start)
  })

  it('Info: 1 ms timecode scale, patched float duration, honest apps', () => {
    const info = find(childrenOf(file, segment), 0x1549a966)!
    const kids = childrenOf(file, info)
    expect(uintValue(file, find(kids, 0x2ad7b1)!)).toBe(1_000_000)
    expect(stringValue(file, find(kids, 0x4d80)!)).toBe('Canvix')
    expect(stringValue(file, find(kids, 0x5741)!)).toContain('Canvix')
    expect(floatValue(file, find(kids, 0x4489)!)).toBeCloseTo(DUR_MS, 6)
  })

  it('Tracks: one V_VP9 video track at the declared size, lacing off', () => {
    const trackEntry = dig(file, segment, 0x1654ae6b, 0xae)
    const kids = childrenOf(file, trackEntry)
    expect(uintValue(file, find(kids, 0xd7)!)).toBe(1) // TrackNumber
    expect(uintValue(file, find(kids, 0x83)!)).toBe(1) // TrackType video
    expect(uintValue(file, find(kids, 0x9c)!)).toBe(0) // FlagLacing
    expect(stringValue(file, find(kids, 0x86)!)).toBe('V_VP9')
    const video = find(kids, 0xe0)!
    const vk = childrenOf(file, video)
    expect(uintValue(file, find(vk, 0xb0)!)).toBe(960)
    expect(uintValue(file, find(vk, 0xba)!)).toBe(640)
  })
})

// ── E. clusters + blocks ──────────────────────────────────────

describe('webm-muxer: clusters and SimpleBlocks', () => {
  it('keeps frame data intact and flags keyframes', () => {
    const frames = [frameAt(0, true, 100), frameAt(1, false, 100), frameAt(2, false, 100)]
    const file = muxFrames(frames)
    const segment = find(parse(file), 0x18538067)!
    const clusters = childrenOf(file, segment).filter((n) => n.id === 0x1f43b675)
    const blocks = simpleBlocks(file, clusters[0])
    expect(blocks.length).toBe(3)
    const b0 = blockInfo(file, blocks[0])
    expect(b0.track).toBe(1)
    expect(b0.keyframe).toBe(true)
    expect(b0.relTc).toBe(0)
    expect(blockInfo(file, blocks[1]).keyframe).toBe(false)
    expect(blockInfo(file, blocks[1]).relTc).toBe(33)
    // data survived byte-for-byte
    const f0 = frames[0].data
    expect(Array.from(file.subarray(b0.dataStart, b0.dataStart + 8))).toEqual(Array.from(f0.subarray(0, 8)))
  })

  it('splits a new cluster per keyframe once the cluster is ≥ 1 s old', () => {
    // 5 s at 30 fps with a keyframe every 2 s → bases at 0, 2000, 4000
    const frames: MuxedVideoFrame[] = []
    for (let i = 0; i < 5 * FPS; i++) frames.push(frameAt(i, i % (2 * FPS) === 0))
    const file = muxFrames(frames)
    const segment = find(parse(file), 0x18538067)!
    const clusters = childrenOf(file, segment).filter((n) => n.id === 0x1f43b675)
    const bases = clusters.map((c) => uintValue(file, find(childrenOf(file, c), 0xe7)!))
    expect(bases).toEqual([0, 2_000, 4_000])
    // every cluster opens with a keyframe block
    for (const c of clusters) {
      expect(blockInfo(file, simpleBlocks(file, c)[0]).keyframe).toBe(true)
    }
  })

  it('caps cluster age at 5 s even without keyframes', () => {
    // 12 s of deltas only — the cap must still split
    const frames: MuxedVideoFrame[] = []
    for (let i = 0; i < 12 * FPS; i++) frames.push(frameAt(i, i === 0))
    const file = muxFrames(frames)
    const segment = find(parse(file), 0x18538067)!
    const clusters = childrenOf(file, segment).filter((n) => n.id === 0x1f43b675)
    expect(clusters.length).toBeGreaterThanOrEqual(3)
    for (const c of clusters) {
      const base = uintValue(file, find(childrenOf(file, c), 0xe7)!)
      expect(base % 5_000).toBe(0)
      // int16 safety: last block's relative timecode in range
      const blocks = simpleBlocks(file, c)
      expect(blockInfo(file, blocks[blocks.length - 1]).relTc).toBeLessThanOrEqual(32_767)
    }
  })

  it('re-bases when a stamp arrives out of order (guard, not corruption)', () => {
    // push the base to 2000 ms (keyframe split at ≥ 1 s), then a
    // rogue stamp at 1000 ms — BEFORE the open cluster's base
    const frames = [
      frameAt(0, true), // t = 0 ms  → cluster 1 opens (base 0)
      frameAt(60, true), // t = 2000 ms → keyframe split (base 2000)
      { data: new Uint8Array(16).fill(0xab), keyframe: true, timestampUs: 1_000_000, durationUs: 33_333 }, // t = 1000 ms
    ]
    const file = muxFrames(frames)
    const segment = find(parse(file), 0x18538067)!
    const clusters = childrenOf(file, segment).filter((n) => n.id === 0x1f43b675)
    const allBlocks = clusters.flatMap((c) => simpleBlocks(file, c).map((b) => blockInfo(file, b)))
    for (const b of allBlocks) expect(b.relTc).toBeGreaterThanOrEqual(0)
    // bases: 0, 2000, then the rogue re-based to 1000
    const bases = clusters.map((c) => uintValue(file, find(childrenOf(file, c), 0xe7)!))
    expect(bases).toEqual([0, 2_000, 1_000])
  })

  it('the duration floor rises to the observed last-frame end', () => {
    // declared 10 s but frames claim 12 s → Duration must not lie short
    const frames: MuxedVideoFrame[] = []
    for (let i = 0; i < 12 * FPS; i++) frames.push(frameAt(i, i === 0))
    const file = muxFrames(frames, 10_000)
    const segment = find(parse(file), 0x18538067)!
    const info = find(childrenOf(file, segment), 0x1549a966)!
    const dur = floatValue(file, find(childrenOf(file, info), 0x4489)!)
    expect(dur).toBeGreaterThanOrEqual(12_000 - 1)
  })
})

// ── F. Cues ───────────────────────────────────────────────────

describe('webm-muxer: Cues', () => {
  it('emits one CuePoint per cluster whose position hits the cluster element exactly', () => {
    const frames: MuxedVideoFrame[] = []
    for (let i = 0; i < 5 * FPS; i++) frames.push(frameAt(i, i % (2 * FPS) === 0))
    const file = muxFrames(frames)
    const top = parse(file)
    const segment = find(top, 0x18538067)!
    // parse the segment DATA (the parser's node.start is exactly
    // where CueClusterPosition counts from)
    const segKids: Node[] = []
    parseInto(file, segment.start, file.length, segKids)
    const clusters = segKids.filter((n) => n.id === 0x1f43b675)
    const cues = segKids.find((n) => n.id === 0x1c53bb6b)!
    const points = childrenOf(file, cues)

    expect(points.length).toBe(clusters.length)
    points.forEach((point, i) => {
      const kids = childrenOf(file, point)
      const ctp = find(kids, 0xb7)!
      const pos = uintValue(file, find(childrenOf(file, ctp), 0xf1)!)
      // CueClusterPosition is relative to the segment DATA start —
      // the cluster element must REALLY start at that byte.
      const absolute = segment.start + pos
      const rid = readId(file, absolute)
      expect(rid.id, `cue ${i} → byte ${absolute}`).toBe(0x1f43b675)
      const cueTime = uintValue(file, find(kids, 0xb3)!)
      const base = uintValue(file, find(childrenOf(file, clusters[i]), 0xe7)!)
      expect(cueTime).toBe(base)
    })
  })
})

// ── G/H. honesty guards ───────────────────────────────────────

describe('webm-muxer: honesty guards', () => {
  it('finalize is one-shot — a half-patched file must never ship twice', () => {
    const muxer = new WebMMuxer({ width: 64, height: 64, codec: 'V_VP8', durationMs: 1_000 })
    muxer.addFrame(frameAt(0, true))
    muxer.finalize()
    expect(() => muxer.finalize()).toThrow(/already finalized/)
    expect(() => muxer.addFrame(frameAt(1, false))).toThrow(/finalized/)
  })

  it('refuses empty payloads (encoder bug, not a valid frame)', () => {
    const muxer = new WebMMuxer({ width: 64, height: 64, codec: 'V_VP9', durationMs: 1_000 })
    expect(() => muxer.addFrame({ data: new Uint8Array(0), keyframe: true, timestampUs: 0, durationUs: 33_333 })).toThrow(
      /empty/,
    )
  })

  it('rejects absurd dimensions and durations at construction', () => {
    expect(() => new WebMMuxer({ width: 1, height: 64, codec: 'V_VP9', durationMs: 100 })).toThrow(/dimensions/)
    expect(() => new WebMMuxer({ width: 64, height: 64, codec: 'V_VP9', durationMs: -1 })).toThrow(/duration/)
  })

  it('counts frames honestly', () => {
    const muxer = new WebMMuxer({ width: 64, height: 64, codec: 'V_VP9', durationMs: 1_000 })
    expect(muxer.frames).toBe(0)
    muxer.addFrame(frameAt(0, true))
    muxer.addFrame(frameAt(1, false))
    expect(muxer.frames).toBe(2)
  })

  it('a zero-frame file still has a complete skeleton (empty Cues)', () => {
    const muxer = new WebMMuxer({ width: 64, height: 64, codec: 'V_VP9', durationMs: 500 })
    const file = muxer.finalize()
    const segment = find(parse(file), 0x18538067)!
    const segKids: Node[] = []
    parseInto(file, segment.start, file.length, segKids)
    expect(segKids.map((n) => n.id)).toEqual([0x1549a966, 0x1654ae6b]) // Info + Tracks only
  })
})

// ── the ffprobe cross-check (local/CI machines with ffmpeg) ────

describe('webm-muxer: ffprobe agrees (when ffmpeg is installed)', () => {
  it('parses a muxed file as webm/vp9 with the declared duration', async () => {
    // ffprobe needs REAL vp9 payloads to be happy — synthetic
    // bytes fail the codec parse. Only run this when we can pull
    // a real keyframe from ffmpeg's own encoder.
    const { execFileSync } = await import('node:child_process')
    let haveFfmpeg = true
    try {
      execFileSync('ffprobe', ['-version'])
    } catch {
      haveFfmpeg = false
    }
    if (!haveFfmpeg) return

    // 3 s of tiny test video, raw vp9 in ivf → extract one packet set
    const tmp = await import('node:fs/promises')
    const os = await import('node:os')
    const path = await import('node:path')
    const dir = await tmp.mkdtemp(path.join(os.tmpdir(), 'canvix-webm-'))
    const ivf = path.join(dir, 'in.ivf')
    execFileSync(
      'ffmpeg',
      ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=duration=3:size=320x240:rate=10', '-c:v', 'libvpx-vp9', '-b:v', '0', ivf],
      { timeout: 30_000 },
    )
    // demux ivf into per-frame payloads: 32-byte file header then
    // per frame [4-byte LE size][8-byte LE pts][payload]
    // pts is in timebase units — ivf header carries rate/scale at
    // offsets 16/24, so usPerTick = 1e6 * scale / rate.
    const ivfBytes = await tmp.readFile(ivf)
    const rate = ivfBytes.readUInt32LE(16)
    const scale = ivfBytes.readUInt32LE(20)
    const usPerTick = (1e6 * scale) / rate
    const frames: MuxedVideoFrame[] = []
    let at = 32 // ivf file header
    let pts = 0
    while (at + 12 <= ivfBytes.length) {
      const sz = ivfBytes[at] | (ivfBytes[at + 1] << 8) | (ivfBytes[at + 2] << 16) | (ivfBytes[at + 3] << 24)
      pts = Number(ivfBytes.readBigUInt64LE(at + 4))
      const data = ivfBytes.subarray(at + 12, at + 12 + sz)
      frames.push({
        data: new Uint8Array(data),
        keyframe: frames.length === 0,
        timestampUs: Math.round(pts * usPerTick),
        durationUs: Math.round(usPerTick),
      })
      at += 12 + sz
    }
    expect(frames.length).toBe(30)
    expect(frames[1].timestampUs - frames[0].timestampUs).toBeGreaterThanOrEqual(99_999) // really 100 ms steps

    const muxer = new WebMMuxer({ width: 320, height: 240, codec: 'V_VP9', durationMs: 3_000 })
    for (const f of frames) muxer.addFrame(f)
    const out = path.join(dir, 'muxed.webm')
    await tmp.writeFile(out, muxer.finalize())

    const probe = JSON.parse(
      execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=format_name,duration', '-show_entries', 'stream=codec_name,width,height,nb_frames', '-of', 'json', out]).toString(),
    ) as {
      format: { format_name: string; duration: string }
      streams: { codec_name: string; width: number; height: number; nb_frames?: string }[]
    }
    expect(probe.format.format_name).toBe('matroska,webm')
    expect(probe.streams[0].codec_name).toBe('vp9')
    expect(probe.streams[0].width).toBe(320)
    expect(probe.streams[0].height).toBe(240)
    expect(Number(probe.format.duration)).toBeCloseTo(3.0, 1)
    await tmp.rm(dir, { recursive: true, force: true })
  }, 60_000)
})
