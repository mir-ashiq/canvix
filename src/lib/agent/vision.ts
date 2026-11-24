// ─────────────────────────────────────────────────────────────
// Vision critique (v0.29.3) — the shared, grounded critique engine.
//
// One vision-slot model call with a REAL screenshot of the rendered
// canvas. Used in TWO places:
//   1. the agent loop, BEFORE completion is accepted (bounded
//      correction pass: capture → critique → fix → re-capture →
//      verify — the failed production runs critiqued AFTER claiming
//      success, so P0 findings could never influence the design);
//   2. the panel's post-run Findings display (Phase 7).
//
// Honesty contract (unchanged from the original route):
//   · No vision provider configured → null + note. The caller says
//     "visual critique unavailable" and NEVER pretends a text model
//     looked at a screenshot it never received.
//   · The prompt forbids inventing elements: findings must reference
//     what is visible or explicitly say "cannot determine".
// ─────────────────────────────────────────────────────────────

export interface VisionFinding {
  severity: 'P0' | 'P1' | 'P2' | 'P3'
  issue: string
  fix?: string
}

export interface VisionCritiqueResult {
  findings: VisionFinding[]
  note: string
}

export const VISION_CRITIQUE_SYSTEM =
  'You are a meticulous design critic looking at a REAL screenshot of a graphic-design canvas. ' +
  'Report only what you can actually see in the image. Never invent or assume elements that are not visible; ' +
  'if something cannot be determined from the image, say "cannot determine". ' +
  'Reply ONLY with JSON: {"findings": [{"severity": "P0"|"P1"|"P2"|"P3", "issue": "what is wrong (concrete, visual)", "fix": "the specific change to make"}], "overall": "one sentence verdict"}\n' +
  'P0 = broken/unreadable/missing required content; P1 = major (weak hierarchy, poor contrast, crowding); P2 = minor (spacing, balance); P3 = polish.'

/** The required-content preamble: tells the critic what the brief
 *  demands so missing strings/colors are P0 findings, not opinions. */
export function visionBriefPreamble(brief?: {
  requiredTexts?: { text: string }[]
  requiredColors?: { hex: string }[]
} | null): string {
  const parts: string[] = []
  if (brief?.requiredTexts?.length) {
    parts.push(`The design brief requires these EXACT text strings, verbatim: ${brief.requiredTexts.map((t) => `"${t.text}"`).join(', ')}. A required string that is cut off, hidden, overlapping, or absent is a P0.`)
  }
  if (brief?.requiredColors?.length) {
    parts.push(`The brief requires these colors to be visibly used: ${brief.requiredColors.map((c) => c.hex).join(', ')}.`)
  }
  return parts.length ? `REQUIRED CONTENT (check each one against the image):\n${parts.join('\n')}\n\n` : ''
}

/** Run the critique with a resolved vision client. Returns null when
 *  the provider call fails; the CALLER decides what honesty demands. */
export async function critiqueWithVision(
  vision: { chat: { completions: { create: (body: Record<string, unknown>) => Promise<{ choices?: { message?: { content?: unknown } }[] }> } } },
  image: string,
  opts: {
    brief?: { requiredTexts?: { text: string }[]; requiredColors?: { hex: string }[] } | null
    stateSummary?: string
    model?: string
  } = {},
): Promise<VisionCritiqueResult | null> {
  const preamble = visionBriefPreamble(opts.brief)
  const state = opts.stateSummary ? `\n\nSTRUCTURED CANVAS STATE (geometry, may differ from what actually rendered — trust the IMAGE when they conflict):\n${opts.stateSummary.slice(0, 6000)}` : ''
  const content = [
    { type: 'text', text: `${preamble}Critique the rendered design in this screenshot. Findings must be concrete and visual (what you see, where). Check: every required string fully readable and unobscured; clipping (text cut off at box edges); elements overlapping text; contrast; spacing/hierarchy; dead space; overall balance.${state}` },
    { type: 'image_url', image_url: { url: image } },
  ]
  try {
    const completion = await vision.chat.completions.create({
      ...(opts.model ? { model: opts.model } : {}),
      messages: [{ role: 'user', content }],
    })
    const raw = String(completion.choices?.[0]?.message?.content ?? '')
    const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start === -1 || end <= start) return null
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as { findings?: VisionFinding[]; overall?: string }
    const findings = (parsed.findings ?? [])
      .filter((f) => f && typeof f.issue === 'string' && ['P0', 'P1', 'P2', 'P3'].includes(f.severity))
      .map((f) => ({ severity: f.severity, issue: f.issue.slice(0, 500), fix: typeof f.fix === 'string' ? f.fix.slice(0, 400) : undefined }))
    return {
      findings,
      note: parsed.overall ? parsed.overall.slice(0, 300) : 'Visual critique completed against the rendered canvas.',
    }
  } catch {
    return null
  }
}
