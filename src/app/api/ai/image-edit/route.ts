import { NextRequest, NextResponse } from 'next/server'
import { withProvider } from '@/lib/ai/provider'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const maxDuration = 60

const SUPPORTED_SIZES = ['1024x1024', '1344x768', '768x1344', '1152x864', '864x1152', '1440x720', '720x1440'] as const
type ImgSize = (typeof SUPPORTED_SIZES)[number]

interface EditBody {
  image?: string        // dataURL or remote URL
  prompt?: string       // edit instruction
  mode?: 'edit' | 'bg-remove' | 'erase' | 'enhance' | 'upscale'
  eraseTarget?: string  // for mode=erase: what to remove
  naturalWidth?: number
  naturalHeight?: number
  /** v0.19 (Wave 4): the provider-side handle of a previously generated/
   *  edited image (ImageElement.aiEntId). VibesAI-class providers match
   *  edits by exact bytes OR this id — the id survives re-encoding, so
   *  AI-edit chains keep working after the canvas touches the src. */
  sourceEntId?: string
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
  // v0.22: the provider engine of the Upscale tool — an AI re-render that
  // restores detail at the provider's output size. The client then (or
  // instead) runs the deterministic Lanczos-3 pass to reach the exact
  // requested pixel size; see src/components/editor/ImageAI.tsx.
  upscale:
    'Re-render this exact image at a higher resolution. Keep the composition, subject, colors and ' +
    'framing pixel-faithful — this is an upscale, not a reinterpretation. Restore fine detail and crisp ' +
    'edges; do not add, remove or restyle anything. Output a PNG. No text or watermarks.',
}

/** POST /api/ai/image-edit — Canva-style AI image tools (BG remover, Magic eraser, enhance). */
async function __canvix_post(req: NextRequest) {
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

  return withProvider('image-edit', req, { limit: 5, windowSec: 60 }, async (ctx) => {
    // NOTE: the SDK's TS type declares `image`, but the backend API requires
    // `images: [{ url }]` (verified — API error 1210 "must provide images").
    // The SDK forwards the body verbatim, so we send the correct runtime shape.
    // v0.19 (Wave 4): source_image_ent_id rides the same verbatim body —
    // the durable edit handle for images this provider generated.
    const sourceEntId = typeof body.sourceEntId === 'string' ? body.sourceEntId.trim().slice(0, 64) : undefined
    try {
      const response = await ctx.zai.images.generations.edit({
        prompt,
        images: [{ url: image }],
        size,
        ...(sourceEntId ? { source_image_ent_id: sourceEntId } : {}),
      } as unknown as Parameters<typeof ctx.zai.images.generations.edit>[0])

      // v0.16.3 (A3): OpenAI-compatible providers return b64_json; the SDK
      // passes such items through untouched (it only converts url items).
      // v0.19 (Wave 4): forward the result's image_ent_id so the client can
      // refresh ImageElement.aiEntId — edit-of-edit chains stay robust.
      const item = response.data[0] as { base64?: string; b64_json?: string; image_ent_id?: string } | undefined
      const base64 = item?.base64 ?? item?.b64_json
      if (!base64) {
        return NextResponse.json({ error: 'The image service returned no image. Try again.' }, { status: 502 })
      }

      const [outW, outH] = size.split('x').map(Number)
      const entId = typeof item?.image_ent_id === 'string' ? item.image_ent_id.slice(0, 64) : undefined
      return NextResponse.json({
        dataUrl: `data:image/png;base64,${base64}`,
        width: outW,
        height: outH,
        ...(entId ? { entId } : {}),
      })
    } catch (err) {
      // v0.19 (Wave 4): VibesAI-class providers refuse to edit images they
      // did not generate (verified live: HTTP 422 source_image_not_editable
      // for arbitrary uploads AND for their own images after re-encoding).
      // Surface that as a structured, actionable 422 instead of the generic
      // 502 — the client points users at the local tools that DO work on
      // any image (BG remover, brush eraser, upscaler).
      const msg = err instanceof Error ? err.message : String(err)
      if (/source_image_not_editable|only edit images it generated/i.test(msg)) {
        return NextResponse.json(
          {
            error:
              'This AI provider can only edit images it generated itself. ' +
              'For uploads and stock photos use the local tools — BG Remover, Brush eraser, Upscale — or generate the image with AI first.',
            code: 'SOURCE_NOT_EDITABLE',
          },
          { status: 422 },
        )
      }
      throw err
    }
  })
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const POST = withLogging('POST /api/ai/image-edit', __canvix_post)
