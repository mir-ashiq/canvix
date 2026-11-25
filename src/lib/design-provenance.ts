// ─────────────────────────────────────────────────────────────
// Design provenance (v0.32 — Unified Canvix AI; hardened v0.32.1).
//
// The brief contract an autonomous generation was verified against,
// persisted ON the design it was applied to. When the user keeps
// refining that same design through the chat agent, the stored brief
// merges into every refinement run's contract (src/lib/agent/brief.ts
// mergeBriefs), so required texts and colors cannot silently vanish
// while the user keeps editing — the create→verify→refine loop the
// Unified Canvix AI milestone is accepted on.
//
// v0.32.1 hardening (external review, 25 Nov 2026):
//   · VERIFICATION, not claims — persistence rides the design save
//     itself: the brief is validated SERVER-SIDE against the final
//     saved pages and the row carries `verified`/`verifiedAt`
//     (re-checked on every later save, so it stays bound to the
//     current document state). The client-side PUT that accepted
//     arbitrary briefs/outcomes is GONE.
//   · PRIVACY — the original generation prompt never leaves this
//     module for viewers: getDesignProvenance includes it only for
//     editors/owners (link viewers can already see the design; the
//     prompt can hold information that is not in the design).
//   · NO SILENT WEAKENING — the save path normalizes in 'reject'
//     mode: an over-limit brief is refused (reported to the caller),
//     never stored truncated or capped.
//
// Server-only: this module touches the database. The brief itself is
// CLIENT-SAFE data (typed in src/lib/agent/brief.ts), but reads and
// writes go through the API.
// ─────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import { normalizeStoredBrief, validateBrief, type BriefValidationResult, type DesignBrief } from '@/lib/agent/brief'
import type { PageData, AnyElement, TextElement } from '@/lib/types'

/** What the design GET and the provenance GET return.
 *  `prompt` is present ONLY when the caller may edit the design —
 *  the original AI prompt is private to editors/owners. */
export interface DesignProvenancePayload {
  prompt?: string
  brief: DesignBrief
  outcome: string
  /** server-side verdict: does the SAVED document satisfy the stored
   *  brief? Re-checked on every design save — proof, not a claim. */
  verified: boolean
  verifiedAt?: string
  updatedAt?: string
}

/** Result of the save path — 'rejected' is explicit, never silent. */
export type SaveProvenanceResult =
  | { status: 'stored'; payload: DesignProvenancePayload }
  | { status: 'rejected'; reason: string }

const PROMPT_CAP = 2000
const OUTCOME_CAP = 32

/**
 * Pages → the validation state shape, server-side twin of the panel's
 * computeBriefValidation. Flattens groups, collects every text value,
 * every color (fills, strokes, solid backgrounds) and the element
 * shapes the composite-feature validator needs — across ALL pages
 * (the server answers "does the saved DOCUMENT satisfy the contract";
 * the agent's client gate answers "does the current PAGE").
 */
export function briefStateFromPages(pages: PageData[], width: number, height: number): Parameters<typeof validateBrief>[1] {
  const texts: string[] = []
  const colors: string[] = []
  const elements: { type: string; x?: number; y?: number; width?: number; height?: number; fill?: string; stroke?: string; text?: string }[] = []
  const pushColor = (c: unknown) => {
    if (typeof c === 'string' && c.trim()) colors.push(c)
  }
  const walk = (els: AnyElement[]) => {
    for (const el of els) {
      const base: { type: string; x?: number; y?: number; width?: number; height?: number; fill?: string; stroke?: string; text?: string } = {
        type: el.type,
        x: Math.round(el.x),
        y: Math.round(el.y),
        width: Math.round(el.width),
        height: Math.round(el.height),
      }
      if ('fill' in el) {
        pushColor((el as { fill?: unknown }).fill)
        if (typeof (el as { fill?: unknown }).fill === 'string') base.fill = (el as { fill: string }).fill
      }
      if ('stroke' in el) {
        pushColor((el as { stroke?: unknown }).stroke)
        if (typeof (el as { stroke?: unknown }).stroke === 'string') base.stroke = (el as { stroke: string }).stroke
      }
      if (el.type === 'text') {
        const t = el as TextElement
        texts.push(t.text)
        base.text = t.text
        if (typeof t.fill === 'string') pushColor(t.fill)
      }
      elements.push(base)
      if (el.type === 'group') walk(el.children)
    }
  }
  for (const page of pages) {
    walk(page.elements ?? [])
    if (page.background?.type === 'solid') pushColor(page.background.color)
  }
  return { texts, colors, width, height, elements }
}

/** Validate a brief against a saved document. Pure. */
export function verifyBriefAgainstPages(
  brief: DesignBrief,
  pages: PageData[],
  width: number,
  height: number,
): BriefValidationResult {
  return validateBrief(brief, briefStateFromPages(pages, width, height))
}

/**
 * Persist (upsert) the provenance for a design, WITH the server-side
 * verdict computed against the final saved pages. 'reject' mode
 * normalization: an over-limit or empty brief is REFUSED (with the
 * reason) instead of stored in weakened form — the caller surfaces
 * that, the contract never silently shrinks.
 */
export async function saveDesignProvenance(
  designId: string,
  input: { prompt?: string; brief?: unknown; outcome?: string },
  doc: { pages: PageData[]; width: number; height: number },
): Promise<SaveProvenanceResult> {
  const normalized = normalizeStoredBrief(input.brief, { overflow: 'reject' })
  if (!normalized) {
    return {
      status: 'rejected',
      reason: 'The provenance brief carried no usable requirements (texts, colors or features) or exceeded the safe limits — nothing was weakened to make it fit.',
    }
  }
  const brief = normalized.brief
  const verdict = verifyBriefAgainstPages(brief, doc.pages, doc.width, doc.height)
  const verified = verdict.satisfied
  const prompt = (input.prompt ?? '').slice(0, PROMPT_CAP)
  const outcome = (input.outcome ?? 'passed').slice(0, OUTCOME_CAP)
  const verifiedAt = verified ? new Date() : null
  const row = await db.designProvenance.upsert({
    where: { designId },
    create: { designId, prompt, brief: brief as unknown as object, outcome, verified, verifiedAt },
    update: { prompt, brief: brief as unknown as object, outcome, verified, verifiedAt },
  })
  return {
    status: 'stored',
    payload: {
      prompt,
      brief,
      outcome,
      verified,
      ...(verifiedAt ? { verifiedAt: verifiedAt.toISOString() } : {}),
      updatedAt: row.updatedAt.toISOString(),
    },
  }
}

/**
 * The plain-save hook: re-validate the stored brief against the
 * CURRENTLY saved pages and keep the row's verdict true to the
 * document (flips verified both ways as edits drift or restore).
 * Cheap: one indexed read + one pure validation, a write only when
 * the verdict changed. Returns the payload (or null when the design
 * has no provenance).
 */
export async function revalidateDesignProvenance(
  designId: string,
  doc: { pages: PageData[]; width: number; height: number },
): Promise<DesignProvenancePayload | null> {
  const row = await db.designProvenance.findUnique({ where: { designId } })
  if (!row) return null
  const normalized = normalizeStoredBrief(row.brief)
  if (!normalized) return null
  const verdict = verifyBriefAgainstPages(normalized.brief, doc.pages, doc.width, doc.height)
  const verified = verdict.satisfied
  if (verified !== row.verified) {
    await db.designProvenance.update({
      where: { designId },
      data: { verified, verifiedAt: verified ? new Date() : null },
    })
  }
  return {
    brief: normalized.brief,
    outcome: row.outcome,
    verified,
    ...(verified ? { verifiedAt: (row.verifiedAt ?? new Date()).toISOString() } : {}),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Read the provenance for a design (normalized; null when absent).
 *  The prompt is included ONLY for editors/owners — pass
 *  includePrompt: false for viewer-facing reads (design GET for a
 *  foreign viewer, the agent route's contract read). */
export async function getDesignProvenance(
  designId: string,
  opts: { includePrompt?: boolean } = {},
): Promise<DesignProvenancePayload | null> {
  const row = await db.designProvenance.findUnique({ where: { designId } })
  if (!row) return null
  const normalized = normalizeStoredBrief(row.brief)
  if (!normalized) return null
  return {
    ...(opts.includePrompt === true ? { prompt: row.prompt } : {}),
    brief: normalized.brief,
    outcome: row.outcome,
    verified: row.verified,
    ...(row.verified && row.verifiedAt ? { verifiedAt: row.verifiedAt.toISOString() } : {}),
    updatedAt: row.updatedAt.toISOString(),
  }
}
