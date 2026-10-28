import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth/session'
import { anonHashFrom } from '@/lib/auth/anon'
import { isSameOrigin, CSRF_REJECTED } from '@/lib/auth/csrf'
import { NOT_YOUR_DESIGN } from '@/lib/auth/design-guard'

// POST /api/designs/[id]/adopt — deliberately claim ONE ownerless
// design into the signed-in account.
//
// Eligibility (v0.9.1):
//   • ownerless + attributed to THIS browser (anonKey matches) → claim
//   • ownerless + legacy (anonKey null, created before attribution) → claim
//   • ownerless + attributed to ANOTHER browser → 403 NOT_ELIGIBLE
//   • already owned by you → ok, adopted 0 (idempotent)
//   • owned by someone else → 403 (the regular ownership guard)
//
// The claim itself is a single conditional updateMany (WHERE ownerId IS
// NULL), so two racing accounts can never both win.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req)) return NextResponse.json(CSRF_REJECTED, { status: 403 })
  const user = await getSessionUser(req)
  if (!user) {
    return NextResponse.json(
      { error: 'Sign in first — adopting a design moves it into your account.' },
      { status: 401 }
    )
  }
  try {
    const { id } = await params
    const design = await db.design.findUnique({ where: { id } })
    if (!design) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (design.ownerId !== null) {
      if (design.ownerId === user.id) return NextResponse.json({ ok: true, adopted: 0 })
      return NextResponse.json(NOT_YOUR_DESIGN, { status: 403 })
    }

    const anonHash = anonHashFrom(req)
    if (design.anonKey !== null && design.anonKey !== anonHash) {
      return NextResponse.json(
        {
          error: 'This design was created from another browser — it stays shared.',
          code: 'NOT_ELIGIBLE',
        },
        { status: 403 }
      )
    }

    const result = await db.design.updateMany({
      where: { id, ownerId: null },
      data: { ownerId: user.id },
    })
    if (result.count === 0) {
      // Lost the race: someone claimed it between our read and write.
      return NextResponse.json({ error: 'This design was just claimed by someone else.' }, { status: 409 })
    }
    return NextResponse.json({ ok: true, adopted: 1 })
  } catch (error) {
    console.error('POST /api/designs/[id]/adopt failed', error)
    return NextResponse.json({ error: 'Failed to adopt design.' }, { status: 500 })
  }
}
