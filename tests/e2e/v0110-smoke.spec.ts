import { test, expect, type APIRequestContext } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * v0.11.0 focused production smoke — the browser-only surface that the
 * API-level probe (scripts/smoke-v0110.ts) cannot see:
 *
 *   1. preview plays the uploaded audio + video (real preview pipeline:
 *      new Audio(src) / live <video> — playback observed, not assumed)
 *   2. video export muxes the page audio (MediaRecorder + AudioContext →
 *      ffprobe confirms an audio stream; volumedetect confirms non-silent)
 *   3. an edit made while offline survives the drop and syncs on reconnect
 *      (server-side event watcher + reload persistence)
 *
 * Run against the production standalone server:
 *   BASE_URL=http://127.0.0.1:3100 npx playwright test tests/e2e/v0110-smoke.spec.ts
 */

test.use({
  viewport: { width: 1600, height: 900 }, // the status chip is xl:and-up
  launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
})

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'

// ── probe payloads ───────────────────────────────────────────
/** mono 16-bit PCM WAV, 120 BPM click track (decodable everywhere) */
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

/** VP8+Vorbis WebM (open codecs — decodable in stock Chromium) via ffmpeg */
function makeWebm(): Buffer | null {
  const p = join(tmpdir(), 'canvix-smoke-e2e.webm')
  try {
    if (!existsSync(p)) {
      execFileSync(
        'ffmpeg',
        [
          '-y', '-loglevel', 'error',
          '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=15',
          '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
          '-c:v', 'libvpx', '-b:v', '200k', '-c:a', 'libvorbis', '-shortest', p,
        ],
        { timeout: 30_000 },
      )
    }
    return readFileSync(p)
  } catch {
    return null
  }
}

// ── setup: upload media + create the design (anonymous, link-editable) ──
interface Setup {
  designId: string
  wavId: string
  webmId: string | null
}

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

async function setup(request: APIRequestContext): Promise<Setup> {
  const wavId = (await uploadMedia(request, 'audio/wav', makeWav()))!
  const webmBuf = makeWebm()
  const webmId = webmBuf ? await uploadMedia(request, 'video/webm', webmBuf) : null
  const beats = Array.from({ length: 5 }, (_, i) => 0.1 + i * 0.5) // 120 BPM grid
  const res = await request.post(`${BASE}/api/designs`, {
    data: {
      name: 'v0110 browser smoke',
      width: 800,
      height: 600,
      pages: [
        {
          id: 'p1',
          background: { kind: 'solid', color: '#ffffff' },
          elements: [
            {
              id: 'AUD1', type: 'audio',
              x: 40, y: 40, width: 420, height: 96,
              rotation: 0, opacity: 1, locked: false, visible: true,
              shadow: { enabled: false, color: '#000000', blur: 12, offsetX: 0, offsetY: 6 },
              src: `/api/media/${wavId}`,
              name: 'probe-clicks.wav',
              duration: 2.5, volume: 0.9, loop: true, autoplay: true,
              peaks: [0.1, 0.9, 0.2, 0.7, 0.3], bpm: 120, beats,
            },
            ...(webmId
              ? [
                  {
                    id: 'VID1', type: 'video',
                    x: 40, y: 160, width: 320, height: 240,
                    rotation: 0, opacity: 1, locked: false, visible: true,
                    shadow: { enabled: false, color: '#000000', blur: 12, offsetX: 0, offsetY: 6 },
                    src: `/api/media/${webmId}`,
                    poster: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
                    duration: 2, volume: 0.7, muted: false, loop: true, autoplay: true,
                    trimStart: 0.1, trimEnd: 1.8,
                  },
                ]
              : []),
            {
              id: 'REC1', type: 'rect',
              x: 420, y: 160, width: 200, height: 140,
              rotation: 0, opacity: 1, locked: false, visible: true,
              shadow: { enabled: false, color: '#000000', blur: 12, offsetX: 0, offsetY: 6 },
              fill: '#02C0CC', stroke: '', strokeWidth: 0, cornerRadius: 0,
              beatPulse: 0.8,
            },
          ],
        },
      ],
    },
  })
  if (!res.ok()) throw new Error(`design create failed: ${res.status()}`)
  const { id } = (await res.json()) as { id: string }
  created.designs.push(id)
  writeFileSync(join(tmpdir(), 'canvix-v0110-e2e-probes.json'), JSON.stringify(created))
  return { designId: id, wavId, webmId }
}

/** watch the design's event log server-side until an op of `kind` lands */
function watchForEvent(designId: string, kind: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      ctrl.abort()
      reject(new Error(`no "${kind}" event within ${timeoutMs} ms`))
    }, timeoutMs)
    void fetch(`${BASE}/api/collab/${designId}/stream?since=0&pid=node-watcher`, {
      signal: ctrl.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`watcher stream ${res.status}`)
        const reader = res.body!.getReader()
        const dec = new TextDecoder()
        let buf = ''
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            buf += dec.decode(value, { stream: true })
            if (buf.includes(`"kind":"${kind}"`)) {
              clearTimeout(timer)
              ctrl.abort()
              resolve()
              return
            }
            if (buf.length > 1_000_000) buf = buf.slice(-100_000)
          }
        } catch {
          /* aborted — expected on resolve */
        }
        clearTimeout(timer)
        reject(new Error('watcher stream ended before the event'))
      })
      .catch((err) => {
        clearTimeout(timer)
        reject(err)
      })
  })
}

async function openEditor(page: import('@playwright/test').Page, designId: string) {
  await page.goto(`/?design=${designId}`)
  await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.konvajs-content').first()).toBeVisible({ timeout: 30_000 })
}

// ═══ 1. preview plays the uploaded audio + video ═════════════
test('preview plays the uploaded audio and video', async ({ page, request }) => {
  test.setTimeout(120_000)
  const { designId, webmId } = await setup(request)
  test.skip(!webmId, 'ffmpeg unavailable — video playback not probeable here')
  await openEditor(page, designId)

  // instrument HTMLMediaElement.play — the exact call preview makes for
  // both audio (new Audio(src)) and video (live <video> frames)
  await page.evaluate(() => {
    const w = window as unknown as { __media: HTMLMediaElement[] }
    w.__media = []
    const orig = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement, ...args: unknown[]) {
      w.__media.push(this)
      return (orig as (...a: unknown[]) => Promise<void>).apply(this, args)
    }
  })

  await page.getByLabel('Preview design').click()

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const m = (window as unknown as { __media?: HTMLMediaElement[] }).__media ?? []
          return m.filter((el) => el.tagName === 'AUDIO' && el.src.includes('/api/media/')).length
        }),
      { timeout: 20_000 },
    )
    .toBeGreaterThanOrEqual(1)
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const m = (window as unknown as { __media?: HTMLMediaElement[] }).__media ?? []
          return m.filter((el) => el.tagName === 'VIDEO' && el.src.includes('/api/media/')).length
        }),
      { timeout: 20_000 },
    )
    .toBeGreaterThanOrEqual(1)

  // genuinely playing: currentTime advances on BOTH the audio and the video
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const m = (window as unknown as { __media?: HTMLMediaElement[] }).__media ?? []
          return m.filter((el) => el.currentTime > 0.3 && !el.paused).length
        }),
      { timeout: 20_000 },
    )
    .toBeGreaterThanOrEqual(2)
})

// ═══ 2. video export muxes the page audio ════════════════════
test('video export contains a non-silent audio track', async ({ page, request }) => {
  test.setTimeout(180_000)
  const { designId } = await setup(request)
  await openEditor(page, designId)

  await page.getByLabel('Download').click()
  const dlg = page.getByRole('dialog')
  await expect(dlg.getByText('Download your design')).toBeVisible()
  await dlg.getByRole('button', { name: /Video/ }).click()

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120_000 }),
    dlg.getByRole('button', { name: /^Download/ }).click(),
  ])
  const path = (await download.path())!

  // ffprobe — the export must carry BOTH streams
  const probe = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', path]).toString(),
  ) as { streams: { codec_type: string; codec_name: string }[] }
  const types = probe.streams.map((s) => s.codec_type)
  expect(types, `streams: ${JSON.stringify(probe.streams)}`).toContain('video')
  expect(types, `streams: ${JSON.stringify(probe.streams)}`).toContain('audio')

  // volumedetect — the audio track must be non-silent (the WAV really played
  // through the AudioContext into the recorder)
  const vol = execFileSync('sh', ['-c', `ffmpeg -i "${path}" -af volumedetect -f null - 2>&1`]).toString()
  const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(vol)
  expect(m, `volumedetect output: ${vol.slice(-400)}`).not.toBeNull()
  expect(Number(m![1]), `mean_volume ${m![1]} dB — audio track is silent`).toBeGreaterThan(-55)
})

// ═══ 3. offline edit survives the drop and syncs on reconnect ═
test('an edit made offline syncs after the connection returns', async ({ page, request, context }) => {
  test.setTimeout(180_000)
  const { designId } = await setup(request)
  const sawAdd = watchForEvent(designId, 'element:add', 60_000)

  await openEditor(page, designId)
  await expect(page.locator('[title^="Live —"]')).toBeVisible({ timeout: 30_000 })

  // drop the network — the editor flags it honestly (browser offline event;
  // a silently-dead SSE socket alone never errors, v0.11.1 fix)
  await context.setOffline(true)
  await expect(page.locator('[title^="Offline —"]')).toBeVisible({ timeout: 20_000 })

  // edit while offline (the op queues durably instead of being lost)
  await page.getByRole('button', { name: 'Elements', exact: true }).first().click()
  await page.getByLabel('Add Square').click()
  await page.waitForTimeout(1_500)

  // connection returns — status returns to Live…
  await context.setOffline(false)
  await expect(page.locator('[title^="Live —"]')).toBeVisible({ timeout: 30_000 })
  // …and the queued element:add reached the server event log
  await sawAdd

  // reload — no lost work: the rectangle is in the document
  await page.reload()
  await expect(page.getByLabel('Design canvas')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Tools', exact: true }).first().click()
  await page.getByRole('button', { name: 'Layers', exact: true }).click()
  await expect(page.getByText('Rect', { exact: true }).first()).toBeVisible({ timeout: 20_000 })
})
