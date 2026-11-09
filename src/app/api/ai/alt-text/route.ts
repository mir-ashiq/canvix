import { NextRequest, NextResponse } from 'next/server'
import { withProvider, DEFAULT_VISION_MODEL } from '@/lib/ai/provider'
import { withLogging } from '@/lib/observability'

export const runtime = 'nodejs'
export const maxDuration = 60

interface AltTextBody {
  image?: string // dataURL or remote URL
}

/** Cap the alt text at the length screen readers usefully announce. */
export const ALT_TEXT_MAX = 200

/**
 * Normalize raw model output into one clean alt-text sentence.
 * Exported for unit tests — the route is a thin shell around it.
 */
export function normalizeAltText(raw: string): string {
  return raw
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^(alt text|description|image( of)?|photo( of)?|illustration( of)?)[:\s-]*/i, '')
    .trim()
    .slice(0, ALT_TEXT_MAX)
}

/**
 * POST /api/ai/alt-text — accessibility alt text for images (Wave 4).
 *
 * One vision-slot call describing the selected image; the result is a
 * SUGGESTION the user can edit before it is stored on the element
 * (ImageElement.alt — rides autosave/versions/collab, feeds screen
 * readers). Kill switch: altText.
 */
async function __canvix_post(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as AltTextBody
  const image = (body.image ?? '').trim()
  if (!image || !/^(data:image\/|https?:\/\/)/.test(image)) {
    return NextResponse.json({ error: 'A valid image is required.' }, { status: 400 })
  }
  if (image.length > 8 * 1024 * 1024) {
    return NextResponse.json({ error: 'Image too large — max ~6 MB.' }, { status: 413 })
  }

  return withProvider('alt-text', req, { limit: 20, windowSec: 60 }, async (ctx) => {
    const completion = await ctx.zai.chat.completions.createVision({
      model: ctx.model ?? DEFAULT_VISION_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You write alt text for images in a design tool, for screen-reader users. Reply with ONE plain sentence ' +
            `(max 25 words) describing what is IN the image — subjects, setting, action, text shown. ` +
            'No prefixes like "image of", no quotes, no commentary. If the image is purely decorative, reply exactly: decorative.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Write the alt text for this image now.' },
            { type: 'image_url', image_url: { url: image } },
          ],
        },
      ],
      thinking: { type: 'disabled' },
    })

    const raw = completion.choices[0]?.message?.content ?? ''
    const alt = normalizeAltText(raw)
    if (!alt) {
      return NextResponse.json({ error: 'The AI returned no description. Try again.' }, { status: 502 })
    }
    return NextResponse.json({ alt, decorative: alt.toLowerCase() === 'decorative' })
  })
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const POST = withLogging('POST /api/ai/alt-text', __canvix_post)
