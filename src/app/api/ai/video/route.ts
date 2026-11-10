import { NextRequest, NextResponse } from 'next/server'
import { withProvider, resolveSlot, rateLimit, describeProviderError, recordUsage, type ResolvedSlot } from '@/lib/ai/provider'
import { aiFeatureEnabled } from '@/lib/admin/config'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const maxDuration = 60

interface VideoBody {
  prompt?: string
  size?: string
}

/** Sizes the vibes/Sora-style video APIs accept (landscape/portrait/square). */
const SUPPORTED_SIZES = ['1024x576', '576x1024', '768x768', '1280x720', '720x1280'] as const
type VideoSize = (typeof SUPPORTED_SIZES)[number]

/** provider video endpoint base — `${baseUrl}/videos/generations` */
function videoBase(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/videos/generations`
}

// ── v0.22: the second video dialect ─────────────────────────
// The z-ai internal API speaks a different (older, GLM/CogVideoX-
// shaped) contract than the emerging OpenAI Sora-style one:
//   POST `${baseUrl}/video/generation`        → { id, task_status }
//   GET  `${baseUrl}/async-result?id=…`       → { task_status, video_result: [{ url, cover_image_url }] }
// The finished MP4 sits at a plain CDN url inside video_result — no
// provider-auth content endpoint, so our same-origin proxy re-polls
// the async result and streams the CDN url (stateless: the task id is
// the only server-side memory, exactly like the Sora path).
//
// Dialect selection is TRIED AT CREATE TIME (Sora first — back-compat
// for deployed providers — then z-ai) and remembered statelessly by
// prefixing the returned task id with "z:": every later poll/content
// call routes on that prefix. No server memory, no sticky sessions.
const ZAI_PREFIX = 'z:'

function zaiCreateUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/video/generation`
}

function zaiPollUrl(baseUrl: string, id: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/async-result?id=${encodeURIComponent(id)}`
}

/** auth headers for a provider call (Bearer + the slot's companions). */
function providerHeaders(slot: ResolvedSlot, json = false): Record<string, string> {
  return {
    Authorization: `Bearer ${slot.apiKey}`,
    'X-Z-AI-From': 'Z',
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(slot.headers ?? {}),
  }
}

/** Normalized poll status the client polls expect. */
export interface VideoStatus {
  id: string
  status: 'queued' | 'in_progress' | 'completed' | 'failed'
  progress: number
  /** our own proxy URLs — same-origin, no CORS, no expiring CDNs */
  videos: { index: number; url: string }[]
  error?: string
}

/** Coerce a provider poll reply into VideoStatus (unit-tested shape).
 *  Understands BOTH dialects: the Sora-style body (status/progress/
 *  videos) and the z-ai async-result envelope (task_status/
 *  video_result[{url}]). */
export function normalizeVideoStatus(raw: unknown, id: string): VideoStatus {
  const body = (raw ?? {}) as Record<string, unknown>
  // z-ai dialect first: task_status + video_result
  if (typeof body.task_status === 'string' || Array.isArray(body.video_result)) {
    const task = String(body.task_status ?? 'PROCESSING').toUpperCase()
    const status: VideoStatus['status'] =
      task === 'SUCCESS' ? 'completed' : task === 'FAIL' || task === 'FAILED' ? 'failed' : task === 'QUEUED' ? 'queued' : 'in_progress'
    const resultRaw = Array.isArray(body.video_result) ? body.video_result : []
    const videos = resultRaw
      .slice(0, 4)
      .map((_, i) => ({ index: i, url: `/api/ai/video?id=${encodeURIComponent(id)}&content=1&index=${i}` }))
    const errObj = (body.error ?? body.msg) as unknown
    const error = typeof errObj === 'string' ? errObj.slice(0, 200) : undefined
    return {
      id,
      status,
      progress: status === 'completed' ? 100 : status === 'failed' ? 0 : 50,
      videos,
      ...(error ? { error } : {}),
    }
  }
  const statusRaw = typeof body.status === 'string' ? body.status : 'in_progress'
  const status: VideoStatus['status'] =
    statusRaw === 'completed' || statusRaw === 'failed' || statusRaw === 'queued' ? statusRaw : 'in_progress'
  const progress = Math.min(100, Math.max(0, Math.round(Number(body.progress) || 0)))
  const videosRaw = Array.isArray(body.videos) ? body.videos : []
  const videos = videosRaw
    .map((v, i) => {
      const item = (v ?? {}) as Record<string, unknown>
      const index = Math.round(Number(item.index))
      return { index: Number.isInteger(index) && index >= 0 ? index : i }
    })
    .slice(0, 4)
    .map(({ index }) => ({ index, url: `/api/ai/video?id=${encodeURIComponent(id)}&content=1&index=${index}` }))
  const error = typeof body.error === 'string' ? body.error.slice(0, 200) : undefined
  return { id, status, progress, videos, ...(error ? { error } : {}) }
}

/** v0.9.2-style abuse guard (GET paths bypass withProvider's POST check). */
function isFromApp(req: NextRequest): boolean {
  const origin = req.headers.get('origin') ?? req.headers.get('referer')
  if (!origin) return false
  try {
    const parsed = new URL(origin)
    const hosts = [req.headers.get('host'), req.headers.get('x-forwarded-host')?.split(',')[0]?.trim()].filter(
      (h): h is string => Boolean(h),
    )
    return hosts.includes(parsed.host)
  } catch {
    return false
  }
}

/**
 * POST /api/ai/video — start a text-to-video generation (Wave 4).
 * GET  /api/ai/video?id=… — poll status ({status, progress, videos[]}).
 * GET  /api/ai/video?id=…&content=1&index=N — proxy the finished MP4.
 *
 * The video slot speaks TWO upstream dialects (v0.22):
 *  1. the emerging OpenAI "Sora-style" async shape (POST
 *     /videos/generations → id; GET …/:id → status; GET …/:id/content
 *     → bytes) — the shape the VibesAI worker exposes; tried first so
 *     deployed providers keep working unchanged.
 *  2. the z-ai internal API (POST /video/generation; GET
 *     /async-result?id=… with X-Token companion headers; the MP4 at a
 *     plain CDN url inside video_result) — reached only when the Sora
 *     path 404s, and remembered statelessly by prefixing the task id
 *     with "z:" so polls and the content proxy route correctly.
 * Kill switch: videoGeneration.
 */
async function __canvix_post(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as VideoBody
  const prompt = (body.prompt ?? '').trim().slice(0, 1000)
  if (!prompt) {
    return NextResponse.json({ error: 'A prompt is required.' }, { status: 400 })
  }
  const size: VideoSize = (SUPPORTED_SIZES as readonly string[]).includes(body.size ?? '')
    ? (body.size as VideoSize)
    : '1024x576'

  return withProvider('video', req, { limit: 3, windowSec: 60 }, async () => {
    const slot = await resolveSlot('video')
    if (!slot) {
      // unreachable — withProvider already 503'd — but stay total
      return NextResponse.json({ error: 'No video provider configured.' }, { status: 503 })
    }

    // dialect 1 — Sora-style (the deployed shape): POST /videos/generations
    const sora = await fetch(videoBase(slot.baseUrl), {
      method: 'POST',
      headers: providerHeaders(slot, true),
      body: JSON.stringify({ prompt, size, ...(slot.model ? { model: slot.model } : {}) }),
    })
    const soraText = await sora.text()
    let soraParsed: Record<string, unknown> = {}
    try {
      soraParsed = JSON.parse(soraText) as Record<string, unknown>
    } catch {
      /* provider answered non-JSON */
    }
    if (sora.ok && typeof soraParsed.id === 'string' && soraParsed.id) {
      return NextResponse.json({ id: String(soraParsed.id).slice(0, 128), status: 'queued', progress: 0 })
    }

    // dialect 2 — the z-ai internal API: POST /video/generation → async task.
    // Only reached when the Sora path 404s (endpoint absent) — any other
    // Sora failure (quota, auth, validation) is a REAL error: fall through
    // to the honest 502 below with the Sora reason, not a dialect guess.
    if (sora.status === 404) {
      const zai = await fetch(zaiCreateUrl(slot.baseUrl), {
        method: 'POST',
        headers: providerHeaders(slot, true),
        body: JSON.stringify({ prompt, ...(slot.model ? { model: slot.model } : {}) }),
      })
      const zaiText = await zai.text()
      let zaiParsed: Record<string, unknown> = {}
      try {
        zaiParsed = JSON.parse(zaiText) as Record<string, unknown>
      } catch {
        /* non-JSON */
      }
      if (zai.ok && typeof zaiParsed.id === 'string' && zaiParsed.id) {
        // the "z:" prefix routes every later poll/content call to this dialect
        return NextResponse.json({ id: `${ZAI_PREFIX}${String(zaiParsed.id).slice(0, 128)}`, status: 'queued', progress: 0 })
      }
      const zaiInfo = describeProviderError(new Error(`API request failed with status ${zai.status}: ${zaiText.slice(0, 200)}`))
      return NextResponse.json(
        { error: 'The video service rejected the request.', ...(zaiInfo.message ? { detail: zaiInfo.message } : {}) },
        { status: 502 },
      )
    }

    const info = describeProviderError(new Error(`API request failed with status ${sora.status}: ${soraText.slice(0, 200)}`))
    return NextResponse.json(
      { error: 'The video service rejected the request.', ...(info.message ? { detail: info.message } : {}) },
      { status: 502 },
    )
  })
}

async function __canvix_get(req: NextRequest) {
  const url = new URL(req.url)
  const id = (url.searchParams.get('id') ?? '').trim().slice(0, 130)
  // strip the dialect prefix — "z:HEXID" routes to the z-ai endpoints
  const isZai = id.startsWith(ZAI_PREFIX)
  const taskId = isZai ? id.slice(ZAI_PREFIX.length) : id
  if (!taskId || !/^[A-Za-z0-9_-]+$/.test(taskId)) {
    return NextResponse.json({ error: 'A valid generation id is required.' }, { status: 400 })
  }
  if (!(await aiFeatureEnabled('videoGeneration'))) {
    return NextResponse.json({ error: 'This AI feature is disabled by the administrator.', code: 'FEATURE_DISABLED' }, { status: 503 })
  }
  if (!isFromApp(req)) {
    return NextResponse.json({ error: 'Same-origin only.' }, { status: 403 })
  }
  const rl = rateLimit('video-poll', req, 60, 60)
  if (!rl.ok) {
    return NextResponse.json({ error: `Too many requests — retry in ${rl.retryAfterSec}s.` }, { status: 429 })
  }
  const slot = await resolveSlot('video')
  if (!slot) {
    return NextResponse.json({ error: 'No video provider configured.' }, { status: 503 })
  }

  // ── z-ai dialect: one poll endpoint for both status and content ──
  if (isZai) {
    const r = await fetch(zaiPollUrl(slot.baseUrl, taskId), { headers: providerHeaders(slot) })
    const text = await r.text()
    let parsed: Record<string, unknown> = {}
    try {
      parsed = JSON.parse(text) as Record<string, unknown>
    } catch {
      /* non-JSON error body */
    }
    if (!r.ok) {
      const info = describeProviderError(new Error(`API request failed with status ${r.status}: ${text.slice(0, 200)}`))
      void recordUsage('video', slot.label ?? slot.source, false, { status: r.status, error: info.message })
      return NextResponse.json({ error: 'Polling failed.', ...(info.message ? { detail: info.message } : {}) }, { status: 502 })
    }
    // content proxy: re-poll, pick the CDN url, stream it through our origin
    if (url.searchParams.get('content') === '1') {
      const index = Math.max(0, Math.round(Number(url.searchParams.get('index')) || 0))
      const resultRaw = Array.isArray(parsed.video_result) ? parsed.video_result : []
      const item = (resultRaw[index] ?? resultRaw[0]) as { url?: string } | undefined
      if (!item?.url) {
        return NextResponse.json({ error: 'The video is not ready yet.' }, { status: 404 })
      }
      const upstream = await fetch(item.url)
      if (!upstream.ok || !upstream.body) {
        void recordUsage('video', slot.label ?? slot.source, false, { status: upstream.status })
        return NextResponse.json({ error: 'The video is not ready yet.' }, { status: 502 })
      }
      return new NextResponse(upstream.body, {
        headers: {
          'Content-Type': upstream.headers.get('content-type') ?? 'video/mp4',
          'Cache-Control': 'private, max-age=300',
          'Content-Disposition': `inline; filename="canvix-video-${taskId}-${index}.mp4"`,
        },
      })
    }
    // status poll — the "z:" prefix rides along so the client's next
    // poll (and the video element's src) keeps routing correctly
    const status = normalizeVideoStatus(parsed, id)
    void recordUsage('video', slot.label ?? slot.source, status.status === 'failed', {
      status: r.status,
      error: status.error,
    })
    return NextResponse.json(status)
  }

  // ── Sora dialect (unchanged) ──
  // content proxy: stream the provider's MP4 through our origin
  if (url.searchParams.get('content') === '1') {
    const index = Math.max(0, Math.round(Number(url.searchParams.get('index')) || 0))
    const upstream = await fetch(`${videoBase(slot.baseUrl)}/${taskId}/content?index=${index}`, {
      headers: providerHeaders(slot),
    })
    if (!upstream.ok || !upstream.body) {
      void recordUsage('video', slot.label ?? slot.source, false, { status: upstream.status })
      return NextResponse.json({ error: 'The video is not ready yet.' }, { status: upstream.status === 404 ? 404 : 502 })
    }
    return new NextResponse(upstream.body, {
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'video/mp4',
        'Cache-Control': 'private, max-age=300',
        'Content-Disposition': `inline; filename="canvix-video-${taskId}-${index}.mp4"`,
      },
    })
  }

  // status poll
  const r = await fetch(`${videoBase(slot.baseUrl)}/${taskId}`, {
    headers: providerHeaders(slot),
  })
  const text = await r.text()
  let parsed: unknown = {}
  try {
    parsed = JSON.parse(text)
  } catch {
    /* non-JSON error body */
  }
  if (!r.ok) {
    const info = describeProviderError(new Error(`API request failed with status ${r.status}: ${text.slice(0, 200)}`))
    void recordUsage('video', slot.label ?? slot.source, false, { status: r.status, error: info.message })
    return NextResponse.json({ error: 'Polling failed.', ...(info.message ? { detail: info.message } : {}) }, { status: 502 })
  }
  const status = normalizeVideoStatus(parsed, id)
  void recordUsage('video', slot.label ?? slot.source, status.status === 'failed', {
    status: r.status,
    error: status.error,
  })
  return NextResponse.json(status)
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const POST = withLogging('POST /api/ai/video', __canvix_post)
export const GET = withLogging('GET /api/ai/video', __canvix_get)
