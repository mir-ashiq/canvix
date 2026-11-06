import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * v0.15 (R3): moving video in exports — acceptance.
 *
 *   1. (WebCodecs engine) a SILENT design whose only moving element is
 *      an autoplay video exports the VIDEO CONTENT, not the poster:
 *      grayscale frames extracted at two timeline points must differ
 *      substantially (testsrc changes every frame — the poster path
 *      cannot move).
 *   2. the GATE: the same design with autoplay OFF exports the static
 *      poster render — the two extracted frames are (near-)identical.
 *      This pins the presentation semantic (non-autoplay = poster) and
 *      proves spec 1 moved because of R3, not because "something" moved.
 *   3. (MediaRecorder engine) a page-audio design (the engine matrix
 *      routes it to MediaRecorder) also renders the moving video — the
 *      wall-clock engine plays videos beside the audio instead of
 *      seeking them per frame.
 *
 * Register budget: ZERO — anonymous designs, fresh contexts (the
 * PR #26/#30 lesson).
 */

test.use({
  launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
})

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'

/** the export pipeline's fixed fps */
const FPS = 30

// ── fixtures ──────────────────────────────────────────────────

/** 6 s of MOVING test pattern as VP8 WebM (open codec — decodable in
 *  stock Chromium, the same choice the v0110 smoke makes). Cached. */
function makeMovingWebm(): Buffer | null {
  const p = join(tmpdir(), 'canvix-r3-moving.webm')
  try {
    if (!existsSync(p)) {
      execFileSync(
        'ffmpeg',
        [
          '-y', '-loglevel', 'error',
          '-f', 'lavfi', '-i', 'testsrc=duration=6:size=320x240:rate=15',
          '-c:v', 'libvpx', '-b:v', '200k', p,
        ],
        { timeout: 30_000 },
      )
    }
    return readFileSync(p)
  } catch {
    return null
  }
}

/** mono 16-bit PCM WAV, 120 BPM click track (the v0110 payload) */
function makeWav(seconds = 2.5): Buffer {
  const sampleRate = 44_100
  const samples = Math.floor(sampleRate * seconds)
  const buf = Buffer.alloc(44 + samples * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + samples * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(samples * 2, 40)
  const period = sampleRate / 2 // 120 BPM
  for (let i = 0; i < samples; i++) {
    const t = i % period
    const v = t < 400 ? Math.round(Math.exp(-t / 80) * 22000 * (t % 4 < 2 ? 1 : -1)) : 0
    buf.writeInt16LE(v, 44 + i * 2)
  }
  return buf
}

// ── shared API helpers (anonymous, link-editable designs) ─────

const created = { designs: [] as string[], media: [] as string[] }

async function uploadMedia(request: APIRequestContext, mime: string, bytes: Buffer): Promise<string | null> {
  const init = await request.post(`${BASE}/api/media`, { data: { mime, size: bytes.length } })
  if (!init.ok()) return null
  const { id, chunkSize } = (await init.json()) as { id: string; chunkSize: number }
  created.media.push(id)
  for (let off = 0; off < bytes.length; off += chunkSize) {
    const part = bytes.subarray(off, Math.min(off + chunkSize, bytes.length))
    const r = await request.patch(`${BASE}/api/media/${id}?offset=${off}`, {
      headers: { 'content-type': 'application/octet-stream' },
      data: part,
    })
    if (!r.ok()) return null
  }
  const fin = await request.put(`${BASE}/api/media/${id}`, { data: { expectedSize: bytes.length } })
  return fin.ok() ? id : null
}

/** the 1×1 transparent PNG poster (the v0110 fixture) — anything the
 *  static path shows over it is Canvix chrome, never video content */
const POSTER_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

async function createDesign(
  request: APIRequestContext,
  webmId: string,
  opts: { autoplay: boolean; withAudio?: string },
): Promise<string> {
  const video = {
    id: 'VID1', type: 'video',
    x: 160, y: 120, width: 480, height: 360,
    rotation: 0, opacity: 1, locked: false, visible: true,
    shadow: { enabled: false, color: '#000000', blur: 12, offsetX: 0, offsetY: 6 },
    src: `/api/media/${webmId}`,
    poster: POSTER_1PX,
    duration: 6, volume: 0.7, muted: false, loop: false, autoplay: opts.autoplay,
    trimStart: 0, trimEnd: 6,
  }
  const audio = opts.withAudio
    ? [
        {
          id: 'AUD1', type: 'audio',
          x: 40, y: 470, width: 420, height: 80,
          rotation: 0, opacity: 1, locked: false, visible: true,
          shadow: { enabled: false, color: '#000000', blur: 12, offsetX: 0, offsetY: 6 },
          src: `/api/media/${opts.withAudio}`,
          name: 'probe-clicks.wav',
          duration: 2.5, volume: 0.9, loop: true, autoplay: true,
          peaks: [0.1, 0.9, 0.2, 0.7, 0.3], bpm: 120,
          beats: Array.from({ length: 5 }, (_, i) => 0.1 + i * 0.5),
        },
      ]
    : []
  const res = await request.post(`${BASE}/api/designs`, {
    data: {
      name: 'r3 moving video acceptance',
      width: 800,
      height: 600,
      pages: [
        {
          id: 'p1',
          background: { type: 'solid', color: '#ffffff' },
          elements: [video, ...audio],
        },
      ],
    },
  })
  expect(res.status(), `create design: ${await res.text()}`).toBeLessThan(300)
  const id = ((await res.json()) as { id: string }).id
  created.designs.push(id)
  return id
}

async function openEditor(page: Page, designId: string): Promise<void> {
  await page.goto(`/design/${designId}`)
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
  await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 60_000 })
}

/** run the real export flow and return the downloaded file path */
async function exportVideoFile(page: Page, designId: string): Promise<string> {
  await openEditor(page, designId)
  await page.getByLabel('Download').click()
  const dlg = page.getByRole('dialog')
  await expect(dlg.getByText('Download your design')).toBeVisible()
  await dlg.getByRole('button', { name: /Video/ }).click()
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 200_000 }),
    dlg.getByRole('button', { name: /^Download/ }).click(),
  ])
  return (await download.path())!
}

// ── frame comparison ──────────────────────────────────────────

/** decode ONE grayscale frame of the file at t seconds (raw bytes),
 *  cropped to the video element's box (480×360 at 160,120 on the
 *  800×600 export — the design is exported at 1:1, no downscale) so
 *  the diff measures the VIDEO CONTENT, not the static page around it */
function frameGray(path: string, tSec: number): Buffer {
  const out = join(tmpdir(), `canvix-r3-${process.pid}-${String(tSec).replace('.', '_')}.raw`)
  execFileSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-i', path, '-ss', String(tSec), '-map', '0:v:0', '-frames:v', '1', '-vf', 'crop=480:360:160:120', '-pix_fmt', 'gray', '-f', 'rawvideo', out],
    { timeout: 30_000 },
  )
  return readFileSync(out)
}

/** mean absolute pixel difference of two same-size gray frames */
function meanAbsDiff(a: Buffer, b: Buffer): number {
  if (a.length === 0 || a.length !== b.length) return Number.POSITIVE_INFINITY
  let s = 0
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i])
  return s / a.length
}

/** must this browser be able to seek a VP8 WebM + encode VP9? */
async function webcodecsAvailable(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return false
    try {
      const probe = await VideoEncoder.isConfigSupported({ codec: 'vp09.00.10.08', width: 800, height: 600, bitrate: 1_000_000, framerate: 30 })
      return probe.supported === true
    } catch {
      return false
    }
  })
}

// ═══ 1. WebCodecs engine renders the moving video ═════════════

test('silent design with an autoplay video exports the MOVING content via WebCodecs', async ({ page, request }) => {
  test.setTimeout(240_000)

  const webmBuf = makeMovingWebm()
  test.skip(!webmBuf, 'ffmpeg unavailable — cannot build the moving fixture')
  const webmId = (await uploadMedia(request, 'video/webm', webmBuf!))!
  expect(webmId, 'media upload').toBeTruthy()

  const designId = await createDesign(request, webmId, { autoplay: true })
  await openEditor(page, designId)
  test.skip(!(await webcodecsAvailable(page)), 'this browser has no WebCodecs VideoEncoder for VP9')

  await page.getByLabel('Download').click()
  const dlg = page.getByRole('dialog')
  await expect(dlg.getByText('Download your design')).toBeVisible()
  await dlg.getByRole('button', { name: /Video/ }).click()

  // the engine line + the R3 honesty note are both visible BEFORE the export
  await expect(dlg.getByText(/WebCodecs → WebM \(VP9\)/)).toBeVisible({ timeout: 30_000 })
  await expect(dlg.getByText(/moving content frame-accurately/)).toBeVisible()

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 200_000 }),
    dlg.getByRole('button', { name: /^Download/ }).click(),
  ])
  const path = (await download.path())!
  expect(download.suggestedFilename()).toMatch(/\.webm$/)

  // ── ffprobe: WebM, VP9 video stream, NO audio stream ──
  const probe = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=format_name,duration', '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', path]).toString(),
  ) as { format: { format_name: string; duration: string }; streams: { codec_type: string; codec_name: string }[] }
  expect(probe.format.format_name).toContain('webm')
  expect(probe.streams, `streams: ${JSON.stringify(probe.streams)}`).toHaveLength(1)
  expect(probe.streams[0].codec_type).toBe('video')
  expect(probe.streams[0].codec_name).toBe('vp9')

  // single page, one element → 2.2 s hold
  const duration = Number(probe.format.duration)
  expect(duration).toBeGreaterThanOrEqual(2.0)
  expect(duration).toBeLessThan(4.0)

  // ── THE ACCEPTANCE: the exported frames MOVE ──
  // The design has no animation and no other element — the video is
  // the only thing that CAN change between t=0.6 and t=1.8. The poster
  // path (spec 2) cannot move; a mean gray diff this large is moving
  // video content, not codec noise.
  const diff = meanAbsDiff(frameGray(path, 0.6), frameGray(path, 1.8))
  expect(diff, 'mean gray diff between t=0.6 and t=1.8').toBeGreaterThan(5)
})

// ═══ 2. the gate: non-autoplay keeps the poster ═══════════════

test('the same design with autoplay OFF exports the static poster render', async ({ page, request }) => {
  test.setTimeout(240_000)

  const webmBuf = makeMovingWebm()
  test.skip(!webmBuf, 'ffmpeg unavailable — cannot build the moving fixture')
  const webmId = (await uploadMedia(request, 'video/webm', webmBuf!))!
  expect(webmId, 'media upload').toBeTruthy()

  const designId = await createDesign(request, webmId, { autoplay: false })
  await openEditor(page, designId)
  test.skip(!(await webcodecsAvailable(page)), 'this browser has no WebCodecs VideoEncoder for VP9')

  // no autoplay video ⇒ no R3 note in the dialog
  await page.getByLabel('Download').click()
  const dlg = page.getByRole('dialog')
  await expect(dlg.getByText('Download your design')).toBeVisible()
  await dlg.getByRole('button', { name: /Video/ }).click()
  await expect(dlg.getByText(/WebCodecs → WebM \(VP9\)/)).toBeVisible({ timeout: 30_000 })
  await expect(dlg.getByText(/moving content frame-accurately/)).toBeHidden()

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 200_000 }),
    dlg.getByRole('button', { name: /^Download/ }).click(),
  ])
  const path = (await download.path())!

  // the static poster render cannot move: identical pixels at both
  // times (a hair of tolerance for VP9 quantisation across GOPs)
  const diff = meanAbsDiff(frameGray(path, 0.6), frameGray(path, 1.8))
  expect(diff, 'mean gray diff between t=0.6 and t=1.8').toBeLessThan(1)
})

// ═══ 3. MediaRecorder engine plays the video in wall clock ════

test('a page-audio design (MediaRecorder engine) also renders the moving video', async ({ page, request }) => {
  test.setTimeout(240_000)

  const webmBuf = makeMovingWebm()
  test.skip(!webmBuf, 'ffmpeg unavailable — cannot build the moving fixture')
  const wavId = (await uploadMedia(request, 'audio/wav', makeWav()))!
  const webmId = (await uploadMedia(request, 'video/webm', webmBuf!))!
  expect(wavId && webmId, 'media uploads').toBeTruthy()

  // the autoplay AUDIO forces the engine matrix onto MediaRecorder
  const designId = await createDesign(request, webmId, { autoplay: true, withAudio: wavId })
  await openEditor(page, designId)

  const mrAvailable = await page.evaluate(() => typeof MediaRecorder !== 'undefined')
  test.skip(!mrAvailable, 'this browser has no MediaRecorder')

  await page.getByLabel('Download').click()
  const dlg = page.getByRole('dialog')
  await expect(dlg.getByText('Download your design')).toBeVisible()
  await dlg.getByRole('button', { name: /Video/ }).click()
  await expect(dlg.getByText(/MediaRecorder/)).toBeVisible({ timeout: 30_000 })

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 200_000 }),
    dlg.getByRole('button', { name: /^Download/ }).click(),
  ])
  const path = (await download.path())!
  expect(download.suggestedFilename()).toMatch(/\.(webm|mp4)$/)

  // the recorder muxes the page audio → one video + one audio stream
  const probe = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', path]).toString(),
  ) as { streams: { codec_type: string }[] }
  expect(probe.streams.filter((s) => s.codec_type === 'video'), 'video streams').toHaveLength(1)
  expect(probe.streams.filter((s) => s.codec_type === 'audio'), 'audio streams').toHaveLength(1)

  // and the video content still MOVES on the wall-clock engine
  const diff = meanAbsDiff(frameGray(path, 0.6), frameGray(path, 1.8))
  expect(diff, 'mean gray diff between t=0.6 and t=1.8').toBeGreaterThan(5)
})
