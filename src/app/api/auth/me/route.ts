import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'

// GET /api/auth/me — the signed-in user (or null). Public endpoint the
// dashboard/editor use to decide between account mode and anonymous mode.
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  return NextResponse.json({ user: user ? { id: user.id, username: user.username, createdAt: user.createdAt } : null })
}
