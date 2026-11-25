// Unit tests for the media type-truth layer (v0.31, CWE-79 fix).
// Real magic bytes for every claim: the sniffers must recognize each
// allowed raster image and each audio/video container exactly, and
// must NEVER mistake SVG/HTML/XML for any of them.

import { describe, it, expect } from 'vitest'
import {
  canonicalMediaMime,
  sniffImageMime,
  sniffIsMediaContainer,
  uploadBytesMatchMime,
  mayServeInline,
} from './sniff'

// real file signatures (trimmed to the bytes the sniffers read)
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1])
const GIF = Buffer.from('GIF89a' + '\x00'.repeat(6))
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0x38, 0, 0]), Buffer.from('WEBPVP8 ')])
const AVIF = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypavif')])
const BMP = Buffer.concat([Buffer.from('BM'), Buffer.alloc(10)])

const ID3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(9)])
const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(8)])
const FLAC = Buffer.concat([Buffer.from('fLaC'), Buffer.alloc(8)])
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom')])
const EBML = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(8)])
const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0x08, 0, 0]), Buffer.from('WAVEfmt ')])
const MP3_SYNC = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0, 0, 0, 0, 0, 0, 0, 0])
const ADTS = Buffer.from([0xff, 0xf1, 0x50, 0x80, 0, 0, 0, 0, 0, 0, 0, 0])

// the report's payload, exactly
const SVG_POC = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.domain)</script></svg>',
)
const HTML = Buffer.from('<!DOCTYPE html><html><script>alert(1)</script></html>')
const XML = Buffer.from('<?xml version="1.0"?><foo/>')

describe('canonicalMediaMime — the exact init allowlist', () => {
  it('accepts the raster/audio/video types with canonicalization', () => {
    expect(canonicalMediaMime('image/png')).toBe('image/png')
    expect(canonicalMediaMime('image/jpg')).toBe('image/jpeg') // browser alias
    expect(canonicalMediaMime('audio/mp3')).toBe('audio/mpeg')
    expect(canonicalMediaMime('audio/x-m4a')).toBe('audio/mp4')
    expect(canonicalMediaMime('video/quicktime')).toBe('video/quicktime')
  })

  it('rejects image/svg+xml and every active-content shape — the v0.30 vector', () => {
    expect(canonicalMediaMime('image/svg+xml')).toBeNull()
    expect(canonicalMediaMime('text/html')).toBeNull()
    expect(canonicalMediaMime('application/xhtml+xml')).toBeNull()
    expect(canonicalMediaMime('text/xml')).toBeNull()
    expect(canonicalMediaMime('application/xml')).toBeNull()
    // the old prefix check accepted these shapes; exactness must not regress
    expect(canonicalMediaMime('image/svg+xml; charset=utf-8')).toBeNull()
    expect(canonicalMediaMime('image/whatever')).toBeNull()
  })
})

describe('sniffImageMime — exact raster identification', () => {
  it('identifies each supported raster format by magic bytes', () => {
    expect(sniffImageMime(PNG)).toBe('image/png')
    expect(sniffImageMime(JPEG)).toBe('image/jpeg')
    expect(sniffImageMime(GIF)).toBe('image/gif')
    expect(sniffImageMime(WEBP)).toBe('image/webp')
    expect(sniffImageMime(AVIF)).toBe('image/avif')
    expect(sniffImageMime(BMP)).toBe('image/bmp')
  })

  it('never identifies SVG/HTML/XML as a raster image', () => {
    expect(sniffImageMime(SVG_POC)).toBeNull()
    expect(sniffImageMime(HTML)).toBeNull()
    expect(sniffImageMime(XML)).toBeNull()
    expect(sniffImageMime(Buffer.alloc(0))).toBeNull()
    expect(sniffImageMime(Buffer.alloc(11))).toBeNull() // too short to verify
  })
})

describe('sniffIsMediaContainer — audio/video container proof', () => {
  it('recognizes every common container signature', () => {
    expect(sniffIsMediaContainer(ID3)).toBe(true)
    expect(sniffIsMediaContainer(OGG)).toBe(true)
    expect(sniffIsMediaContainer(FLAC)).toBe(true)
    expect(sniffIsMediaContainer(MP4)).toBe(true)
    expect(sniffIsMediaContainer(EBML)).toBe(true)
    expect(sniffIsMediaContainer(WAV)).toBe(true)
    expect(sniffIsMediaContainer(MP3_SYNC)).toBe(true) // tagless mp3
    expect(sniffIsMediaContainer(ADTS)).toBe(true) // raw aac
  })

  it('never recognizes SVG/HTML/XML or rasters as a media container', () => {
    expect(sniffIsMediaContainer(SVG_POC)).toBe(false)
    expect(sniffIsMediaContainer(HTML)).toBe(false)
    expect(sniffIsMediaContainer(XML)).toBe(false)
    expect(sniffIsMediaContainer(PNG)).toBe(false)
    expect(sniffIsMediaContainer(JPEG)).toBe(false)
  })
})

describe('uploadBytesMatchMime — the finalize gate', () => {
  it('accepts bytes that prove their declared type', () => {
    expect(uploadBytesMatchMime(PNG, 'image/png')).toBe(true)
    expect(uploadBytesMatchMime(WEBP, 'image/webp')).toBe(true)
    expect(uploadBytesMatchMime(ID3, 'audio/mpeg')).toBe(true)
    expect(uploadBytesMatchMime(MP4, 'video/mp4')).toBe(true)
  })

  it('rejects the smuggle: SVG bytes under any allowed declaration', () => {
    expect(uploadBytesMatchMime(SVG_POC, 'image/png')).toBe(false)
    expect(uploadBytesMatchMime(SVG_POC, 'audio/mpeg')).toBe(false)
    expect(uploadBytesMatchMime(SVG_POC, 'video/mp4')).toBe(false)
    expect(uploadBytesMatchMime(HTML, 'image/png')).toBe(false)
  })

  it('rejects cross-format lies (jpeg bytes declared as png)', () => {
    expect(uploadBytesMatchMime(JPEG, 'image/png')).toBe(false)
    expect(uploadBytesMatchMime(PNG, 'image/jpeg')).toBe(false)
  })
})

describe('mayServeInline — the GET gate', () => {
  it('serves verified rasters and real containers inline', () => {
    expect(mayServeInline(PNG, 'image/png')).toBe(true)
    expect(mayServeInline(WAV, 'audio/wav')).toBe(true)
    expect(mayServeInline(MP4, 'video/mp4')).toBe(true)
  })

  it('downgrades the legacy vector payload to a download', () => {
    // the exact stored shape the 2026-11-25 report demonstrated
    expect(mayServeInline(SVG_POC, 'image/svg+xml')).toBe(false)
    // legacy row claiming a raster while carrying SVG bytes
    expect(mayServeInline(SVG_POC, 'image/png')).toBe(false)
    expect(mayServeInline(HTML, 'text/html')).toBe(false)
  })
})
