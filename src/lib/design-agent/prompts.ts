// ─────────────────────────────────────────────────────────────
// DesignAgent · prompts (Phase B).
//
// The planner system prompt: the DesignSpec contract, the block
// vocabulary, the slot conventions for the dedicated builders, and
// the hard rules (verbatim copy, required hexes). Written for a
// JSON-returns model; the pipeline parses tolerantly but the prompt
// asks for clean JSON first.
// ─────────────────────────────────────────────────────────────

import type { DesignBrief } from '@/lib/agent/brief'
import type { RevisionFeedback } from './model'
import { toolboxPromptSection } from './tools'

export const PLANNER_SYSTEM = `You are the design planner of a deterministic design engine. You choose SEMANTICS only; geometry, color math, typography and quality checks are executed by the engine and cannot be negotiated.

Emit ONLY a JSON object (no prose, no markdown fences) shaped exactly:

{
  "version": "v2",
  "name": "short design name",
  "format": { "width": 1080, "height": 1350 },
  "palette": { "seeds": ["#RRGGBB"], "mood": "warm|cool|neutral|vibrant|minimal" },
  "typography": { "scale": 1.25 },
  "blocks": [
    { "kind": "hero", "weight": 3, "content": [
      { "role": "headline", "source": "user-required", "text": "..." },
      { "role": "subline", "source": "model", "text": "...", "maxWords": 12 },
      { "role": "cta", "source": "user-required", "text": "..." }
    ], "overlap": "none" }
  ]
}

RULES (violations fail deterministic checks and are sent back to you):
1. Every user-required text goes into a slot with source "user-required" and the EXACT text — character-for-character, no paraphrase, no case change, no truncation.
2. Every required hex goes into palette.seeds. Seeds are preserved and guaranteed to appear on the page.
3. Roles: headline, subline, tagline, body, cta, label. Blocks kinds: hero (headline/subline/cta stack), feature-cards (N short card texts), stat-row (alternating value/caption pairs — value as role "headline", caption as role "label"), mockup (one label/body slot = the frame caption; the engine draws the visual frame), timeline, gallery, footer (compiled via the generic stack today).
4. stat-row slot convention: content is value, caption, value, caption… Set count to the number of value/caption PAIRS.
5. Blocks stack top-to-bottom; weight is relative band height (hero usually 2-4, other blocks 1-2). One hero, at most one of each other kind per poster.
6. Model-authored copy (source "model") must carry maxWords (a soft budget the engine reports, never a cut).
7. Keep total slots modest (≤14): density is a warning, emptiness is not.

${toolboxPromptSection()}`

export function planUserPrompt(brief: DesignBrief): string {
  const lines: string[] = []
  lines.push(`Design brief (extracted deterministically from the user prompt):`)
  lines.push(`- design type: ${brief.designType ?? 'poster'}${brief.format ? ` (${brief.format})` : ''}`)
  if (brief.dimensions) lines.push(`- dimensions: ${brief.dimensions.width}x${brief.dimensions.height} px`)
  if (brief.requiredTexts.length) {
    lines.push(`- required verbatim texts (MUST appear character-for-character):`)
    for (const t of brief.requiredTexts) lines.push(`    "${t.text}"`)
  }
  if (brief.requiredColors.length) {
    lines.push(`- required hex colors (MUST appear on the page): ${brief.requiredColors.map((c) => c.hex).join(', ')}`)
  }
  if (brief.restrictions.length) lines.push(`- restrictions: ${brief.restrictions.join('; ')}`)
  if (brief.notes.length) lines.push(`- notes: ${brief.notes.join('; ')}`)
  lines.push(``, `Plan the DesignSpec JSON now.`)
  return lines.join('\n')
}

export function revisionUserPrompt(feedback: RevisionFeedback): string {
  const lines: string[] = []
  lines.push(`Your previous DesignSpec FAILED the deterministic checks. Revise it.`)
  lines.push(``)
  lines.push(`Failures (hard — every one must be fixed):`)
  for (const f of feedback.failures) lines.push(`  ✗ ${f}`)
  if (feedback.warnings.length) {
    lines.push(``, `Warnings (advisory, fix if reasonable):`)
    for (const w of feedback.warnings) lines.push(`  ⚠ ${w}`)
  }
  lines.push(``)
  lines.push(`Your previous spec (revise THIS — do not restart from zero):`)
  lines.push(JSON.stringify(feedback.priorSpec, null, 2))
  lines.push(``)
  lines.push(`Emit the FULL corrected DesignSpec JSON (same schema, no prose).`)
  return lines.join('\n')
}

export const CRITIQUE_SYSTEM = `You are an aesthetic reviewer looking at a REAL rendered design (not a plan). Score against a professional poster bar: layout balance and alignment, color hierarchy, typographic hierarchy, readable contrast, breathing room. Be strict — calibrated anchors: 4-5 means a professional human designer shipped it; 1-3 requires naming the concrete defect.

Emit ONLY JSON: { "summary": "one paragraph verdict", "issues": [ { "severity": "P1|P2|P3", "issue": "concrete defect", "fix": "actionable fix" } ] }
P1 = a defect a client would reject; P2 = clearly subprofessional; P3 = polish. No invented content — only what you can see.`

export function critiqueUserPrompt(brief: DesignBrief): string {
  const req = brief.requiredTexts.map((t) => `"${t.text}"`).join(', ')
  return `The brief required these verbatim texts (already machine-verified — do not re-check them): ${req || '(none)'}.
Review the RENDERED poster as an aesthetic expert: layout, color, typography, spacing, hierarchy. List concrete, visible defects only.`
}
