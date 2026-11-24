import { NextRequest, NextResponse } from 'next/server'
import { withProvider, getClientForSlotForUser } from '@/lib/ai/provider'
import { withLogging } from '@/lib/observability'
import { getSessionUser } from '@/lib/auth/session'
import { runDesignAgent, type DesignRenderer } from '@/lib/design-agent/pipeline'
import { byokDesignAgentModel } from '@/lib/design-agent/byok-adapter'
import { exportPageToSVG } from '@/lib/svg-export'
import type { PageData } from '@/lib/types'
import type { DesignSpec } from '@/lib/design-spec/types'

// ─────────────────────────────────────────────────────────────
// POST /api/ai/design-agent — the autonomous design pipeline as a
// production route (v0.30, DesignAgent Phase B P0-B).
//
// One prompt in, one verified design out:
//   extract-brief → plan (BYOK text provider) → parse → brief-
//   conformance + compile+check → bounded self-correction →
//   visual verification (render → BYOK vision critique → guarded
//   correction → re-verify) → editable pages + run report.
//
// Security/lifecycle: everything rides withProvider — the admin
// kill switch (ai.features.designAgent), the same-origin abuse
// guard, per-feature rate limits, and BYOK resolution (the
// session user's own providers first, then the instance chain).
// Request abort cancels the pipeline through its signal seam.
//
// The renderer is the app's REAL vector export (exportPageToSVG)
// delivered as a data URL — providers that cannot ingest SVG
// images fail-closed: the pipeline reports 'visual verification
// unavailable' instead of pretending a review happened.
// ─────────────────────────────────────────────────────────────

export const runtime = 'nodejs'
export const maxDuration = 120

interface DesignAgentBody {
  prompt?: string
  /** opt out of the visual-verification stage (plan+check only) */
  visual?: boolean
  /** cap the revision rounds (1-3; default 3) */
  maxRevisions?: number
}

const svgRenderer: DesignRenderer = {
  render: async (pages: PageData[], spec: DesignSpec) => {
    try {
      const svg = exportPageToSVG(pages[0], spec.format.width, spec.format.height)
      if (!svg) return null
      const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf-8').toString('base64')}`
      return { image: dataUrl }
    } catch {
      return null
    }
  },
}

/** POST /api/ai/design-agent — one prompt → compiled, checked design. */
async function __canvix_post(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as DesignAgentBody
  const prompt = (body.prompt ?? '').trim().slice(0, 2000)
  if (!prompt) return NextResponse.json({ error: 'A prompt is required.' }, { status: 400 })

  const maxRevisions = Math.min(3, Math.max(1, Number(body.maxRevisions) || 3))

  return withProvider('design-agent', req, { limit: 6, windowSec: 60 }, async (ctx) => {
    // the vision seam is OPTIONAL: resolve it (user BYOK first), fall
    // back to none — the pipeline discloses 'unavailable' honestly
    let vision: Awaited<ReturnType<typeof getClientForSlotForUser>> = null
    if (body.visual !== false) {
      try {
        const user = await getSessionUser(req)
        vision = await getClientForSlotForUser('vision', user?.id ?? null)
      } catch {
        vision = null
      }
    }
    const model = byokDesignAgentModel(ctx, vision)

    const run = await runDesignAgent({
      prompt,
      model,
      renderer: body.visual === false ? undefined : svgRenderer,
      limits: { maxRevisions, maxVisualPasses: 1 },
      // a LIVE view of the request's abort state — the pipeline
      // re-reads it before every model call and stage
      signal: {
        get aborted() {
          return req.signal.aborted
        },
      },
    })

    const status = run.outcome === 'passed' ? 200 : run.outcome === 'aborted' ? 499 : 422
    return NextResponse.json(
      {
        outcome: run.outcome,
        pages: run.pages ?? [],
        checks: run.checks ?? null,
        briefConformance: run.briefConformance,
        warnings: run.warnings,
        report: run.report,
      },
      { status },
    )
  })
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const POST = withLogging('POST /api/ai/design-agent', __canvix_post)
