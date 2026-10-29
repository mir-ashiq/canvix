'use client'

// ─────────────────────────────────────────────────────────────
// Client-side auth (v0.9) — a tiny hook + fetch wrappers, no
// external state library. Accounts are free forever; this module
// only decides between account mode and anonymous (link) mode.
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react'

export interface AuthUser {
  id: string
  username: string
  createdAt: string
}

export interface AuthState {
  user: AuthUser | null
  loading: boolean
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  let data: Record<string, unknown> = {}
  try {
    data = (await res.json()) as Record<string, unknown>
  } catch {
    /* empty body */
  }
  return { ok: res.ok, status: res.status, data }
}

/** Read /api/auth/me. `undefined` = transport failure (keep current state). */
async function fetchMe(): Promise<AuthUser | null | undefined> {
  try {
    const res = await fetch('/api/auth/me', { cache: 'no-store' })
    const data = (await res.json()) as { user: AuthUser | null }
    return data?.user ?? null
  } catch {
    return undefined
  }
}

/**
 * The app's auth state. `refresh()` re-reads /api/auth/me (e.g. after
 * the login dialog succeeds somewhere else in the tree).
 */
export function useAuth(): AuthState & {
  refresh: () => Promise<void>
  login: (username: string, password: string) => Promise<string | null>
  register: (username: string, password: string) => Promise<string | null>
  logout: () => Promise<void>
} {
  const [state, setState] = useState<AuthState>({ user: null, loading: true })

  const refresh = useCallback(async () => {
    const user = await fetchMe()
    setState((s) => ({ user: user === undefined ? s.user : user, loading: false }))
  }, [])

  // Initial load: state is only ever set from the async continuation
  // (never synchronously inside the effect body — the React Compiler
  // lint enforces that), and a cancel flag discards late answers after
  // unmount.
  useEffect(() => {
    let cancelled = false
    void fetchMe().then((user) => {
      if (!cancelled) setState((s) => ({ user: user === undefined ? s.user : user, loading: false }))
    })
    return () => {
      cancelled = true
    }
  }, [])

  /** returns an error message, or null on success */
  const login = useCallback(async (username: string, password: string): Promise<string | null> => {
    const { ok, data } = await postJson('/api/auth/login', { username, password })
    if (!ok) return typeof data.error === 'string' ? data.error : 'Sign-in failed.'
    setState({ user: data.user as AuthUser, loading: false })
    return null
  }, [])

  /** returns an error message, or null on success */
  const register = useCallback(async (username: string, password: string): Promise<string | null> => {
    const { ok, data } = await postJson('/api/auth/register', { username, password })
    if (!ok) return typeof data.error === 'string' ? data.error : 'Could not create the account.'
    setState({ user: data.user as AuthUser, loading: false })
    return null
  }, [])

  const logout = useCallback(async () => {
    await postJson('/api/auth/logout', {}).catch(() => {})
    setState({ user: null, loading: false })
  }, [])

  return { ...state, refresh, login, register, logout }
}

/**
 * Claim the ownerless designs attributed to THIS browser for the signed-in
 * account (v0.9.1: server-side scoped to the caller's canvix_anon cookie —
 * another person's anonymous work is never touched).
 *
 * `includeLegacy` additionally claims pre-accounts (legacy) rows — the
 * deliberate, confirmed path for self-hosters; the UI guards it behind a
 * confirmation dialog.
 */
export async function adoptAllDesigns(includeLegacy = false): Promise<number> {
  const res = await fetch('/api/designs/adopt-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ includeLegacy }),
  })
  if (!res.ok) throw new Error('adopt failed')
  const data = (await res.json()) as { adopted?: number }
  return data.adopted ?? 0
}

/**
 * Deliberately claim ONE ownerless design (your own anonymous work, or a
 * legacy design from before accounts existed). Foreign-attributed designs
 * are refused by the server with 403 NOT_ELIGIBLE.
 */
export async function adoptDesign(id: string): Promise<{ ok: boolean; status: number; error?: string }> {
  const res = await fetch(`/api/designs/${id}/adopt`, { method: 'POST' })
  let data: Record<string, unknown> = {}
  try {
    data = (await res.json()) as Record<string, unknown>
  } catch {
    /* empty body */
  }
  return { ok: res.ok, status: res.status, error: typeof data.error === 'string' ? data.error : undefined }
}
