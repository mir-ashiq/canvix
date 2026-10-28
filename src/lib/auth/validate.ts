// ─────────────────────────────────────────────────────────────
// Account input validation (v0.9) — pure, unit-testable.
//
// Usernames: 3–32 chars of [a-z0-9_-], stored lowercase.
//            Lowercasing is canonical (uniqueness is case-insensitive);
//            the charset blocks lookalike spoofing and path/SQL games.
// Passwords: 8–200 chars. No composition rules — length wins
//            (NIST SP 800-63B guidance), and we refuse the handful of
//            passwords that are trivially guessable.
// ─────────────────────────────────────────────────────────────

export const USERNAME_MIN = 3
export const USERNAME_MAX = 32
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 200

const USERNAME_RE = /^[a-z0-9_-]+$/

const TOP_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', '12345678',
  '123456789', '1234567890', 'qwertyuiop', 'qwerty123', 'letmein123',
  'iloveyou1', 'admin1234', 'welcome123', 'canvix123', 'changeme123',
])

export interface ValidationCheck {
  ok: boolean
  error?: string
}

/** Canonicalize + validate a username. */
export function checkUsername(raw: unknown): ValidationCheck {
  if (typeof raw !== 'string') return { ok: false, error: 'Username is required.' }
  const name = raw.trim().toLowerCase()
  if (name.length < USERNAME_MIN) return { ok: false, error: `Username must be at least ${USERNAME_MIN} characters.` }
  if (name.length > USERNAME_MAX) return { ok: false, error: `Username must be at most ${USERNAME_MAX} characters.` }
  if (!USERNAME_RE.test(name)) {
    return { ok: false, error: 'Username can only use letters, numbers, - and _.' }
  }
  if (name.startsWith('-') || name.startsWith('_')) return { ok: false, error: 'Username must start with a letter or number.' }
  return { ok: true }
}

/** The canonical stored/compared form of a username. */
export function canonicalUsername(raw: string): string {
  return raw.trim().toLowerCase()
}

export function checkPassword(raw: unknown): ValidationCheck {
  if (typeof raw !== 'string') return { ok: false, error: 'Password is required.' }
  if (raw.length < PASSWORD_MIN) return { ok: false, error: `Password must be at least ${PASSWORD_MIN} characters.` }
  if (raw.length > PASSWORD_MAX) return { ok: false, error: `Password must be at most ${PASSWORD_MAX} characters.` }
  if (TOP_PASSWORDS.has(raw.trim().toLowerCase())) {
    return { ok: false, error: 'That password is too common — choose something less guessable.' }
  }
  return { ok: true }
}
