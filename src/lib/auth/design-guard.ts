// ─────────────────────────────────────────────────────────────
// Design access rules (v0.9) — one place, three cases:
//
//   1. ownerless design (ownerId null) → link-accessible: anyone can
//      edit. This is the pre-accounts behaviour; legacy designs and
//      intentionally shared designs keep working exactly as before.
//   2. owner signed in                    → full edit access.
//   3. anyone else (anonymous or another  → read-only: the design
//      account)                              opens, but every mutating
//                                             API answers 403 and the
//                                             editor shows view-only.
//
// SERVER-ONLY helper shared by the design routes.
// ─────────────────────────────────────────────────────────────

import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, type SessionUser } from '@/lib/auth/session'

export interface DesignAccess {
  design: { id: string; ownerId: string | null } & Record<string, unknown>
  user: SessionUser | null
  /** true unless the design is owned by someone else */
  canEdit: boolean
}

/**
 * Load a design + resolve the caller's access. Returns null when the
 * design does not exist. Never throws (DB errors bubble as usual so
 * dbErrorResponse can classify them).
 */
export async function resolveDesignAccess(
  req: NextRequest,
  id: string
): Promise<DesignAccess | null> {
  const [design, user] = await Promise.all([
    db.design.findUnique({ where: { id } }),
    getSessionUser(req),
  ])
  if (!design) return null
  const canEdit = design.ownerId === null || design.ownerId === user?.id
  return { design: design as DesignAccess['design'], user, canEdit }
}

/** Standard 403 body for mutating routes. */
export const NOT_YOUR_DESIGN = {
  error: 'This design belongs to another account — it is view-only for you.',
  code: 'READ_ONLY_DESIGN',
} as const
