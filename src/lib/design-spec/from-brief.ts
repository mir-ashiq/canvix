// ─────────────────────────────────────────────────────────────
// DesignBrief → DesignSpec (Phase A).
//
// The deterministic half of the planner: the zero-model brief
// extractor (src/lib/agent/brief.ts) already pulls required texts,
// required hexes and dimensions out of the raw prompt; this mapper
// turns that brief into a DesignSpec with all brief content marked
// source 'user-required'. A live planner emits the same shape and
// adds model-written copy — the compile path is identical.
//
// Type-only dependency on the agent layer: no runtime import, the
// dependency direction stays design-spec ← agent.
// ─────────────────────────────────────────────────────────────

import type { DesignBrief } from '@/lib/agent/brief'
import type { ContentRole, ContentSlot, DesignSpec } from './types'

/** Order the three poster-style slots fill: headline → subline → cta.
 * Extra required texts become body slots (never dropped). */
const ROLE_ORDER: ContentRole[] = ['headline', 'subline', 'cta']

function roleForIndex(i: number, hinted?: string): ContentRole {
  if (hinted === 'heading') return 'headline'
  if (ROLE_ORDER[i]) return ROLE_ORDER[i]
  return 'body'
}

/**
 * Build a spec from an extracted brief. Mandatory items become
 * user-required slots and seed colors; preferences shape format and
 * mood. Deterministic and total — worst case (empty brief) it emits
 * a single hero block with one model slot so the pipeline always
 * has something to compile.
 */
export function specFromBrief(brief: DesignBrief): DesignSpec {
  const width = brief.dimensions?.width ?? 1080
  const height = brief.dimensions?.height ?? 1080

  const required = brief.requiredTexts.filter((t) => !t.tier || t.tier === 'mandatory')
  const seeds = brief.requiredColors
    .filter((c) => !c.tier || c.tier === 'mandatory')
    .map((c) => c.hex)
    .slice(0, 4)

  const notes = [...brief.restrictions, ...brief.notes].join(' ').toLowerCase()
  const mood: DesignSpec['palette']['mood'] = /warm|cozy|golden|coffee|sunset/.test(notes)
    ? 'warm'
    : /cool|calm|ocean|fresh|tech/.test(notes)
      ? 'cool'
      : /bold|vibrant|neon|party|loud/.test(notes)
        ? 'vibrant'
        : /minimal|clean|simple|elegant/.test(notes)
          ? 'minimal'
          : 'neutral'

  const content: ContentSlot[] = required.map((t, i) => ({
    role: roleForIndex(i, t.role),
    source: 'user-required',
    text: t.text,
  }))
  if (!content.length) {
    content.push({ role: 'headline', source: 'model', text: 'Your Headline Here', maxWords: 6 })
  }

  const blocks: DesignSpec['blocks'] = [{ kind: 'hero', weight: 1, content, overlap: 'none' }]

  // feature requests the brief can name become sibling blocks
  for (const feature of brief.requiredFeatures ?? []) {
    if (feature.kind === 'feature-cards') {
      blocks.push({
        kind: 'feature-cards',
        weight: 0.8,
        count: Math.min(6, Math.max(1, feature.count ?? 3)),
        content: content.length
          ? []
          : [{ role: 'label', source: 'model', text: 'Feature', maxWords: 3 }],
        overlap: 'over-backdrop',
      })
    }
  }

  return {
    version: 'v2',
    name: `${brief.designType ?? brief.format ?? 'design'} — ${brief.requiredTexts[0]?.text.slice(0, 30) ?? 'generated'}`.slice(0, 80),
    format: { width, height, ...(brief.format ? { preset: brief.format } : {}) },
    palette: { seeds, mood },
    typography: { scale: 1.333 },
    blocks: blocks.filter((b) => b.content.length > 0 || b.kind !== 'hero'),
  }
}
