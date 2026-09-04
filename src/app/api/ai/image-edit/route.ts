import { NextRequest, NextResponse } from 'next/server'
import { withProvider } from '@/lib/ai/provider'

export const runtime = 'nodejs'
export const maxDuration = 60

const SUPPORTED_SIZES = ['1024x1024', '1344x768', '768x1344', '1152x864', '864x1152', '1440x720', '720x1440'] as const
type ImgSize = (typeof SUPPORTED_SIZES)[number]

interface EditBody {
  image?: string        // dataURL or remote URL
  prompt?: string       // edit instruction
  mode?: 'edit' | 'bg-remove' | 'erase' | 'enhance'
  eraseTarget?: string  // for mode=erase: what to remove
  naturalWidth?: number
  naturalHeight?: number
}

/** Pick the SDK output size whose aspect ratio is closest to the source image. */
function bestSize(w: number, h: number): ImgSize {
  const ratio = w / h
  let best: ImgSize = '1024x1024'
  let bestDiff = Infinity
  for (const s of SUPPORTED_SIZES) {
    const [sw, sh] = s.split('x').map(Number)
    const diff = Math.abs(Math.log(sw / sh) - Math.log(ratio))
    if (diff < bestDiff) {
      bestDiff = diff
      best = s
    }
  }
  return best
}

const MODE_PROMPTS: Record<string, string> = {
  'bg-remove':
    'Remove the background completely and isolate the main subject. Keep the subject pixel-identical ' +
    'with full detail, lighting and edges. Make the entire background fully transparent (alpha 0). ' +
    'Output a PNG with transparency. Do not add any new background, shadow, border or watermark.',
  erase:
    'Remove the described object cleanly and reconstruct the background behind it so the area looks ' +
    'natural and continuous. Keep everything else pixel-identical. Output a PNG. No text or watermarks.',
  enhance:
    'Enhance this photo: increase sharpness and clarity, improve lighting and color balance, reduce noise. ' +
    'Keep the composition, subject and framing exactly the same. Natural, professional result.',
}

/** POST /api/ai/image-edit — Canva-style AI image tools (BG remover, Magic eraser, enhance). */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as EditBody
  const image = (body.image ?? '').trim()
  if (!image || !/^(data:image\/|https?:\/\/)/.test(image)) {
    return NextResponse.json({ error: 'A valid image is required.' }, { status: 400 })
  }

  const mode = body.mode ?? 'edit'
  let prompt: string
  if (mode === 'erase') {
    const target = (body.eraseTarget ?? body.prompt ?? '').trim().slice(0, 300)
    if (!target) return NextResponse.json({ error: 'Describe what to remove.' }, { status: 400 })
    prompt = `${MODE_PROMPTS.erase} Object to remove: ${target}`
  } else if (mode === 'edit') {
    prompt = (body.prompt ?? '').trim().slice(0, 600)
    if (!prompt) return NextResponse.json({ error: 'A prompt is required.' }, { status: 400 })
  } else {
    prompt = MODE_PROMPTS[mode]
  }

  const w = Number(body.naturalWidth) || 0
  const h = Number(body.naturalHeight) || 0
  const size: ImgSize = w && h ? bestSize(w, h) : '1024x1024'

  return withProvider('image-edit', req, { limit: 12, windowSec: 60 }, async (zai) => {
    // NOTE: the SDK's TS type declares `image`, but the backend API requires
    // `images: [{ url }]` (verified — API error 1210 "must provide images").
    // The SDK forwards the body verbatim, so we send the correct runtime shape.
    const response = await zai.images.generations.edit({
      prompt,
      images: [{ url: image }],
      size,
    } as unknown as Parameters<typeof zai.images.generations.edit>[0])

    const base64 = response.data[0]?.base64
    if (!base64) {
      return NextResponse.json({ error: 'The image service returned no image. Try again.' }, { status: 502 })
    }

    const [outW, outH] = size.split('x').map(Number)
    return NextResponse.json({ dataUrl: `data:image/png;base64,${base64}`, width: outW, height: outH })
  })
}
