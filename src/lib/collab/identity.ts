'use client'

/**
 * Collaborator identity (v0.5 Phase 6).
 *
 * Minimum identity layer required for collaboration — no accounts, no auth
 * rewrite. A persistent local participant identity: id + display name +
 * stable color. Works for anonymous/local editing; a future account system
 * can override `participantId`/`name` without touching the collab transport.
 */

const IDENTITY_KEY = 'canvix-identity-v1'

export interface ParticipantIdentity {
  /** globally-unique-ish participant id (kept stable across sessions) */
  id: string
  /** display name (≤ 40 chars) */
  name: string
  /** stable avatar color */
  color: string
}

const PALETTE = [
  '#FF5C8A', '#00C4CC', '#7630D7', '#F59E0B', '#10B981',
  '#3B82F6', '#EF4444', '#8B5CF6', '#14B8A6', '#EC4899',
  '#84CC16', '#06B6D4',
]

const ADJECTIVES = ['Swift', 'Bright', 'Calm', 'Bold', 'Cosmic', 'Fresh', 'Lucky', 'Sunny', 'Clever', 'Rapid']
const NOUNS = ['Fox', 'Otter', 'Falcon', 'Panda', 'Koala', 'Tiger', 'Heron', 'Lynx', 'Marmot', 'Raven']

function randomId(): string {
  return `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

function randomName(): string {
  return `${ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]} ${NOUNS[Math.floor(Math.random() * NOUNS.length)]}`
}

function colorFor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return PALETTE[hash % PALETTE.length]
}

let cached: ParticipantIdentity | null = null

/** Get (creating + persisting on first use) the local participant identity. */
export function getIdentity(): ParticipantIdentity {
  if (cached) return cached
  if (typeof window === 'undefined') {
    // SSR safety — a transient identity; never used for real collaboration
    return { id: 'ssr', name: 'Guest', color: '#7630D7' }
  }
  try {
    const raw = localStorage.getItem(IDENTITY_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ParticipantIdentity>
      if (parsed.id && parsed.name) {
        cached = {
          id: String(parsed.id).slice(0, 40),
          name: String(parsed.name).slice(0, 40),
          color: colorFor(String(parsed.id)),
        }
        return cached
      }
    }
  } catch {
    /* corrupt or unavailable — regenerate below */
  }
  const fresh: ParticipantIdentity = {
    id: randomId(),
    name: randomName(),
    color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
  }
  cached = fresh
  try {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(fresh))
  } catch {
    /* private mode — identity stays per-session only */
  }
  return fresh
}

/** Update the display name (identity card in the presence popover). */
export function setDisplayName(name: string): ParticipantIdentity {
  const id = getIdentity()
  const clean = name.trim().slice(0, 40) || id.name
  cached = { ...id, name: clean }
  try {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(cached))
  } catch {
    /* ignore */
  }
  return cached
}
