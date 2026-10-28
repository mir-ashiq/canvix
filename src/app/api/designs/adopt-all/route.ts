import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth/session'
import { anonHashFrom } from '@/lib/auth/anon'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'

// POST /api/designs/adopt-all — one-click migration into an account.
//
// v0.9.1 SAFETY: claims ONLY the ownerless designs attributed to the
// caller's own browser (Design.anonKey = sha256 of the canvix_anon
// cookie). Another person's anonymous work and pre-attribution legacy
// rows are never touched — the first need their author's own browser,
// the second are claimed one-by-one via POST /api/designs/[id]/adopt.
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
    const anonHash = anonHashFrom(req)
    if (!anonHash) {
      // No attribution cookie → nothing this browser created → claim nothing.
      return NextResponse.json({ ok: true, adopted: 0 })
    }
    const result = await db.design.updateMany({
      where: { ownerId: null, anonKey: anonHash },
      data: { ownerId: user.id },
    })
    return NextResponse.json({ ok: true, adopted: result.count })
  } catch (error) {
    console.error('POST /api/designs/adopt-all failed', error)
    return NextResponse.json({ error: 'Failed to adopt designs.' }, { status: 500 })
  }
}
