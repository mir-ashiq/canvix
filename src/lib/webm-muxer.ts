// ─────────────────────────────────────────────────────────────
// WebM muxer (v0.15 R2) — hand-rolled EBML writer, zero deps.
//
// WHY THIS EXISTS
//   WebCodecs gives you ENCODED CHUNKS, not a container. For MP4
//   the only honest zero-dep path is a multi-week moov/mdat
//   project (the documented R2 decision point: a muxing dependency
//   like mux.js stays OFF the table until MP4-everywhere is a real
//   requirement — MP4 exports keep riding MediaRecorder where the
//   browser can encode H.264). WebM, by contrast, is tractable by
//   hand: a flat EBML tree of clusters + SimpleBlocks.
//
// WHAT IT WRITES (webm DocType, single video track, VP9/VP8)
//   EBML header → Segment [size placeholder, patched at finalize]
//     Info   (TimecodeScale 1 ms · apps · Duration, patched)
//     Tracks (one V_VP9/V_VP8 track, PixelWidth/Height)
//     Cluster* (Timecode absolute-ms + SimpleBlocks)
//     Cues  (one CuePoint per cluster — real seeking)
//
// HOW IT HANDLES THE EBML ORDERING TRAP
//   An element is ID → size → body, so a size must be known
//   before the body exists. Small static trees (header, Info,
//   Tracks, Cues) are therefore composed BOTTOM-UP into byte
//   arrays (el()), while streamed elements (Segment, Cluster) are
//   appended directly and get an 8-byte placeholder that
//   finalize()/closeOpenCluster() patches with the true size.
//
// INVARIANTS THIS MODULE OWNS
//   1. Every size field is a legal EBML vint (never all-ones).
//   2. SimpleBlock relative timecodes fit int16 (clusters split
//      far below the 32 767 ceiling — see CLUSTER_MAX_MS).
//   3. A frame that arrives "before" the open cluster's base
//      closes the cluster and re-bases (realtime encoders emit in
//      order, but the guard is cheap and fail-safe).
//   4. The first block of the first cluster is a keyframe — the
//      export loop forces frame 0; this module TRUSTS the caller
//      for that (it only records what it is told).
//   5. finalize() is one-shot: it patches Segment size + Duration
//      and appends Cues; a second call throws (a half-patched
//      file must never ship).
//
// HONEST LIMITS
//   - No SeekHead (players scan the cluster list; Chrome's own
//     MediaRecorder output has the same shape) · no lacing (one
//     block per frame — VP9 frames are big, lacing saves nothing).
//   - TimecodeScale is fixed at 1 ms: sub-ms frame stamps round
//     (at ≤ 120 fps the rounded stamps stay strictly monotonic).
//   - Single track. Audio-in-WebM via AudioEncoder is a
//     documented post-R3 evaluation; audio exports ride
//     MediaRecorder today (see video-export.ts engine dispatch).
// ─────────────────────────────────────────────────────────────

/** Codec the muxed track declares (Matroska CodecID grammar). */
export type WebMVideoCodec = 'V_VP9' | 'V_VP8'

export interface WebMMuxerOptions {
  width: number
  height: number
  codec: WebMVideoCodec
  /** Declared container duration in ms (frames / fps × 1000) —
   *  patched into Info/Duration at finalize (never below the
   *  observed last-frame end). */
  durationMs: number
}

/** One encoded frame handed to the muxer. Timestamps use the
 *  WebCodecs convention (µs, presentation time). */
export interface MuxedVideoFrame {
  data: Uint8Array
  keyframe: boolean
  timestampUs: number
  durationUs: number
}

/** Cluster-split policy (ms). 5 s keeps files seekable-granular
 *  and int16 relative timecodes comfortably in range (32 767). */
const CLUSTER_MAX_MS = 5_000
/** A keyframe only SPLITS a cluster once the cluster is this old —
 *  otherwise a 1-frame-GOP encoder would make one cluster per
 *  frame (bloat + slow seeking). */
const CLUSTER_MIN_MS = 1_000
/** SimpleBlock relative timecode hard ceiling (int16, with slack). */
const REL_TC_MAX = 32_000

// ── EBML element IDs (webm subset) ────────────────────────────
const ID_EBML = 0x1a45dfa3
const ID_EBML_VERSION = 0x4286
const ID_EBML_READ_VERSION = 0x42f7
const ID_EBML_MAX_ID_LENGTH = 0x42f2
const ID_EBML_MAX_SIZE_LENGTH = 0x42f3
const ID_DOCTYPE = 0x4282
const ID_DOCTYPE_VERSION = 0x4287
const ID_DOCTYPE_READ_VERSION = 0x4285

const ID_SEGMENT = 0x18538067
const ID_INFO = 0x1549a966
const ID_TIMECODE_SCALE = 0x2ad7b1
const ID_MUXING_APP = 0x4d80
const ID_WRITING_APP = 0x5741
const ID_DURATION = 0x4489

const ID_TRACKS = 0x1654ae6b
const ID_TRACK_ENTRY = 0xae
const ID_TRACK_NUMBER = 0xd7
const ID_TRACK_UID = 0x73c5
const ID_TRACK_TYPE = 0x83
const ID_FLAG_LACING = 0x9c
const ID_CODEC_ID = 0x86
const ID_VIDEO = 0xe0
const ID_PIXEL_WIDTH = 0xb0
const ID_PIXEL_HEIGHT = 0xba

const ID_CLUSTER = 0x1f43b675
const ID_CLUSTER_TIMECODE = 0xe7
const ID_SIMPLE_BLOCK = 0xa3

const ID_CUES = 0x1c53bb6b
const ID_CUE_POINT = 0xbb
const ID_CUE_TIME = 0xb3
const ID_CUE_TRACK_POSITIONS = 0xb7
const ID_CUE_TRACK = 0xf7
const ID_CUE_CLUSTER_POSITION = 0xf1

// ── pure byte helpers ─────────────────────────────────────────

/** Byte length of the minimal unsigned EBML vint for `value`.
 *  A vint's payload must be ≤ 2^(7n) − 2 (all-ones is reserved
 *  for "unknown"), so 127 needs two bytes, 16 383 needs three. */
export function vintLength(value: number): number {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new Error(`webm-muxer: invalid vint ${value}`)
  }
  let n = 1
  while (n < 8 && value > 2 ** (7 * n) - 2) n++
  // NOTE: guard on >= 2**56, not > 2**56 - 2 — doubles above 2^53
  // have 16-wide spacing, so 2**56 - 2 ROUNDS BACK to 2**56 and a
  // subtractive bound silently never fires (found by the unit suite).
  if (value >= 2 ** 56) throw new Error(`webm-muxer: vint too large: ${value}`)
  return n
}

/** Encode `value` as a minimal unsigned EBML vint. */
export function vintBytes(value: number): Uint8Array {
  const n = vintLength(value)
  const out = new Uint8Array(n)
  out[0] = 0x80 >> (n - 1) // the length marker's 1 bit
  let v = value
  for (let i = n - 1; i >= 1; i--) {
    out[i] = v & 0xff
    v = Math.floor(v / 256)
  }
  out[0] |= v & 0x7f
  return out
}

/** An EBML element ID in minimal big-endian form (IDs carry
 *  their own leading 1 bit — no length prefix). */
export function idBytes(id: number): Uint8Array {
  const bytes: number[] = []
  let v = id
  while (v > 0) {
    bytes.unshift(v & 0xff)
    v = Math.floor(v / 256)
  }
  if (bytes.length === 0 || bytes.length > 4) throw new Error(`webm-muxer: bad element id ${id}`)
  return new Uint8Array(bytes)
}

/** Minimal big-endian unsigned integer body. */
export function uintBE(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0) throw new Error(`webm-muxer: bad uint ${value}`)
  const bytes: number[] = []
  let v = value
  do {
    bytes.unshift(v & 0xff)
    v = Math.floor(v / 256)
  } while (v > 0)
  return new Uint8Array(bytes)
}

/** Big-endian IEEE double body. */
export function float64BE(value: number): Uint8Array {
  const f = new Float64Array(1)
  f[0] = value
  const le = new Uint8Array(f.buffer)
  const be = new Uint8Array(8)
  for (let i = 0; i < 8; i++) be[i] = le[7 - i]
  return be
}

/** A complete element: ID + size-vint + body. */
export function el(id: number, body: Uint8Array): Uint8Array {
  const idB = idBytes(id)
  const sizeB = vintBytes(body.length)
  const out = new Uint8Array(idB.length + sizeB.length + body.length)
  out.set(idB, 0)
  out.set(sizeB, idB.length)
  out.set(body, idB.length + sizeB.length)
  return out
}

/** Minimal unsigned-integer child element. */
export function uintEl(id: number, value: number): Uint8Array {
  return el(id, uintBE(value))
}

/** UTF-8 string child element. */
export function stringEl(id: number, s: string): Uint8Array {
  return el(id, new TextEncoder().encode(s))
}

function concat(...parts: Uint8Array[]): Uint8Array {
  let n = 0
  for (const p of parts) n += p.length
  const out = new Uint8Array(n)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** An 8-byte vint placeholder (marker 0x01 + seven 0x00 bytes)
 *  for sizes that are only known later; `patchVint8` fills it. */
function vint8Placeholder(): Uint8Array {
  const out = new Uint8Array(8)
  out[0] = 0x01
  return out
}

/** Write the true size into an 8-byte vint placeholder. */
function patchVint8(target: Uint8Array, offset: number, size: number): void {
  if (size >= 2 ** 56) throw new Error('webm-muxer: size too large for an 8-byte vint')
  let v = size
  for (let i = 7; i >= 1; i--) {
    target[offset + i] = v & 0xff
    v = Math.floor(v / 256)
  }
  target[offset] = 0x01 | (v & 0x7f)
}

// ── append-only buffer with in-place patching ─────────────────
class ByteSink {
  private buf: Uint8Array
  private len = 0

  constructor(initial = 1 << 16) {
    this.buf = new Uint8Array(initial)
  }

  get length(): number {
    return this.len
  }

  private ensure(extra: number): void {
    if (this.len + extra <= this.buf.length) return
    let cap = this.buf.length
    while (cap < this.len + extra) cap *= 2
    const next = new Uint8Array(cap)
    next.set(this.buf.subarray(0, this.len))
    this.buf = next
  }

  bytes(b: Uint8Array): void {
    this.ensure(b.length)
    this.buf.set(b, this.len)
    this.len += b.length
  }

  patchAt(offset: number, b: Uint8Array): void {
    if (offset < 0 || offset + b.length > this.len) throw new Error('webm-muxer: patch out of range')
    this.buf.set(b, offset)
  }

  /** A stable, mutation-safe copy of everything written so far
   *  (backed by a plain ArrayBuffer — BlobPart-friendly). */
  finish(): Uint8Array<ArrayBuffer> {
    return this.buf.slice(0, this.len)
  }
}

/** A closed cluster, remembered for the Cues element. */
interface FinishedCluster {
  /** Offset of the cluster element ID relative to the segment
   *  DATA start — exactly what CueClusterPosition demands. */
  relOffset: number
  /** Absolute cluster base timecode (ms). */
  baseMs: number
}

export class WebMMuxer {
  private readonly sink = new ByteSink()
  private readonly opts: WebMMuxerOptions
  private readonly clusters: FinishedCluster[] = []
  private frameCount = 0
  /** End of the last frame (ms) — the observed duration floor. */
  private lastEndMs = 0

  /** Where the segment's 8-byte size placeholder lives. */
  private readonly segmentSizeAt: number
  /** Buffer offset just past the segment ID + size fields. */
  private readonly segmentDataStart: number
  /** Where the open cluster's 8-byte size placeholder lives. */
  private openSizeAt = -1
  /** Buffer offset just past the open cluster's ID + size fields. */
  private openBodyStart = -1
  /** Buffer offset of the open cluster's element ID. */
  private openIdAt = -1
  /** Base timecode (ms) of the open cluster. */
  private openBaseMs = 0

  /** Where Info/Duration's float body lives (patched at finalize). */
  private readonly durationAt: number
  private finalized = false

  constructor(opts: WebMMuxerOptions) {
    if (!Number.isInteger(opts.width) || !Number.isInteger(opts.height) || opts.width < 2 || opts.height < 2) {
      throw new Error(`webm-muxer: bad dimensions ${opts.width}x${opts.height}`)
    }
    if (!Number.isFinite(opts.durationMs) || opts.durationMs < 0) {
      throw new Error(`webm-muxer: bad duration ${opts.durationMs}`)
    }
    this.opts = opts

    // ── EBML header (composed bottom-up) ─────────────────────
    this.sink.bytes(
      el(
        ID_EBML,
        concat(
          uintEl(ID_EBML_VERSION, 1),
          uintEl(ID_EBML_READ_VERSION, 1),
          uintEl(ID_EBML_MAX_ID_LENGTH, 4),
          uintEl(ID_EBML_MAX_SIZE_LENGTH, 8),
          stringEl(ID_DOCTYPE, 'webm'),
          uintEl(ID_DOCTYPE_VERSION, 2),
          uintEl(ID_DOCTYPE_READ_VERSION, 2),
        ),
      ),
    )

    // ── Segment with an 8-byte size placeholder ──────────────
    this.sink.bytes(idBytes(ID_SEGMENT))
    this.segmentSizeAt = this.sink.length
    this.sink.bytes(vint8Placeholder())
    this.segmentDataStart = this.sink.length

    // ── Info (Duration is the LAST child → its float body is
    //    the final 8 bytes of the blob; the offset is captured
    //    for the finalize patch) ──────────────────────────────
    const info = el(
      ID_INFO,
      concat(
        uintEl(ID_TIMECODE_SCALE, 1_000_000), // 1 ms per timecode tick
        stringEl(ID_MUXING_APP, 'Canvix'),
        stringEl(ID_WRITING_APP, 'Canvix WebCodecs export'),
        el(ID_DURATION, float64BE(opts.durationMs)),
      ),
    )
    this.durationAt = this.sink.length + info.length - 8
    this.sink.bytes(info)

    // ── Tracks: one video track (composed bottom-up) ──────────
    this.sink.bytes(
      el(
        ID_TRACKS,
        el(
          ID_TRACK_ENTRY,
          concat(
            uintEl(ID_TRACK_NUMBER, 1),
            uintEl(ID_TRACK_UID, 1),
            uintEl(ID_TRACK_TYPE, 1), // 1 = video
            uintEl(ID_FLAG_LACING, 0), // we never lace
            stringEl(ID_CODEC_ID, opts.codec),
            el(ID_VIDEO, concat(uintEl(ID_PIXEL_WIDTH, opts.width), uintEl(ID_PIXEL_HEIGHT, opts.height))),
          ),
        ),
      ),
    )
  }

  /** Append one encoded frame (frames arrive in decode order; an
   *  out-of-order stamp closes the cluster and re-bases). */
  addFrame(frame: MuxedVideoFrame): void {
    if (this.finalized) throw new Error('webm-muxer: finalized — addFrame after finalize')
    if (frame.data.length === 0) throw new Error('webm-muxer: empty frame payload')
    const tMs = Math.round(frame.timestampUs / 1000)
    this.frameCount += 1
    this.lastEndMs = Math.max(this.lastEndMs, tMs + Math.max(1, Math.round(frame.durationUs / 1000)))

    // split policy — evaluated BEFORE opening the next cluster
    if (this.openIdAt >= 0) {
      const rel = tMs - this.openBaseMs
      const age = tMs - this.openBaseMs
      if (rel < 0 || rel > REL_TC_MAX || age >= CLUSTER_MAX_MS || (frame.keyframe && age >= CLUSTER_MIN_MS)) {
        this.closeOpenCluster()
      }
    }

    if (this.openIdAt < 0) {
      this.openIdAt = this.sink.length
      this.sink.bytes(idBytes(ID_CLUSTER))
      this.openSizeAt = this.sink.length
      this.sink.bytes(vint8Placeholder())
      this.openBodyStart = this.sink.length
      this.openBaseMs = tMs
      this.sink.bytes(uintEl(ID_CLUSTER_TIMECODE, tMs))
    }

    // SimpleBlock: [track vint 0x81][int16 rel timecode][flags][payload]
    const rel = tMs - this.openBaseMs
    const rel16 = Math.max(-32768, Math.min(32767, rel))
    const blockBody = new Uint8Array(4 + frame.data.length)
    blockBody[0] = 0x81 // track number 1 as a vint
    blockBody[1] = (rel16 & 0xff00) >> 8
    blockBody[2] = rel16 & 0xff
    blockBody[3] = frame.keyframe ? 0x80 : 0x00
    blockBody.set(frame.data, 4)
    this.sink.bytes(el(ID_SIMPLE_BLOCK, blockBody))
  }

  /** Close the open cluster: patch its placeholder size and
   *  remember it for the Cues element. */
  private closeOpenCluster(): void {
    if (this.openIdAt < 0) return
    const size = this.sink.length - this.openBodyStart
    const patch = vint8Placeholder()
    patchVint8(patch, 0, size)
    this.sink.patchAt(this.openSizeAt, patch)
    this.clusters.push({ relOffset: this.openIdAt - this.segmentDataStart, baseMs: this.openBaseMs })
    this.openIdAt = -1
    this.openSizeAt = -1
    this.openBodyStart = -1
  }

  /** Number of frames muxed so far. */
  get frames(): number {
    return this.frameCount
  }

  /** Patch the segment size + Duration, append Cues, return the
   *  complete file (plain-ArrayBuffer-backed). One-shot. */
  finalize(): Uint8Array<ArrayBuffer> {
    if (this.finalized) throw new Error('webm-muxer: already finalized')
    this.finalized = true
    this.closeOpenCluster()

    // ── Cues: one CuePoint per cluster ───────────────────────
    if (this.clusters.length > 0) {
      const points = this.clusters.map((c) =>
        el(
          ID_CUE_POINT,
          concat(
            uintEl(ID_CUE_TIME, c.baseMs),
            el(ID_CUE_TRACK_POSITIONS, concat(uintEl(ID_CUE_TRACK, 1), uintEl(ID_CUE_CLUSTER_POSITION, c.relOffset))),
          ),
        ),
      )
      this.sink.bytes(el(ID_CUES, concat(...points)))
    }

    // ── patch the segment size with everything written ───────
    const segPatch = vint8Placeholder()
    patchVint8(segPatch, 0, this.sink.length - this.segmentDataStart)
    this.sink.patchAt(this.segmentSizeAt, segPatch)

    // ── patch Duration: never below the observed last-frame end ──
    const durationMs = Math.max(this.opts.durationMs, this.lastEndMs)
    this.sink.patchAt(this.durationAt, float64BE(durationMs))

    return this.sink.finish()
  }
}
