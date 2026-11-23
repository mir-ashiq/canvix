import { NextRequest, NextResponse } from 'next/server'
import { getClientForSlot } from '@/lib/ai/provider'
import { withLogging } from '@/lib/observability'

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

const SYSTEM =
  'You are a meticulous design critic looking at a REAL screenshot of a graphic-design canvas. ' +
  'Report only what you can actually see in the image. Never invent or assume elements that are not visible; ' +
  'if something cannot be determined from the image, say "cannot determine". ' +
  'Reply ONLY with JSON: {"findings": [{"severity": "P0"|"P1"|"P2"|"P3", "issue": "what is wrong (concrete, visual)", "fix": "the specific change to make"}], "overall": "one sentence verdict"}\n' +
  'P0 = broken/unreadable/missing required content; P1 = major (weak hierarchy, poor contrast, crowding); P2 = minor (spacing, balance); P3 = polish.'

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

  const brief = body.brief ?? {}
  const requiredTexts = (brief.requiredTexts ?? []).map((t) => t.text).filter(Boolean)
  const requiredColors = (brief.requiredColors ?? []).map((c) => c.hex).filter(Boolean)

  const userText = [
    'Critique this canvas screenshot for design quality and brief compliance.',
    requiredTexts.length ? `Required exact texts (verify they appear VERBATIM and are readable): ${requiredTexts.map((t) => `"${t}"`).join(', ')}.` : '',
    requiredColors.length ? `Required colors (verify they are visibly used): ${requiredColors.join(', ')}.` : '',
    body.stateSummary ? `Structured element state for cross-checking (ground truth for ids/positions):\n${body.stateSummary.slice(0, 4000)}` : '',
    'Check: readability of every text at this scale, contrast of text on its background, alignment and spacing consistency, visual hierarchy (is the headline dominant?), accidental overlaps or clipped content, dead space, and overall professional impression.',
    'Reply with the JSON findings now.',
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const completion = await vision.zai.chat.completions.create({
      ...(vision.model ? { model: vision.model } : {}),
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'text', text: userText },
            { type: 'image_url', image_url: { url: image } },
          ] as unknown as string,
        },
      ],
      thinking: { type: 'disabled' },
    })
    const raw = String(completion.choices[0]?.message?.content ?? '')
    // robust parse — the model may fence or add prose
    const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start === -1 || end <= start) {
      return NextResponse.json({ error: 'The vision model returned no parseable critique.' }, { status: 502 })
    }
    let parsed: { findings?: unknown; overall?: unknown }
    try {
      parsed = JSON.parse(cleaned.slice(start, end + 1))
    } catch {
      return NextResponse.json({ error: 'The vision model returned malformed critique JSON.' }, { status: 502 })
    }
    const findings = (Array.isArray(parsed.findings) ? parsed.findings : [])
      .filter((f) => !!f && typeof f === 'object')
      .map((f) => {
        const fo = f as { severity?: unknown; issue?: unknown; fix?: unknown }
        const sev = ['P0', 'P1', 'P2', 'P3'].includes(String(fo.severity)) ? (String(fo.severity) as 'P0') : 'P2'
        return {
          severity: sev,
          issue: String(fo.issue ?? '').slice(0, 400) || 'unspecified issue',
          fix: fo.fix === undefined ? undefined : String(fo.fix).slice(0, 400),
        }
      })
      .slice(0, 12)
    return NextResponse.json({ available: true, findings, overall: String(parsed.overall ?? '').slice(0, 400) })
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 150) : 'vision call failed'
    return NextResponse.json({ error: `Visual critique failed: ${message}` }, { status: 502 })
  }
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests
export const POST = withLogging('POST /api/ai/agent/vision', __canvix_post)
