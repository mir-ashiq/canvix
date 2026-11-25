// ─────────────────────────────────────────────────────────────
// Media store type verification (v0.31 security hardening).
//
// The 2026-11-25 report (CWE-79, unauthenticated stored XSS via
// /api/media, credit @hackchang) showed that trusting the
// client-declared MIME prefix let `image/svg+xml` into the store,
// and GET served those bytes inline as a same-origin SVG document
// whose <script> ran with the viewer's session authority. This
// module is the server-side truth layer that ends client control
// over what this origin will instantiate as a document:
//
//   · init (POST /api/media)        — exact MIME allowlist, no
//                                     prefixes, svg/html/xml never
//                                     accepted, aliases canonicalized
//   · finalize (PUT /api/media/[id])— magic-byte verification: the
//                                     stored bytes must prove they
//                                     are what the row claims
//   · stream (GET /api/media/[id])  — bytes re-verified on every
//                                     response; anything not
//                                     provably inert is served as
//                                     application/octet-stream with
//                                     Content-Disposition: attachment
//
// Pure byte inspection — no DOM, no dependencies, runtime-safe.
// ─────────────────────────────────────────────────────────────

/** The only MIME types this origin will ever serve inline as an
 *  image: raster formats only. A raster image document cannot
 *  carry script; an SVG one can, so SVG is structurally absent. */
export const INLINE_SAFE_IMAGE_MIMES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
] as const

/** Everything the media store accepts at init, in canonical form.
 *  Deliberately exact — no prefix matching, ever again. */
export const MEDIA_MIME_ALLOWLIST: ReadonlySet<string> = new Set([
  ...INLINE_SAFE_IMAGE_MIMES,
  // audio containers
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/flac',
  // video containers
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
  'video/x-matroska',
  'video/avi',
])

/** Common browser-reported aliases mapped to the canonical form
 *  that gets stored — one truth per type, no prefix surprises. */
const MIME_ALIASES: Readonly<Record<string, string>> = {
  'image/jpg': 'image/jpeg',
  'audio/mp3': 'audio/mpeg',
  'audio/m4a': 'audio/mp4',
  'audio/x-m4a': 'audio/mp4',
  'audio/x-wav': 'audio/wav',
  'audio/x-flac': 'audio/flac',
  'video/x-msvideo': 'video/avi',
  'video/mkv': 'video/x-matroska',
}

/** Canonical allowed type for a declared MIME string, or null when
 *  the type is not exactly allowed (svg, html, xml, …). */
export function canonicalMediaMime(declared: string): string | null {
  const mime = MIME_ALIASES[declared] ?? declared
  return MEDIA_MIME_ALLOWLIST.has(mime) ? mime : null
}

/** True when the stored type is one of the audio/video families —
 *  media-element types that never execute script in any context. */
export function isAudioVideoMime(mime: string): boolean {
  return mime.startsWith('audio/') || mime.startsWith('video/')
}

function ascii(b: Uint8Array, start: number, end: number): string {
  let out = ''
  for (let i = start; i < end; i++) out += String.fromCharCode(b[i]!)
  return out
}

/** Exact raster-image type from magic bytes, or null. AVIF shares
 *  the ISO-BMFF `ftyp` header with mp4/mov, so the brand at offset
 *  8 disambiguates; WEBP shares RIFF with WAVE/AVI, same trick. */
export function sniffImageMime(b: Uint8Array): string | null {
  if (b.length < 12) return null
  // PNG — 89 50 4E 47 0D 0A 1A 0A
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  // JPEG — FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  // GIF — "GIF8"
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif'
  // RIFF container — only WEBP is an image (WAVE/AVI are media)
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'image/webp'
  // ISO-BMFF — only avif/avis brands are images
  if (ascii(b, 4, 8) === 'ftyp') {
    const brand = ascii(b, 8, 12)
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
  }
  // BMP — "BM" (checked last: a two-byte prefix alone is weak)
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp'
  return null
}

/** Do the bytes carry a known audio/video container signature?
 *  Used at finalize to prove a declared audio/video upload really
 *  is a media container — SVG/HTML/XML never match. */
export function sniffIsMediaContainer(b: Uint8Array): boolean {
  if (b.length < 12) return false
  if (ascii(b, 0, 3) === 'ID3') return true // mp3 with ID3v2 tags (3-byte tag + version byte)
  const s4 = ascii(b, 0, 4)
  if (s4 === 'OggS') return true // vorbis / opus / theora
  if (s4 === 'fLaC') return true // flac
  if (s4 === 'RIFF') return true // WAVE / AVI / WEBP
  if (ascii(b, 4, 8) === 'ftyp') return true // mp4 / m4a / mov
  // EBML — webm / matroska
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return true
  // MPEG audio frame sync (mp3 without ID3) and ADTS AAC —
  // 11-bit sync: FF followed by a byte whose top 3 bits are set.
  // (JPEG is FF D8, whose second byte fails the mask — no clash.)
  if (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) return true
  return false
}

/** Finalize-time verdict: do the actual bytes justify the row's
 *  declared type? Raster images must match their magic exactly;
 *  audio/video must carry a known container signature. */
export function uploadBytesMatchMime(bytes: Uint8Array, declaredMime: string): boolean {
  if (isAudioVideoMime(declaredMime)) return sniffIsMediaContainer(bytes)
  const sniffed = sniffImageMime(bytes)
  return sniffed !== null && sniffed === declaredMime
}

/** GET-time verdict: may these bytes be served inline as the
 *  stored type? The exact-match rule means a legacy row claiming
 *  image/png while carrying SVG bytes is downgraded to a download —
 *  trust nothing that was stored before this hardening shipped. */
export function mayServeInline(bytes: Uint8Array, storedMime: string): boolean {
  if (isAudioVideoMime(storedMime)) return sniffIsMediaContainer(bytes)
  return sniffImageMime(bytes) === storedMime
}
