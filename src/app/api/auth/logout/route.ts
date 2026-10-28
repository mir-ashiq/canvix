import { NextRequest, NextResponse } from 'next/server'
import { destroySession } from '@/lib/auth/session'

// POST /api/auth/logout — revoke the current session + clear the cookie.
export async function POST(req: NextRequest) {
  const res = NextResponse.json({ ok: true })
  await destroySession(req, res)
  return res
}
