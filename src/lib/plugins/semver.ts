// ─────────────────────────────────────────────────────────────
// Plugin semver — the hand-rolled range matcher for plugin
// `engines.canvix` (research/PLUGIN-SYSTEM.md §4.1).
//
// Why hand-rolled: the whole plugin system is zero-new-dependency
// (§4.10); the full `semver` package is ~30 KB for a grammar we
// only need a slice of. Supported range grammar:
//
//   exact        1.2.3
//   comparator   >=1.2.3  >1.2.3  <=1.2.3  <1.2.3  =1.2.3
//   AND set      >=0.12.0 <0.13.0        (spaces)
//   hyphen       0.12.0 - 0.13.0         (inclusive both ends)
//   OR           <0.13.0 || >=0.14.0
//   x-range      1.2.x  1.x  1.2.*  1.2  (partial versions)
//   caret/tilde  ^1.2.3  ~1.2.3           (author ergonomics)
//
// Prerelease rule (semver spec): a prerelease version only
// satisfies a set that contains a comparator with a prerelease
// on the same [major.minor.patch]. Hosts ship `0.13.0-rc.1`
// style builds, so this matters for real installs.
// ─────────────────────────────────────────────────────────────

export interface Semver {
  major: number
  minor: number
  patch: number
  /** dotted prerelease identifiers, e.g. ['rc', 1] */
  prerelease: (string | number)[]
}

const SEMVER_RE =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** Parse a strict `major.minor.patch` string (optional v-prefix, prerelease, build). */
export function parseSemver(raw: string): Semver | null {
  if (typeof raw !== 'string') return null
  const m = SEMVER_RE.exec(raw.trim())
  if (!m) return null
  const major = Number(m[1])
  const minor = Number(m[2])
  const patch = Number(m[3])
  if (major > 1e9 || minor > 1e9 || patch > 1e9) return null
  const prerelease: (string | number)[] = []
  if (m[4]) {
    for (const part of m[4].split('.')) {
      if (part === '') return null
      if (/^\d+$/.test(part)) {
        // per spec, numeric identifiers must not have leading zeros
        if (part.length > 1 && part.startsWith('0')) return null
        prerelease.push(Number(part))
      } else {
        prerelease.push(part)
      }
    }
  }
  return { major, minor, patch, prerelease }
}

function ver(major: number, minor: number, patch: number): Semver {
  return { major, minor, patch, prerelease: [] }
}

/** Compare two prerelease identifier lists (semver §11.4). */
function comparePrerelease(
  a: (string | number)[],
  b: (string | number)[],
): number {
  if (a.length === 0 && b.length === 0) return 0
  // no prerelease > has prerelease
  if (a.length === 0) return 1
  if (b.length === 0) return -1
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const x = a[i]
    const y = b[i]
    if (x === undefined) return -1 // shorter set is lower
    if (y === undefined) return 1
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1
    if (typeof x === 'number') return -1 // numeric < alphanumeric
    if (typeof y === 'number') return 1
    return x < y ? -1 : 1 // ASCII lexical
  }
  return 0
}

/** Full semver ordering. `a < b` → negative. */
export function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  return comparePrerelease(a.prerelease, b.prerelease)
}

type Op = '>=' | '>' | '<=' | '<' | '='

interface Comparator {
  op: Op
  ver: Semver
}

interface Partial {
  major: number
  minor: number
  patch: number
  /** all three parts were concrete numbers */
  full: boolean
  minorSpecified: boolean
  patchSpecified: boolean
}

const isWild = (t: string) => t === '' || t === 'x' || t === 'X' || t === '*'
const num = (t: string) => (/^\d+$/.test(t) ? Number(t) : NaN)

/** Parse `1`, `1.2`, `1.2.3`, `1.2.x`, `1.x.*` (no operators, no prerelease). */
function parsePartial(raw: string): Partial | null {
  const s = raw.trim()
  if (!s) return null
  const parts = s.split('.')
  if (parts.length === 0 || parts.length > 3) return null
  const [maj = 'x', min = 'x', pat = 'x'] = parts
  const major = isWild(maj) ? 0 : num(maj)
  if (!Number.isFinite(major)) return null
  const minorSpecified = !isWild(min)
  const patchSpecified = !isWild(pat)
  const minor = minorSpecified ? num(min) : 0
  const patch = patchSpecified ? num(pat) : 0
  if (!Number.isFinite(minor) || !Number.isFinite(patch)) return null
  // wildcards may not be followed by specifics (1.x.3 is invalid)
  if (!minorSpecified && patchSpecified) return null
  return { major, minor, patch, full: minorSpecified && patchSpecified, minorSpecified, patchSpecified }
}

/** Parse a token's version — full semver (prerelease allowed) first, then partial. */
function parseTokenVersion(raw: string): (Semver & Partial) | null {
  const full = parseSemver(raw)
  if (full) {
    return { ...full, full: true, minorSpecified: true, patchSpecified: true }
  }
  const p = parsePartial(raw)
  if (!p) return null
  return { ...ver(p.major, p.minor, p.patch), ...p }
}

/** Expand one token (no whitespace) into comparators. */
function expandToken(token: string): Comparator[] | null {
  // caret — "allow changes that don't modify the left-most non-zero
  // *specified* digit" (node-semver semantics):
  //   ^1.2.3 → >=1.2.3 <2.0.0 · ^0.2.3 → >=0.2.3 <0.3.0 · ^0.0.3 → >=0.0.3 <0.0.4
  //   ^1.2 → >=1.2.0 <2.0.0 · ^0.2 → >=0.2.0 <0.3.0 · ^0 → >=0.0.0 <1.0.0
  if (token.startsWith('^')) {
    const v = parseTokenVersion(token.slice(1))
    if (!v) return null
    const { major, minor, patch, minorSpecified, patchSpecified } = v
    if (!minorSpecified) {
      return [{ op: '>=', ver: ver(major, 0, 0) }, { op: '<', ver: ver(major + 1, 0, 0) }]
    }
    if (!patchSpecified) {
      if (major > 0) return [{ op: '>=', ver: ver(major, minor, 0) }, { op: '<', ver: ver(major + 1, 0, 0) }]
      return [{ op: '>=', ver: ver(major, minor, 0) }, { op: '<', ver: ver(major, minor + 1, 0) }]
    }
    if (major > 0) return [{ op: '>=', ver: v }, { op: '<', ver: ver(major + 1, 0, 0) }]
    if (minor > 0) return [{ op: '>=', ver: v }, { op: '<', ver: ver(major, minor + 1, 0) }]
    return [{ op: '>=', ver: v }, { op: '<', ver: ver(major, minor, patch + 1) }]
  }
  // tilde: ~1.2.3 → >=1.2.3 <1.3.0 · ~1.2 → >=1.2.0 <1.3.0 · ~1 → >=1.0.0 <2.0.0
  if (token.startsWith('~')) {
    const v = parseTokenVersion(token.slice(1))
    if (!v) return null
    if (v.minorSpecified) {
      return [{ op: '>=', ver: v }, { op: '<', ver: ver(v.major, v.minor + 1, 0) }]
    }
    return [{ op: '>=', ver: ver(v.major, 0, 0) }, { op: '<', ver: ver(v.major + 1, 0, 0) }]
  }
  const m = /^(>=|<=|>|<|=)?(.*)$/.exec(token)
  if (!m) return null
  const op = (m[1] ?? '=') as Op
  const v = parseTokenVersion(m[2])
  if (!v) return null
  if (v.full) {
    // keep the prerelease — '>=0.13.0-rc.1' must stay a prerelease
    // comparator or the spec's prerelease rule cannot fire
    return [{ op, ver: v }]
  }
  if (v.minorSpecified) {
    // partials shift like node-semver: '>1.2' ⇒ >=1.3.0, '<1.2' ⇒ <1.2.0,
    // '<=1.2' ⇒ <1.3.0, '=1.2'/bare ⇒ the 1.2.x range, '>=1.2' ⇒ >=1.2.0
    if (op === '>') return [{ op: '>=', ver: ver(v.major, v.minor + 1, 0) }]
    if (op === '<') return [{ op: '<', ver: ver(v.major, v.minor, 0) }]
    if (op === '<=') return [{ op: '<', ver: ver(v.major, v.minor + 1, 0) }]
    if (op === '=') {
      return [{ op: '>=', ver: ver(v.major, v.minor, 0) }, { op: '<', ver: ver(v.major, v.minor + 1, 0) }]
    }
    return [{ op: '>=', ver: ver(v.major, v.minor, 0) }]
  }
  // major-only: '1' / '1.x'
  if (op === '>') return [{ op: '>=', ver: ver(v.major + 1, 0, 0) }]
  if (op === '<') return [{ op: '<', ver: ver(v.major, 0, 0) }]
  if (op === '<=') return [{ op: '<', ver: ver(v.major + 1, 0, 0) }]
  if (op === '=') {
    return [{ op: '>=', ver: ver(v.major, 0, 0) }, { op: '<', ver: ver(v.major + 1, 0, 0) }]
  }
  return [{ op: '>=', ver: ver(v.major, 0, 0) }]
}

/** Parse one comparator set (no `||`, no hyphen) into comparators. */
function parseSet(text: string): Comparator[] | null {
  const out: Comparator[] = []
  for (const token of text.split(/\s+/)) {
    if (!token) continue
    const comps = expandToken(token)
    if (!comps) return null
    out.push(...comps)
  }
  return out.length ? out : null
}

/** Does `version` satisfy every comparator in `set`? */
function satisfiesSet(version: Semver, set: Comparator[]): boolean {
  let ok = true
  let hasPrereleaseComparator = false
  for (const c of set) {
    if (
      c.ver.prerelease.length > 0 &&
      c.ver.major === version.major &&
      c.ver.minor === version.minor &&
      c.ver.patch === version.patch
    ) {
      hasPrereleaseComparator = true
    }
    const cmp = compareSemver(version, c.ver)
    switch (c.op) {
      case '>=': if (cmp < 0) ok = false; break
      case '>': if (cmp <= 0) ok = false; break
      case '<=': if (cmp > 0) ok = false; break
      case '<': if (cmp >= 0) ok = false; break
      case '=': if (cmp !== 0) ok = false; break
    }
  }
  if (!ok) return false
  // prerelease versions only match sets that mention their own triple
  if (version.prerelease.length > 0 && !hasPrereleaseComparator) return false
  return true
}

/**
 * Does `version` satisfy a range like `>=0.12.0 <0.13.0`?
 * Returns false for unparseable ranges (callers surface a
 * plain-language error — never a silent no-op, §4.1).
 */
export function matchesRange(version: string | Semver, range: string): boolean {
  const v = typeof version === 'string' ? parseSemver(version) : version
  if (!v) return false
  if (typeof range !== 'string' || !range.trim()) return false
  for (const alt of range.split('||')) {
    // hyphen range: `0.12.0 - 0.13.0` (inclusive); partial upper
    // end opens up: `0.12.0 - 0.13` → >=0.12.0 <0.14.0 (semver spec)
    const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(alt.trim())
    if (hyphen) {
      const lo = parsePartial(hyphen[1])
      const hi = parsePartial(hyphen[2])
      if (!lo || !hi) continue
      // full upper bounds are INCLUSIVE; partial ones open up
      const hiFull = hi.full
        ? ver(hi.major, hi.minor, hi.patch)
        : hi.minorSpecified
          ? ver(hi.major, hi.minor + 1, 0)
          : ver(hi.major + 1, 0, 0)
      const set: Comparator[] = [
        { op: '>=', ver: ver(lo.major, lo.minor, lo.patch) },
        { op: hi.full ? '<=' : '<', ver: hiFull },
      ]
      if (satisfiesSet(v, set)) return true
      continue
    }
    const set = parseSet(alt)
    if (set && satisfiesSet(v, set)) return true
  }
  return false
}

/** True when both parse and `a === b` on all parts incl. prerelease. */
export function sameVersion(a: string, b: string): boolean {
  const x = parseSemver(a)
  const y = parseSemver(b)
  if (!x || !y) return false
  return compareSemver(x, y) === 0
}

/**
 * Is this a syntactically valid range (at least one parseable
 * alternative)? Distinguishes "garbage range" (install error:
 * fix your manifest) from "valid but doesn't match this host"
 * (install error: wrong version) — both block, with different
 * plain-language messages.
 */
export function isValidRange(range: string): boolean {
  if (typeof range !== 'string' || !range.trim()) return false
  let any = false
  for (const alt of range.split('||')) {
    const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(alt.trim())
    if (hyphen) {
      if (parsePartial(hyphen[1]) && parsePartial(hyphen[2])) any = true
      continue
    }
    if (parseSet(alt)) any = true
  }
  return any
}
