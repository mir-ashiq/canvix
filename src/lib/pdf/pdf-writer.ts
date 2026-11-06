// ─────────────────────────────────────────────────────────────
// PDF writer (v0.15 R4) — a minimal, dependency-free PDF 1.4
// object model + classic xref-table serializer.
//
// Scope: exactly what a Canvix export needs — pages with content
// streams, JPEG image XObjects (DCTDecode passthrough — the bytes
// are already compressed, no re-encode), ExtGState opacity, and
// embedded subset TrueType fonts (built by ttf.ts). Content
// streams are UNCOMPRESSED by design (documented in
// docs/PDF-VECTOR-EXPORT.md): text/path operators are a few KB
// per page and images carry their own JPEG entropy coding, so
// Flate would add a dependency (or a CompressionStream hop) for
// marginal gain.
//
// The whole module is pure (no DOM) and runs in node unit tests;
// every document it emits is re-parsed by an independent parser
// in pdf-writer.test.ts (the R2 mini-EBML pattern).
// ─────────────────────────────────────────────────────────────

const encoder = new TextEncoder()

/** Format a JS number as a PDF numeric object — never exponential,
 * never `-0`, at most 4 decimals (plenty for design-space px).
 * Magnitudes beyond ±1e15 clamp: design space tops out around
 * 1e4, and anything larger is already corrupt geometry. */
export function pdfNum(n: number): string {
  if (!Number.isFinite(n)) return '0'
  let v = n
  if (v > 1e15) v = 1e15
  if (v < -1e15) v = -1e15
  const s = v.toFixed(4)
  return s.replace(/\.?0+$/, '') || '0'
}

/** Escape a PDF literal string body: `(`, `)` and `\` — octal
 * escapes for anything outside printable ASCII. */
export function pdfEscapeLiteral(s: string): string {
  let out = ''
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch
    else if (c >= 32 && c <= 126) out += ch
    else if (c <= 0xff) out += '\\' + c.toString(8).padStart(3, '0')
    else out += '?' // callers needing >U+00FF must use hex strings
  }
  return out
}

/** PDF text string (e.g. /Title) — plain literal when pure
 * ASCII, UTF-16BE hex string otherwise (the PDF 1.4 way). */
export function pdfTextString(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return `(${pdfEscapeLiteral(s)})`
  let hex = 'FEFF'
  for (let i = 0; i < s.length; i++) {
    const u = s.charCodeAt(i)
    if (u >= 0xd800 && u <= 0xdbff && i + 1 < s.length) {
      const lo = s.charCodeAt(i + 1)
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        hex += ((u - 0xd800) * 0x400 + (lo - 0xdc00) + 0x10000).toString(16).padStart(4, '0')
        i++
        continue
      }
    }
    hex += u.toString(16).padStart(4, '0')
  }
  return `<${hex.toUpperCase()}>`
}

interface PdfObject {
  dict: string
  stream?: Uint8Array | string
  reserved?: boolean
  defined?: boolean
}

/** A build-time PDF document. Objects are numbered in creation
 * order (1-based); references are the caller's to keep. */
export class PdfWriter {
  private objects: PdfObject[] = []
  private offsets: number[] = []
  private byteLength = 0
  private chunks: (string | Uint8Array)[] = []

  /** Add a plain (dictionary-only) object; returns its number. */
  addObject(dict: string): number {
    this.objects.push({ dict })
    return this.objects.length
  }

  /** Reserve the next object number — the dict is supplied later
   * via defineObject (forward references: pages → /Pages tree). */
  reserveObject(): number {
    this.objects.push({ dict: '', reserved: true })
    return this.objects.length
  }

  /** Define a previously reserved object. */
  defineObject(num: number, dict: string): void {
    const obj = this.objects[num - 1]
    if (!obj || !obj.reserved) throw new Error(`object ${num} is not reserved`)
    if (obj.defined) throw new Error(`object ${num} already defined`)
    obj.dict = dict
    obj.reserved = false
    obj.defined = true
  }

  /** Add a stream object. `/Length` is injected automatically;
   * `extraDict` may carry `/Length1`, `/Filter` etc. Returns the
   * object number. */
  addStreamObject(extraDict: string, data: Uint8Array | string): number {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data
    const dict = `<< ${extraDict} /Length ${bytes.length} >>`.replace('<<  ', '<< ')
    this.objects.push({ dict, stream: bytes })
    return this.objects.length
  }

  /** Reference string for an object number. */
  ref(num: number): string {
    return `${num} 0 R`
  }

  private push(chunk: string | Uint8Array): void {
    this.chunks.push(chunk)
    this.byteLength += typeof chunk === 'string' ? encoder.encode(chunk).length : chunk.length
  }

  /** Serialize the document. `rootRef`/`infoRef` are object
   * numbers for /Catalog and (optional) /Info. */
  finalize(rootRef: number, infoRef?: number): Uint8Array {
    this.chunks = []
    this.byteLength = 0

    // header + binary comment (keeps transport layers honest)
    this.push('%PDF-1.4\n%')
    this.push(new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3]))
    this.push('\n')

    // objects, recording exact byte offsets for the xref table
    this.offsets = new Array(this.objects.length).fill(0)
    this.objects.forEach((obj, i) => {
      const num = i + 1
      this.offsets[i] = this.byteLength
      this.push(`${num} 0 obj\n`)
      if (obj.stream === undefined) {
        this.push(`${obj.dict}\n`)
      } else {
        this.push(`${obj.dict}\nstream\n`)
        this.push(obj.stream)
        this.push('\nendstream\n')
      }
      this.push('endobj\n')
    })

    // classic xref table
    const count = this.objects.length
    const xrefOffset = this.byteLength
    let xref = `xref\n0 ${count + 1}\n0000000000 65535 f \n`
    for (let i = 0; i < count; i++) {
      xref += `${String(this.offsets[i]).padStart(10, '0')} 00000 n \n`
    }
    this.push(xref)

    const info = infoRef ? ` /Info ${this.ref(infoRef)}` : ''
    this.push(`trailer\n<< /Size ${count + 1} /Root ${this.ref(rootRef)}${info} >>\n`)
    this.push(`startxref\n${xrefOffset}\n%%EOF\n`)

    // assemble
    const out = new Uint8Array(this.byteLength)
    let at = 0
    for (const chunk of this.chunks) {
      if (typeof chunk === 'string') {
        const bytes = encoder.encode(chunk)
        out.set(bytes, at)
        at += bytes.length
      } else {
        out.set(chunk, at)
        at += chunk.length
      }
    }
    return out
  }
}

// ── JPEG dimension probe (for image XObjects) ───────────────
// Scans SOF markers of a JPEG byte stream for the frame dims.
// Only the metadata we embed images with is read — pixels are
// passed through untouched (DCTDecode).

/** Returns { width, height } from JPEG SOF bytes, or null when
 * the stream is not a JPEG we recognize (caller falls back). */
export function parseJpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let i = 2
  // bound the scan — SOF appears within the header segment chain
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++
      continue
    }
    const marker = bytes[i + 1]
    // standalone markers without length fields
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2
      continue
    }
    if (i + 4 > bytes.length) return null
    const segLen = (bytes[i + 2] << 8) | bytes[i + 3]
    // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 9 > bytes.length || segLen < 8) return null
      const height = (bytes[i + 5] << 8) | bytes[i + 6]
      const width = (bytes[i + 7] << 8) | bytes[i + 8]
      if (width > 0 && height > 0) return { width, height }
      return null
    }
    if (marker === 0xda) return null // SOS before SOF — malformed
    i += 2 + segLen
  }
  return null
}

// ── shared geometry/format helpers used by the page mappers ──

/** Hex RGB(A) → `r g b` fill operand (0..1). Accepts `#rgb`,
 * `#rrggbb`, `#rrggbbaa`; invalid input yields black (fail-safe
 * like every renderer in this codebase). */
export function pdfRgb(color: string): string {
  let hex = color.trim()
  if (!hex.startsWith('#')) {
    // named colours the templates use fall back to their nearest
    // documented stack entry — everything unknown is black
    const named: Record<string, string> = { white: '#ffffff', black: '#000000', transparent: '#000000' }
    hex = named[hex.toLowerCase()] ?? '#000000'
  }
  hex = hex.slice(1)
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('')
  if (hex.length === 8) hex = hex.slice(0, 6)
  if (hex.length !== 6 || /[^0-9a-fA-F]/.test(hex)) return '0 0 0'
  const r = parseInt(hex.slice(0, 2), 16) / 255
  const g = parseInt(hex.slice(2, 4), 16) / 255
  const b = parseInt(hex.slice(4, 6), 16) / 255
  return `${pdfNum(r)} ${pdfNum(g)} ${pdfNum(b)}`
}

/** Alpha from an 8-digit hex colour (default 1). */
export function pdfAlpha(color: string): number {
  const hex = color.trim().startsWith('#') ? color.trim().slice(1) : ''
  if (hex.length === 8 && /^[0-9a-fA-F]+$/.test(hex)) return parseInt(hex.slice(6, 8), 16) / 255
  return 1
}
