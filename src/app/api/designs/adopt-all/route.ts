import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth/session'
import { anonHashFrom } from '@/lib/auth/anon'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'

// POST /api/designs/adopt-all — one-click migration into an account.
//
// v0.9.1 SAFETY: by default claims ONLY the ownerless designs attributed
// to the caller's own browser (Design.anonKey = sha256 of the canvix_anon
// cookie). Another person's anonymous work is never touched.
//
// `{ includeLegacy: true }` additionally claims legacy rows (anonKey null,
// created before attribution existed) — the deliberate, confirmed path for
// self-hosters migrating a pre-accounts library. Even then, designs
// attributed to OTHER browsers remain untouchable.
//
// Idempotent; already-owned designs are excluded by the query itself.
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  const user = await getSessionUser(req)
  if (!user) {
    return NextResponse.json(
      { error: 'Sign in first — adopting designs moves them into your account.' },
      { status: 401 }
    )
  }
  try {
    const body = await req.json().catch(() => ({}))
    const includeLegacy = body?.includeLegacy === true
    const anonHash = anonHashFrom(req)

    if (!anonHash && !includeLegacy) {
      // No attribution cookie and no explicit legacy opt-in → claim nothing.
      return NextResponse.json({ ok: true, adopted: 0 })
    }

    // mine (browser-attributed) always; legacy only with the explicit opt-in;
    // foreign attributions NEVER.
    const where = {
      ownerId: null,
      OR: [
        ...(anonHash ? [{ anonKey: anonHash }] : []),
        ...(includeLegacy ? [{ anonKey: null }] : []),
      ],
    }
    const result = await db.design.updateMany({
      where,
      data: { ownerId: user.id },
    })
    return NextResponse.json({ ok: true, adopted: result.count })
  } catch (error) {
    console.error('POST /api/designs/adopt-all failed', error)
    return NextResponse.json({ error: 'Failed to adopt designs.' }, { status: 500 })
  }
}
