import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/**
 * v0.15 (R5): GIF export — acceptance.
 *
 *   1. an animated design exports as a real looping GIF: structural
 *      parse (GIF89a, Logical Screen 480×320, 256-colour Global
 *      Color Table, NETSCAPE2.0 loop-forever, uniform centisecond
 *      delays, trailer at EOF) + ffprobe as the INDEPENDENT second
 *      opinion (codec, dimensions, frame count, duration — the
 *      same "verify with a real tool" discipline the WebM and PDF
 *      specs use).
 *   2. the PAGE RANGE acceptance: "Current page" exports ONE page's
 *      timeline — far fewer frames than the whole deck.
 *   3. the pre-flight cap: a 100-page deck at 15 fps exceeds the
 *      1800-frame cap and the dialog refuses BEFORE rendering, with
 *      the error visible and the download button disabled.
 *
 * Register budget: ZERO — anonymous designs, fresh contexts.
 */

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const FPS = 15
const DELAY_CS = 7 // 100/15 rounded — the honest centisecond delay

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
  const col = i % 4
  const row = Math.floor(i / 4)
  return {
    id: `R${page}-${i}`,
    type: 'rect',
    x: 40 + col * 250,
    y: 60 + row * 160,
    width: 200,
    height: 120,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    // spread hues so the median-cut palette has real work to do
    fill: `hsl(${(i * 47 + page * 180) % 360} 72% 55%)`,
    stroke: '',
    strokeWidth: 0,
    cornerRadius: 8,
    animation: { kind: i % 3 === 0 ? 'rise' : i % 3 === 1 ? 'pan' : 'fade', duration: 0.4, delay: (i % 4) * 0.05, easing: 'easeOut', direction: i % 2 === 0 ? 'up' : 'left' },
  }
}

async function createDesign(request: APIRequestContext, pageCount: number): Promise<string> {
  const pages = Array.from({ length: pageCount }, (_, p) => ({
    id: `p${p + 1}`,
    background: { type: 'solid' as const, color: '#ffffff' },
    transition: p > 0 ? { kind: 'fade' as const, duration: 0.7 } : undefined,
    elements: Array.from({ length: 8 }, (_, i) => animatedRect(i, p)),
  }))
  const res = await request.post(`${BASE}/api/designs`, {
    data: { name: `r5 gif acceptance ${pageCount}p`, width: 1080, height: 720, pages },
  })
  expect(res.status(), `create design: ${await res.text()}`).toBeLessThan(300)
  return ((await res.json()) as { id: string }).id
}

async function openEditor(page: Page, designId: string): Promise<void> {
  await page.goto(`/design/${designId}`)
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
  await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 60_000 })
}

/** structural GIF walk — the container assertions ffprobe cannot make
 *  (loop extension, per-frame delays, trailer-at-EOF) */
function parseGif(bytes: Buffer): {
  width: number
  height: number
  gctEntries: number
  loop: number | null
  delays: number[]
  frames: number
  trailerIsLastByte: boolean
} {
  expect(bytes.subarray(0, 6).toString('ascii')).toBe('GIF89a')
  const width = bytes[6] | (bytes[7] << 8)
  const height = bytes[8] | (bytes[9] << 8)
  const packed = bytes[10]
  expect(packed & 0x80, 'GCT flag').toBe(0x80)
  const gctEntries = 2 << (packed & 0x07)
  let pos = 13 + gctEntries * 3
  let loop: number | null = null
  const delays: number[] = []
  let frames = 0
  for (;;) {
    const b = bytes[pos]
    if (b === 0x3b) break
    if (b === 0x21) {
      const label = bytes[pos + 1]
      pos += 2
      if (label === 0xff) {
        expect(bytes.subarray(pos + 1, pos + 12).toString('ascii')).toBe('NETSCAPE2.0')
        loop = bytes[pos + 14] | (bytes[pos + 15] << 8)
        pos += 17
      } else if (label === 0xf9) {
        delays.push(bytes[pos + 2] | (bytes[pos + 3] << 8))
        pos += 6
      } else {
        while (bytes[pos] !== 0) pos += 1 + bytes[pos]
        pos += 1
      }
    } else if (b === 0x2c) {
      frames++
      pos += 10
      pos += 1 // min code size
      while (bytes[pos] !== 0) pos += 1 + bytes[pos] // LZW sub-blocks
      pos += 1
    } else {
      throw new Error(`unknown block 0x${b.toString(16)} at ${pos}`)
    }
  }
  return { width, height, gctEntries, loop, delays, frames, trailerIsLastByte: pos === bytes.length - 1 }
}

test('animated design exports as a looping GIF — structure + ffprobe agree', async ({ page, request }) => {
  test.setTimeout(240_000)

  const designId = await createDesign(request, 2)
  await openEditor(page, designId)

  await page.getByLabel('Download').click()
  const dlg = page.getByRole('dialog')
  await expect(dlg.getByText('Download your design')).toBeVisible()
  await dlg.getByRole('button', { name: /GIF Animated/ }).click()

  // the honest copy is visible BEFORE the export starts
  await expect(dlg.getByText(/looping forever/)).toBeVisible()
  await expect(dlg.getByText(/silent/)).toBeVisible()

  // Small (480 px cap) for a quick export
  await dlg.getByRole('button', { name: 'Small 480 px' }).click()

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 200_000 }),
    dlg.getByRole('button', { name: /^Download/ }).click(),
  ])
  const path = (await download.path())!
  expect(download.suggestedFilename()).toMatch(/\.gif$/)

  const bytes = readFileSync(path)
  expect(bytes.length, 'file size sanity').toBeGreaterThan(2_000)
  expect(bytes.length, 'byte cap').toBeLessThan(25 * 1024 * 1024)
  const gif = parseGif(bytes)

  // 1080×720 design at the 480 cap → 480×320
  expect(gif.width).toBe(480)
  expect(gif.height).toBe(320)
  expect(gif.gctEntries).toBe(256)
  expect(gif.loop, 'NETSCAPE loop count 0 = forever').toBe(0)
  expect(gif.trailerIsLastByte, 'nothing after the trailer').toBe(true)
  expect(gif.delays.length).toBe(gif.frames)
  expect(new Set(gif.delays)).toEqual(new Set([DELAY_CS]))

  // 2 pages, each ≥ 2.2 s hold + 0.7 s transition → ≥ 5.1 s → ≥ 76 frames
  expect(gif.frames, `frames: ${gif.frames}`).toBeGreaterThanOrEqual(70)
  expect(gif.frames).toBeLessThanOrEqual(140)

  // ── ffprobe: the independent second opinion ──
  const probe = JSON.parse(
    execFileSync('ffprobe', [
      '-v', 'error',
      '-count_frames',
      '-show_entries', 'stream=codec_name,width,height,nb_read_frames',
      '-show_entries', 'format=format_name,duration',
      '-of', 'json',
      path,
    ]).toString(),
  ) as {
    streams: { codec_name: string; width: number; height: number; nb_read_frames: string }[]
    format: { format_name: string; duration: string }
  }
  const stream = probe.streams[0]
  expect(stream.codec_name).toBe('gif')
  expect(stream.width).toBe(480)
  expect(stream.height).toBe(320)
  expect(probe.format.format_name).toBe('gif')
  expect(Number(stream.nb_read_frames)).toBe(gif.frames)
  // duration = frames × the honest 7 cs delay (± a rounding breath)
  expect(Math.abs(Number(probe.format.duration) - (gif.frames * DELAY_CS) / 100)).toBeLessThanOrEqual(0.15)
})

test('page range — "Current page" exports one page of the timeline', async ({ page, request }) => {
  test.setTimeout(240_000)

  const designId = await createDesign(request, 2)
  await openEditor(page, designId)

  await page.getByLabel('Download').click()
  const dlg = page.getByRole('dialog')
  await expect(dlg.getByText('Download your design')).toBeVisible()
  await dlg.getByRole('button', { name: /GIF Animated/ }).click()
  await dlg.getByRole('button', { name: 'Small 480 px' }).click()

  // ONE page instead of the whole deck
  await dlg.getByLabel('Current page').check()

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 200_000 }),
    dlg.getByRole('button', { name: /^Download/ }).click(),
  ])
  const path = (await download.path())!
  const gif = parseGif(readFileSync(path))

  // a single page ≈ one hold (2.2–3.5 s) → at most ~50 frames, far
  // fewer than the two-page deck's 70+
  expect(gif.frames, `frames: ${gif.frames}`).toBeLessThanOrEqual(52)
  expect(gif.frames).toBeGreaterThanOrEqual(30)
  expect(gif.loop).toBe(0)
})

test('pre-flight cap — a 100-page deck is refused before rendering', async ({ page, request }) => {
  test.setTimeout(120_000)

  const designId = await createDesign(request, 100)
  await openEditor(page, designId)

  await page.getByLabel('Download').click()
  const dlg = page.getByRole('dialog')
  await expect(dlg.getByText('Download your design')).toBeVisible()
  await dlg.getByRole('button', { name: /GIF Animated/ }).click()

  // the frame-cap error is actionable and visible BEFORE any export
  await expect(dlg.getByText(/cap is 1800/)).toBeVisible({ timeout: 30_000 })
  await expect(dlg.getByRole('button', { name: /^Download/ })).toBeDisabled()
})
