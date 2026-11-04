// ─────────────────────────────────────────────────────────────
// claim-folders — anonymous folders follow the account (v0.14, D6).
//
// Folders stamp attribution exactly like designs and media: signed-out
// creations carry the canvix_anon cookie hash. Signing in (or
// registering) claims those rows into the account, so the folder tree
// is visible from every device after login — the same D1 acceptance
// criterion, applied to organization.
//
// Designs keep pointing at the same folder ids through the claim (the
// rows are re-attributed in place), so nothing else needs to move.
// Failures are swallowed (best-effort — unclaimed folders stay
// anonymous and still work in that browser).
// ─────────────────────────────────────────────────────────────

import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { anonKeyHash, readAnonToken } from '@/lib/auth/anon'

export async function claimAnonFolders(req: NextRequest, userId: string): Promise<void> {
  try {
    const token = readAnonToken(req)
    if (!token) return
    await db.folder.updateMany({
      where: { ownerId: null, anonKey: anonKeyHash(token) },
      data: { ownerId: userId, anonKey: null },
    })
  } catch {
    // best-effort: unclaimed folders stay anonymous and still work
  }
}
