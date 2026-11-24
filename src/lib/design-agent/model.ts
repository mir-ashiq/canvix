// ─────────────────────────────────────────────────────────────
// DesignAgent · the model seam (Phase B, 24 Nov 2026).
//
// The autonomous design pipeline's ONLY model interfaces. Everything
// else is deterministic code (see tools.ts / pipeline.ts and
// research/AUTONOMOUS-AGENT-RESEARCH.md — the OpenAI Agents SDK
// "code orchestration" pattern: the model sits at decision seams,
// stages/order/termination are code, not model choice).
//
// Two seams:
//   plan     — brief (+ revision feedback) → DesignSpec JSON text
//   critique — rendered image → advisory issues JSON text (optional
//              capability; grounded visual review, fail-closed when
//              unavailable)
//
// Production (BYOK provider adapters) and the sandbox acceptance
// harness (z-ai CLI) both implement this interface; unit tests use a
// scripted model. The pipeline NEVER trusts the raw text — it parses
// and validates everything deterministically.
// ─────────────────────────────────────────────────────────────

import type { DesignBrief } from '@/lib/agent/brief'
import type { DesignSpec } from '@/lib/design-spec/types'

/** Feedback for one revision round (Reflexion-style: deterministic
 * evaluator output returned to the planner as an observation). */
export interface RevisionFeedback {
  round: number
  /** compile check failures — the hard reasons the spec failed */
  failures: string[]
  /** non-fatal notes (palette defaults, density, seed placement) */
  warnings: string[]
  /** the spec that was just tried, so the model revises rather than
   * restarts from zero */
  priorSpec: DesignSpec
}

export interface PlanRequest {
  brief: DesignBrief
  /** the toolbox catalog (tools.ts) — the model's capability surface */
  toolbox: string
  feedback?: RevisionFeedback
}

export interface CritiqueIssue {
  severity: 'P1' | 'P2' | 'P3'
  issue: string
  fix?: string
}

export interface CritiqueResult {
  summary: string
  issues: CritiqueIssue[]
  /** critiques are ADVISORY: they can trigger a revision round but
   * never override the deterministic compile checks */
  advisory: true
}

export interface CritiqueRequest {
  brief: DesignBrief
  /** how the adapter receives the render (a path, URL or data URL —
   * adapter-specific; the pipeline only passes it through) */
  image: string
}

export interface DesignAgentModel {
  /** plan a DesignSpec. Returns raw model text — the pipeline owns
   * parsing/validation. Receives revision feedback on later rounds. */
  plan(req: PlanRequest): Promise<string>
  /** grounded critique of the REAL render (optional capability). */
  critique?(req: CritiqueRequest): Promise<string>
}

/** Parse a critique reply into the advisory result. Tolerant of
 * markdown fences and prose around the JSON; a reply without usable
 * JSON is a null — the caller discloses that critique failed rather
 * than inventing issues (fail-closed, same contract as the shipped
 * agent's vision path). */
export function parseCritiqueResponse(raw: string): CritiqueResult | null {
  const cleaned = raw.replace(/```(?:json)?/gi, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  let obj: Record<string, unknown> | null = null
  try {
    obj = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const issuesRaw = Array.isArray(obj.issues) ? obj.issues : []
  const issues: CritiqueIssue[] = []
  for (const i of issuesRaw) {
    if (typeof i !== 'object' || i === null) continue
    const it = i as Record<string, unknown>
    const severity = it.severity === 'P1' || it.severity === 'P2' || it.severity === 'P3' ? it.severity : 'P3'
    const issue = typeof it.issue === 'string' ? it.issue : ''
    if (!issue) continue
    issues.push({ severity, issue, fix: typeof it.fix === 'string' ? it.fix : undefined })
  }
  return {
    summary: typeof obj.summary === 'string' ? obj.summary : '',
    issues,
    advisory: true,
  }
}
