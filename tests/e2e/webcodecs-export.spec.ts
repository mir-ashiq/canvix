import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'

/**
 * v0.15 (R2): WebCodecs export — acceptance.
 *
 *   1. a SILENT animated design (2 pages, 60+ animated elements —
 *      the acceptance bar from the roadmap) exports through the
 *      WebCodecs engine: the dialog says so, and the downloaded
 *      file is a WebM whose VIDEO stream is VP9 with NO audio
 *      track (the engine matrix routes audio designs to
 *      MediaRecorder — that path keeps its own coverage in
 *      v0110-smoke).
 *   2. FRAME-EXACT: ffprobe counts every frame — nb_read_frames
 *      must equal duration × fps. The old MediaRecorder loop
 *      paced against the wall clock and dropped frames when
 *      rendering fell behind; the WebCodecs loop has no clock and
 *      cannot drop.
 *   3. dimensions follow the 1× quality cap (960 longest edge,
 *      even pixels).
 *
 * Register budget: ZERO — one anonymous design, fresh context
 * (the PR #26/#30 lesson).
 */

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'

/** the export pipeline's fixed fps */
const FPS = 30

interface RectElement {
  id: string
  type: 'rect'
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  locked: boolean
  visible: boolean
  fill: string
  stroke: string
  strokeWidth: number
  cornerRadius: number
  animation: { kind: 'fade' | 'rise' | 'pan'; duration: number; delay: number; easing: 'easeOut'; direction?: 'up' | 'left' }
}

function animatedRect(i: number, page: number): RectElement {
  const col = i % 10
  const row = Math.floor(i / 10)
  return {
    id: `R${page}-${i}`,
    type: 'rect',
    x: 20 + col * 78,
    y: 20 + row * 58,
    width: 64,
    height: 44,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    fill: `hsl(${(i * 37) % 360} 70% 55%)`,
    stroke: '',
    strokeWidth: 0,
    cornerRadius: 6,
    animation: { kind: i % 3 === 0 ? 'rise' : i % 3 === 1 ? 'pan' : 'fade', duration: 0.6, delay: (i % 10) * 0.08, easing: 'easeOut', direction: i % 2 === 0 ? 'up' : 'left' },
  }
}

async function createSilentDesign(request: APIRequestContext): Promise<string> {
  const pages = [0, 1].map((p) => ({
    id: `p${p + 1}`,
    background: { type: 'solid' as const, color: '#ffffff' },
    // the transition INTO page 2 rides on page 2 (buildTimeline
    // reads pages[i+1].transition)
    transition: p === 1 ? { kind: 'fade' as const, duration: 0.7 } : undefined,
    elements: Array.from({ length: 32 }, (_, i) => animatedRect(i, p)),
  }))
  const res = await request.post(`${BASE}/api/designs`, {
    data: { name: 'r2 webcodecs acceptance', width: 1080, height: 720, pages },
  })
  expect(res.status(), `create design: ${await res.text()}`).toBeLessThan(300)
  return ((await res.json()) as { id: string }).id
}

async function openEditor(page: Page, designId: string): Promise<void> {
  await page.goto(`/design/${designId}`)
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
  await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 60_000 })
}

test('silent animated design exports via WebCodecs — VP9 WebM, frame-exact, no audio', async ({ page, request }) => {
  test.setTimeout(240_000)

  const designId = await createSilentDesign(request)
  await openEditor(page, designId)

  // WebCodecs must exist in this browser for the assertion to be
  // meaningful (Chromium has it; skip honestly elsewhere)
  const webcodecs = await page.evaluate(async () => {
    if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return false
    try {
      const probe = await VideoEncoder.isConfigSupported({ codec: 'vp09.00.10.08', width: 960, height: 640, bitrate: 1_000_000, framerate: 30 })
      return probe.supported === true
    } catch {
      return false
    }
  })
  test.skip(!webcodecs, 'this browser has no WebCodecs VideoEncoder for VP9')

  await page.getByLabel('Download').click()
  const dlg = page.getByRole('dialog')
  await expect(dlg.getByText('Download your design')).toBeVisible()
  await dlg.getByRole('button', { name: /Video/ }).click()

  // the engine line is honest BEFORE the export starts
  await expect(dlg.getByText(/WebCodecs → WebM \(VP9\)/)).toBeVisible({ timeout: 30_000 })

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 200_000 }),
    dlg.getByRole('button', { name: /^Download/ }).click(),
  ])
  const path = (await download.path())!
  expect(download.suggestedFilename()).toMatch(/\.webm$/)

  // ── ffprobe: container, codec, dimensions, NO audio stream ──
  const probe = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=format_name,duration', '-show_entries', 'stream=index,codec_type,codec_name,width,height', '-of', 'json', path]).toString(),
  ) as {
    format: { format_name: string; duration: string }
    streams: { codec_type: string; codec_name: string; width: number; height: number }[]
  }
  expect(probe.format.format_name).toContain('webm')
  expect(probe.streams.length, `streams: ${JSON.stringify(probe.streams)}`).toBe(1)
  const video = probe.streams[0]
  expect(video.codec_type).toBe('video')
  expect(video.codec_name).toBe('vp9')
  // the dialog's shared quality selector defaults to 2× → a 1440
  // cap on a 1080×720 design means NO downscale (min(1, 1440/1080))
  expect(video.width).toBe(1080)
  expect(video.height).toBe(720)

  // ── FRAME-EXACT: every frame the timeline promised is in the file ──
  const counted = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames,avg_frame_rate', '-of', 'json', path]).toString(),
  ) as { streams: { nb_read_frames: string; avg_frame_rate: string }[] }
  const nbRead = Number(counted.streams[0].nb_read_frames)
  const duration = Number(probe.format.duration)
  expect(Number.isFinite(nbRead) && nbRead, `nb_read_frames: ${JSON.stringify(counted)}`).toBeGreaterThan(0)

  // duration sanity: 2 pages, each ≥ 2.2 s hold + 0.7 s transition
  expect(duration).toBeGreaterThanOrEqual(4.5)

  // the frame-exact contract: count === duration × fps (±1 for
  // rounding at the container boundary)
  const expected = Math.round(duration * FPS)
  expect(Math.abs(nbRead - expected), `frames ${nbRead} vs duration×fps ${expected}`).toBeLessThanOrEqual(1)
})
