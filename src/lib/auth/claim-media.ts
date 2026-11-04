// ─────────────────────────────────────────────────────────────
// claim-media — anonymous uploads follow the account (v0.14, D1).
//
// The media store stamps attribution exactly like designs: signed-out
// uploads carry the canvix_anon cookie hash. Signing in (or registering)
// claims those rows into the account, so the uploads library is visible
// from every device after login — the D1 acceptance criterion.
//
// Unlike design adoption there is no eligibility subtlety: the anon key
// is scoped to this browser, so claiming on login can never sweep
// another person's uploads. Failures are swallowed (best-effort — the
// rows simply stay anonymous, nothing breaks).
// ─────────────────────────────────────────────────────────────

import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { anonKeyHash, readAnonToken } from '@/lib/auth/anon'

export async function claimAnonMedia(req: NextRequest, userId: string): Promise<void> {
  try {
    const token = readAnonToken(req)
    if (!token) return
    await db.media.updateMany({
      where: { ownerId: null, anonKey: anonKeyHash(token) },
      data: { ownerId: userId, anonKey: null },
    })
  } catch {
    // best-effort: unclaimed media stays anonymous and still works
  }
}
