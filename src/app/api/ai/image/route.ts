import { NextRequest, NextResponse } from 'next/server'
import { withProvider } from '@/lib/ai/provider'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const maxDuration = 60

const SUPPORTED_SIZES = ['1024x1024', '1344x768', '768x1344', '1152x864', '864x1152', '1440x720', '720x1440'] as const
type ImgSize = (typeof SUPPORTED_SIZES)[number]

interface ImageBody {
  prompt?: string
  size?: string
}

/** POST /api/ai/image — AI image generation for the canvas. Returns a PNG dataURL. */
async function __canvix_post(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as ImageBody
  const prompt = (body.prompt ?? '').trim().slice(0, 600)
  const size = (SUPPORTED_SIZES as readonly string[]).includes(body.size ?? '')
    ? (body.size as ImgSize)
    : '1024x1024'

  if (!prompt) {
    return NextResponse.json({ error: 'A prompt is required.' }, { status: 400 })
  }

  return withProvider('image', req, { limit: 5, windowSec: 60 }, async (ctx) => {
    const response = await ctx.zai.images.generations.create({
      model: ctx.model,
      prompt,
      size,
    })

    const base64 = response.data[0]?.base64
    if (!base64) {
      return NextResponse.json({ error: 'The image service returned no image. Try again.' }, { status: 502 })
    }

    const [w, h] = size.split('x').map(Number)
    return NextResponse.json({ dataUrl: `data:image/png;base64,${base64}`, width: w, height: h })
  })
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const POST = withLogging('POST /api/ai/image', __canvix_post)
