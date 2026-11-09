import { NextRequest, NextResponse } from 'next/server'
import { withProvider, resolveSlot, rateLimit, describeProviderError, recordUsage } from '@/lib/ai/provider'
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

/** Normalized poll status the client polls expect. */
export interface VideoStatus {
  id: string
  status: 'queued' | 'in_progress' | 'completed' | 'failed'
  progress: number
  /** our own proxy URLs — same-origin, no CORS, no expiring CDNs */
  videos: { index: number; url: string }[]
  error?: string
}

/** Coerce a provider poll reply into VideoStatus (unit-tested shape). */
export function normalizeVideoStatus(raw: unknown, id: string): VideoStatus {
  const body = (raw ?? {}) as Record<string, unknown>
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
 * The video slot speaks the emerging OpenAI "Sora-style" async shape
 * (POST /videos/generations → id; GET …/:id → status; GET …/:id/content
 * → bytes) — the shape the VibesAI worker exposes. The SDK has no video
 * API, so this route talks to the resolved slot directly. Kill switch:
 * videoGeneration.
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
    const r = await fetch(videoBase(slot.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${slot.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt, size, ...(slot.model ? { model: slot.model } : {}) }),
    })
    const text = await r.text()
    let parsed: Record<string, unknown> = {}
    try {
      parsed = JSON.parse(text) as Record<string, unknown>
    } catch {
      /* provider answered non-JSON */
    }
    if (!r.ok || typeof parsed.id !== 'string' || !parsed.id) {
      const info = describeProviderError(new Error(`API request failed with status ${r.status}: ${text.slice(0, 200)}`))
      return NextResponse.json(
        { error: 'The video service rejected the request.', ...(info.message ? { detail: info.message } : {}) },
        { status: 502 },
      )
    }
    return NextResponse.json({ id: String(parsed.id).slice(0, 128), status: 'queued', progress: 0 })
  })
}

async function __canvix_get(req: NextRequest) {
  const url = new URL(req.url)
  const id = (url.searchParams.get('id') ?? '').trim().slice(0, 128)
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
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

  // content proxy: stream the provider's MP4 through our origin
  if (url.searchParams.get('content') === '1') {
    const index = Math.max(0, Math.round(Number(url.searchParams.get('index')) || 0))
    const upstream = await fetch(`${videoBase(slot.baseUrl)}/${id}/content?index=${index}`, {
      headers: { Authorization: `Bearer ${slot.apiKey}` },
    })
    if (!upstream.ok || !upstream.body) {
      void recordUsage('video', slot.label ?? slot.source, false, { status: upstream.status })
      return NextResponse.json({ error: 'The video is not ready yet.' }, { status: upstream.status === 404 ? 404 : 502 })
    }
    return new NextResponse(upstream.body, {
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'video/mp4',
        'Cache-Control': 'private, max-age=300',
        'Content-Disposition': `inline; filename="canvix-video-${id}-${index}.mp4"`,
      },
    })
  }

  // status poll
  const r = await fetch(`${videoBase(slot.baseUrl)}/${id}`, {
    headers: { Authorization: `Bearer ${slot.apiKey}` },
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
