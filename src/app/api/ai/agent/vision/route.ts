import { NextRequest, NextResponse } from 'next/server'
import { getClientForSlot } from '@/lib/ai/provider'
import { withLogging } from '@/lib/observability'
import { critiqueWithVision } from '@/lib/agent/vision'

export const runtime = 'nodejs'
export const maxDuration = 120

// ─────────────────────────────────────────────────────────────
// POST /api/ai/agent/vision — Phase 7 visual critique.
//
// The agent panel captures the canvas with the SAME Konva pipeline
// exports use (captureStage), downscales it, and posts it here with
// the run's brief + the current structured state. This route sends
// ONE vision-slot call and returns grounded findings.
//
// Honesty contract (the anti-hallucination rules):
//  · No vision provider configured → 503 { available: false } and
//    the panel says "visual critique unavailable — geometry-only
//    verification". It NEVER pretends a text model looked at a
//    screenshot it never received.
//  · The prompt forbids inventing elements: findings must reference
//    what is visible or explicitly say "cannot determine".
// ─────────────────────────────────────────────────────────────

interface VisionBody {
  image?: string // dataURL (png/jpeg)
  brief?: { requiredTexts?: { text: string }[]; requiredColors?: { hex: string }[] }
  stateSummary?: string // the serialized structured state
}


async function __canvix_post(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as VisionBody
  const image = (body.image ?? '').trim()
  if (!image.startsWith('data:image/')) {
    return NextResponse.json({ error: 'image must be a data URL from the canvas capture.' }, { status: 400 })
  }
  if (image.length > 8 * 1024 * 1024) {
    return NextResponse.json({ error: 'Image too large (max ~8 MB).' }, { status: 413 })
  }

  // the vision slot is a SEPARATE capability — resolve it directly
  // (withProvider resolves the text slot). When unconfigured, answer
  // honestly instead of falling back to a text model.
  const vision = await getClientForSlot('vision')
  if (!vision) {
    return NextResponse.json(
      {
        available: false,
        error: 'Visual critique needs a vision model (admin AI & models page, vision slot). Geometry-only verification was used instead.',
      },
      { status: 503 },
    )
  }

  // v0.29.3: the critique engine lives in src/lib/agent/vision.ts and is
  // shared with the agent LOOP (pre-completion round) — one prompt, one
  // honesty contract, no drift between the two paths.
  try {
    const client = vision.zai as unknown as Parameters<typeof critiqueWithVision>[0]
    const result = await critiqueWithVision(client, image, {
      brief: body.brief ?? undefined,
      stateSummary: body.stateSummary,
      model: vision.model,
    })
    if (!result) {
      return NextResponse.json({ error: 'The vision model returned no parseable critique.' }, { status: 502 })
    }
    return NextResponse.json({ available: true, findings: result.findings.slice(0, 12), overall: result.note })
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 150) : 'vision call failed'
    return NextResponse.json({ error: `Visual critique failed: ${message}` }, { status: 502 })
  }
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests
export const POST = withLogging('POST /api/ai/agent/vision', __canvix_post)
