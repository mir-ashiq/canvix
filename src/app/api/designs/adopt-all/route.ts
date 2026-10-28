import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth/session'

// POST /api/designs/adopt-all — one-click migration into an account.
//
// For the user who self-hosted Canvix before accounts existed (or who
// worked anonymously and just signed up): claims every ownerless design
// so they become private to the signed-in account. Idempotent — designs
// that already have an owner are never touched.
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) {
    return NextResponse.json(
      { error: 'Sign in first — adopting designs moves them into your account.' },
      { status: 401 }
    )
  }
  try {
    const result = await db.design.updateMany({
      where: { ownerId: null },
      data: { ownerId: user.id },
    })
    return NextResponse.json({ ok: true, adopted: result.count })
  } catch (error) {
    console.error('POST /api/designs/adopt-all failed', error)
    return NextResponse.json({ error: 'Failed to adopt designs.' }, { status: 500 })
  }
}
