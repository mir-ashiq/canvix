import { NextRequest, NextResponse } from 'next/server'
import { withProvider, VISION_MODEL } from '@/lib/ai/provider'
import { validateAnalysis } from '@/lib/magic-layers/validate'

export const runtime = 'nodejs'
export const maxDuration = 60

interface MagicLayersBody {
  image?: string // dataURL (client pre-normalizes to ≤1280px JPEG/PNG)
}

/**
 * POST /api/ai/magic-layers — Magic Layers analysis.
 *
 * Server-side vision pass over a flat design image → structured, validated
 * region JSON that the client reconstructs into native editable Canvix
 * elements. The model never dictates element creation directly; its JSON is
 * schema-validated and clamped before it leaves this route.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as MagicLayersBody
  const image = (body.image ?? '').trim()

  if (!image || !/^data:image\/(png|jpeg|webp);base64,/.test(image)) {
    return NextResponse.json({ error: 'A valid PNG/JPEG/WebP image is required.' }, { status: 400 })
  }
  // payload cap — 8 MB of base64 ≈ a 6 MP normalized image (far above the 1280px client cap)
  if (image.length > 8 * 1024 * 1024) {
    return NextResponse.json({ error: 'Image too large — max ~6 MB after normalization.' }, { status: 413 })
  }

  return withProvider('magic-layers', req, { limit: 10, windowSec: 60 }, async (zai) => {
    const system =
      'You are a precise design-image analyzer for a graphic-design editor. You look at a FLAT (raster) design ' +
      'image and decompose it into an editable layer structure: background, text regions, photo regions, shapes ' +
      'and decorations. You are honest: when you are unsure about a region you lower its confidence instead of guessing.\n\n' +
      'Respond ONLY with a JSON object (no markdown) of this exact shape:\n' +
      '{"background": {"kind": "solid"|"gradient"|"photo", "from": "#RRGGBB", "to": "#RRGGBB", "angle": 0-360}, ' +
      '"regions": [ ... ], "notes": "short honest limitations you noticed"}\n\n' +
      'Each region object:\n' +
      '- Text: {"id":"t1","type":"text","bounds":{x,y,w,h},"text":"EXACT visible text","color":"#RRGGBB","fontClass":"sans|serif|script|mono","bold":bool,"italic":bool,"fontSize":0.05,"align":"left|center|right","z":0,"confidence":0.0-1.0}\n' +
      '- Photo/illustration area: {"id":"p1","type":"photo","bounds":{...},"subject":"short description","z":1,"confidence":...}\n' +
      '- Solid shape: {"id":"s1","type":"shape","bounds":{...},"color":"#RRGGBB","shape":"rect|rounded-rect|ellipse","z":0,"confidence":...}\n' +
      '- Decoration (blob/abstract/graphic): {"id":"d1","type":"decoration","bounds":{...},"color":"#RRGGBB","shape":"ellipse","z":0,"confidence":...}\n\n' +
      'RULES:\n' +
      '1. bounds are FRACTIONS of image width/height, all in 0..1. x,y = top-left.\n' +
      '2. fontSize is the cap height as a FRACTION of image height (a headline ≈ 0.08-0.15, body ≈ 0.03).\n' +
      '3. Copy text EXACTLY as visible, including case. Merge multi-line text of one block into one region with \\n.\n' +
      '4. z = layer order: 0 = bottom (background-adjacent). Text usually highest.\n' +
      '5. Only include regions you actually see. Do not invent or extrapolate missing text.\n' +
      '6. confidence: text-reading 0.9+ when crisp; lower for stylized/blurry text. Photo/shape bounds: 0.7+ when clear.\n' +
      '7. Prefer FEWER, well-placed regions over many overlapping ones. Max 30 regions.\n' +
      '8. background.from is the dominant colour (kind=solid); for gradient use from→to and angle in degrees (0 = →).\n' +
      '9. If the background is a photo/illustration, use kind=photo and still list visible foreground regions.\n' +
      '10. notes = one short sentence about what the reconstruction will approximate (e.g. "illustration left of title will become a cropped image region").'

    const completion = await zai.chat.completions.createVision({
      model: VISION_MODEL,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this flat design image and return the region JSON now.' },
            { type: 'image_url', image_url: { url: image } },
          ],
        },
      ],
      thinking: { type: 'disabled' },
    })

    const raw = completion.choices[0]?.message?.content ?? ''
    const analysis = validateAnalysis(raw)
    if (!analysis || (analysis.regions.length === 0 && analysis.background.kind === 'solid' && !analysis.notes)) {
      return NextResponse.json(
        { error: 'The image could not be decomposed into layers. Try a cleaner, higher-resolution design.' },
        { status: 422 }
      )
    }

    return NextResponse.json(analysis)
  })
}
