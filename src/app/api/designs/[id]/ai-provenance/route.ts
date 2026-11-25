import { NextRequest, NextResponse } from 'next/server'
import { resolveDesignAccess, NOT_YOUR_DESIGN } from '@/lib/auth/design-guard'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { withLogging } from '@/lib/observability'
import { saveDesignProvenance, getDesignProvenance } from '@/lib/design-provenance'

export const runtime = 'nodejs'

// ─────────────────────────────────────────────────────────────
// /api/designs/[id]/ai-provenance (v0.32 — Unified Canvix AI).
//
// The stored brief contract of the design: what an autonomous
// generation was verified against, so later natural-language
// refinement of the SAME design stays gated on it.
//
//   GET → { prompt, brief, outcome, updatedAt? } | { brief: null }
//   PUT { prompt?, brief, outcome? } → the stored payload (upsert)
//
// Deliberately separate from PUT /api/designs/[id] (the autosave
// path — provenance changes once, at DesignAgent Apply, and must
// never ride the 300/min save budget). Access mirrors the design
// routes: GET is link-open (viewing), PUT needs edit rights
// (owner/anon attribution; 404 absent, 403 foreign-owned).
// The brief is normalized server-side (src/lib/design-provenance.ts)
// — dimensions dropped (the design's own canvas is the truth after
// apply), tiers forced mandatory, everything capped.
// ─────────────────────────────────────────────────────────────

async function __canvix_get(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const access = await resolveDesignAccess(req, id)
    if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const provenance = await getDesignProvenance(id)
    return NextResponse.json({ provenance })
  } catch (error) {
    console.error('GET /api/designs/[id]/ai-provenance failed', error)
    return NextResponse.json({ error: 'Failed to get provenance' }, { status: 500 })
  }
}

async function __canvix_put(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  // once per applied generation — its own small budget, not the
  // autosave's (a runaway client cannot hammer this path)
  const limit = checkRateLimit(req, 'designs:update')
  if (!limit.ok) return rateLimitResponse(limit)
  try {
    const { id } = await params
    const access = await resolveDesignAccess(req, id)
    if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!access.canEdit) return NextResponse.json(NOT_YOUR_DESIGN, { status: 403 })

    const body = (await req.json().catch(() => ({}))) as { prompt?: unknown; brief?: unknown; outcome?: unknown }
    const stored = await saveDesignProvenance(id, {
      prompt: typeof body.prompt === 'string' ? body.prompt : '',
      brief: body.brief,
      outcome: typeof body.outcome === 'string' ? body.outcome : undefined,
    })
    if (!stored) {
      return NextResponse.json(
        { error: 'The provenance brief carried no usable requirements (texts, colors or features).' },
        { status: 422 },
      )
    }
    return NextResponse.json({ provenance: stored })
  } catch (error) {
    console.error('PUT /api/designs/[id]/ai-provenance failed', error)
    return NextResponse.json({ error: 'Failed to save provenance' }, { status: 500 })
  }
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const GET = withLogging('GET /api/designs/[id]/ai-provenance', __canvix_get)
export const PUT = withLogging('PUT /api/designs/[id]/ai-provenance', __canvix_put)
