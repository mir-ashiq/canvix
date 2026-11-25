// ─────────────────────────────────────────────────────────────
// design-agent client (v0.31) — the panel's typed seam to
// POST /api/ai/design-agent.
//
// One call = one autonomous pipeline run (prompt → plan → compile +
// checks → bounded self-correction → optional visual verification).
// The response carries the compiled pages, the brief→spec
// conformance failures, and the full run report. Statuses:
//   200 passed · 422 failed-honestly (body still carries evidence)
//   499 aborted (client cancel) · 429 rate-limited · 503 disabled
//   or no provider · 403 cross-site
// Type-only imports from the pipeline — erased at compile time, so
// this module stays client-safe.
// ─────────────────────────────────────────────────────────────

import type { PageData } from '@/lib/types'
import type { AgentOutcome, AgentRunReport } from './pipeline'

export interface DesignAgentRunResult {
  outcome: AgentOutcome
  /** the last accepted compiled pages (present even on failure — evidence) */
  pages: PageData[]
  /** brief→spec conformance failures, human-readable, quoted */
  briefConformance: string[]
  warnings: string[]
  report: AgentRunReport | null
  /** spec format the pages were compiled for (from the run report) */
  format: { width: number; height: number } | null
  /** set when the route rejected the run before the pipeline started */
  error?: string
}

export interface DesignAgentRequestOptions {
  /** opt out of the server-side visual-verification stage */
  visual?: boolean
  /** revision rounds cap (1–3; default 3) */
  maxRevisions?: number
}

const STATUS_HINTS: Record<number, string> = {
  403: 'Cross-site request rejected.',
  429: 'Rate limited — wait a moment and try again.',
  503: 'The design agent is unavailable (disabled or no AI provider configured).',
}

/** Run the autonomous design pipeline. Throws on network/abort errors
 *  (AbortError propagates for cancellation); pipeline failures come
 *  back as a normal result (outcome 'failed-honestly' etc.). */
export async function requestDesignAgent(
  prompt: string,
  opts: DesignAgentRequestOptions = {},
  signal?: AbortSignal,
): Promise<DesignAgentRunResult> {
  const res = await fetch('/api/ai/design-agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ prompt, visual: opts.visual, maxRevisions: opts.maxRevisions }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    outcome?: AgentOutcome
    pages?: PageData[]
    briefConformance?: string[]
    warnings?: string[]
    report?: AgentRunReport | null
    error?: string
  }

  // pre-pipeline rejections (429/503/403…) carry only { error }
  if (!res.ok && !data.outcome) {
    return {
      outcome: 'failed-honestly',
      pages: [],
      briefConformance: [],
      warnings: [],
      report: null,
      format: null,
      error: data.error ?? STATUS_HINTS[res.status] ?? `The design agent failed (${res.status}).`,
    }
  }

  const format = data.report?.spec?.format
  return {
    outcome: data.outcome ?? 'failed-honestly',
    pages: Array.isArray(data.pages) ? data.pages : [],
    briefConformance: Array.isArray(data.briefConformance) ? data.briefConformance : [],
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
    report: data.report ?? null,
    format: format && Number.isFinite(format.width) && Number.isFinite(format.height)
      ? { width: format.width, height: format.height }
      : null,
    error: data.error,
  }
}

/** POST-apply visual critique: the browser-rendered capture (real
 *  pixels of the LIVE canvas — not the server's SVG approximation)
 *  critiqued by the vision slot against the brief. Honest: a 503
 *  (no vision model) returns findings: [] + the availability note. */
export async function critiqueAppliedCanvas(
  image: string,
  brief: { requiredTexts: { text: string }[]; requiredColors: { hex: string }[] },
): Promise<{ findings: { severity: string; issue: string; fix?: string }[]; note: string }> {
  const res = await fetch('/api/ai/agent/vision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image, brief }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    findings?: { severity: string; issue: string; fix?: string }[]
    error?: string
  }
  if (res.status === 503) {
    return {
      findings: [],
      note: 'Visual critique unavailable — no vision model configured. The deterministic checks stand.',
    }
  }
  if (!res.ok) {
    return { findings: [], note: data.error ?? 'Visual critique failed.' }
  }
  return { findings: data.findings ?? [], note: 'Critiqued the real rendered canvas (post-apply).' }
}
