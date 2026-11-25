import { NextRequest, NextResponse } from 'next/server'
import { resolveDesignAccess } from '@/lib/auth/design-guard'
import { withLogging } from '@/lib/observability'
import { getDesignProvenance } from '@/lib/design-provenance'

export const runtime = 'nodejs'

// ─────────────────────────────────────────────────────────────
// GET /api/designs/[id]/ai-provenance (v0.32 — Unified Canvix AI;
// hardened v0.32.1).
//
// The stored brief contract of the design: what an autonomous
// generation was verified against, plus the SERVER-SIDE verification
// state (re-checked on every design save). Read-only —
//
// v0.32.1 (review P0/P1): the PUT is GONE. Contracts enter the store
// only through the design save itself (PUT /api/designs/[id] with
// the apply flow's pending payload), where the brief is normalized
// in 'reject' mode and verified against the final saved pages — an
// authorized editor can no longer store an arbitrary brief or an
// unearned 'passed'. And the original generation prompt ships only
// to callers who may EDIT the design; link viewers get the
// shareable contract (brief, verified, verifiedAt), never the
// prompt. GET follows the designs family: link-view (200 with null
// when no provenance exists); a missing id is a flat 404.
// ─────────────────────────────────────────────────────────────

async function __canvix_get(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const access = await resolveDesignAccess(req, id)
    if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const provenance = await getDesignProvenance(id, { includePrompt: access.canEdit })
    return NextResponse.json({ provenance })
  } catch (error) {
    console.error('GET /api/designs/[id]/ai-provenance failed', error)
    return NextResponse.json({ error: 'Failed to get provenance' }, { status: 500 })
  }
}

// v0.12.5 (H7): opt-in request logging wrapper — passthrough
// unless CANVIX_LOG=requests (see src/lib/observability.ts)
export const GET = withLogging('GET /api/designs/[id]/ai-provenance', __canvix_get)
