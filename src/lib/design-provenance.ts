// ─────────────────────────────────────────────────────────────
// Design provenance (v0.32 — Unified Canvix AI).
//
// The brief contract an autonomous generation was verified against,
// persisted ON the design it was applied to. When the user keeps
// refining that same design through the chat agent, the stored brief
// merges into every refinement run's contract (src/lib/agent/brief.ts
// mergeBriefs), so required texts and colors cannot silently vanish
// while the user keeps editing — the create→verify→refine loop the
// Unified Canvix AI milestone is accepted on.
//
// Server-only: this module touches the database. The brief itself is
// CLIENT-SAFE data (it is typed in src/lib/agent/brief.ts and rides
// the design context), but reads and writes go through the API.
// ─────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import { normalizeStoredBrief, type DesignBrief } from '@/lib/agent/brief'

/** What the design GET and the provenance GET return to the editor. */
export interface DesignProvenancePayload {
  prompt: string
  brief: DesignBrief
  outcome: string
  updatedAt?: string
}

const PROMPT_CAP = 2000

/** Persist (upsert) the provenance for a design. Best-effort shape:
 *  returns the stored payload, or null when nothing usable remained
 *  after normalization (the caller then treats the design as having
 *  no stored contract). */
export async function saveDesignProvenance(
  designId: string,
  input: { prompt?: string; brief?: unknown; outcome?: string },
): Promise<DesignProvenancePayload | null> {
  const brief = normalizeStoredBrief(input.brief)
  if (!brief) return null
  const prompt = (input.prompt ?? '').slice(0, PROMPT_CAP)
  const outcome = (input.outcome ?? 'passed').slice(0, 32)
  const row = await db.designProvenance.upsert({
    where: { designId },
    create: { designId, prompt, brief: brief as unknown as object, outcome },
    update: { prompt, brief: brief as unknown as object, outcome },
  })
  return { prompt, brief, outcome, updatedAt: row.updatedAt.toISOString() }
}

/** Read the provenance for a design (normalized; null when absent). */
export async function getDesignProvenance(designId: string): Promise<DesignProvenancePayload | null> {
  const row = await db.designProvenance.findUnique({ where: { designId } })
  if (!row) return null
  const brief = normalizeStoredBrief(row.brief)
  if (!brief) return null
  return {
    prompt: row.prompt,
    brief,
    outcome: row.outcome,
    updatedAt: row.updatedAt.toISOString(),
  }
}
