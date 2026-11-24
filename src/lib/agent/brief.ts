// ─────────────────────────────────────────────────────────────
// Design Brief Contract (v0.28, Phase 5).
//
// The anti-hallucination core: explicit user requirements are
// extracted into a TYPED contract BEFORE any generation, marked
// mandatory vs preference, and every completion claim is validated
// against the REAL refreshed canvas state. The agent may not
// substitute "Creative Pulse" for "Design Beyond Limits" because
// the exact strings are contract fields the validator checks.
//
// Extraction is heuristic + model-assisted: the ROUTE parses the
// user message into a draft contract (this module's `extractBrief`
// runs server-side, zero model calls — quoted strings, hex colors,
// dimensions, platform keywords); the loop's first model turn may
// refine it (plan step). Explicit values are IMMUTABLE after
// extraction — brand kits/templates/creativity may only FILL GAPS,
// never override (Phase 5 rule).
// ─────────────────────────────────────────────────────────────

export interface BriefConstraint {
  /** where it came from — mandatory items fail validation when missing */
  tier: 'mandatory' | 'preference' | 'optional'
}

/** A composite design deliverable the user named explicitly (v0.29.3):
 *  "a realistic editor mockup", "3 feature cards", "glassmorphism".
 *  These are REQUIREMENTS, not decoration — the validator checks that
 *  the corresponding native, editable elements actually exist. */
export interface RequiredFeature extends BriefConstraint {
  kind: 'editor-mockup' | 'feature-cards' | 'glassmorphism'
  /** for feature-cards: how many cards the user asked for */
  count?: number
  /** human label for prompts and unmet messages */
  label: string
}

export interface DesignBrief {
  /** exact strings the user quoted or demanded — checked verbatim */
  requiredTexts: (BriefConstraint & { text: string; role?: string })[]
  /** exact hex colors — checked case-insensitively against the page */
  requiredColors: (BriefConstraint & { hex: string; role?: string })[]
  /** composite deliverables (mockup, cards, glassmorphism) */
  requiredFeatures?: RequiredFeature[]
  /** canvas dimensions in px */
  dimensions?: BriefConstraint & { width: number; height: number }
  /** detected platform/format ("instagram-post", "story", "poster"…) */
  format?: string
  /** design type noun ("poster", "menu", "deck", "thumbnail"…) */
  designType?: string
  /** things the user explicitly forbade */
  restrictions: string[]
  /** free-text extras the validator can't check mechanically */
  notes: string[]
  /** platform presets used to fill dimensions when unspecified */
  source: 'user' | 'model-refined'
}

const HEX_RE = /#([0-9a-fA-F]{6})\b/g
const QUOTED_RE = /[“"']([^“"']{2,80})[”"']/g

/** Known platform presets — fills dimensions only when the user
 *  did NOT state any. Never overrides an explicit size. */
export const FORMAT_PRESETS: Record<string, { width: number; height: number; label: string }> = {
  'instagram-post': { width: 1080, height: 1080, label: 'Instagram post (1080×1080)' },
  'instagram-square': { width: 1080, height: 1080, label: 'Instagram square (1080×1080)' },
  'instagram-portrait': { width: 1080, height: 1350, label: 'Instagram portrait (1080×1350)' },
  story: { width: 1080, height: 1920, label: 'Story (1080×1920)' },
  'reel-cover': { width: 1080, height: 1920, label: 'Reel cover (1080×1920)' },
  poster: { width: 1240, height: 1754, label: 'Poster A4 @150dpi (1240×1754)' },
  flyer: { width: 1240, height: 1754, label: 'Flyer A4 (1240×1754)' },
  'a4': { width: 1240, height: 1754, label: 'A4 @150dpi (1240×1754)' },
  'youtube-thumbnail': { width: 1280, height: 720, label: 'YouTube thumbnail (1280×720)' },
  thumbnail: { width: 1280, height: 720, label: 'Thumbnail (1280×720)' },
  'linkedin-post': { width: 1200, height: 1200, label: 'LinkedIn post (1200×1200)' },
  'linkedin-banner': { width: 1584, height: 396, label: 'LinkedIn banner (1584×396)' },
  'facebook-cover': { width: 1640, height: 924, label: 'Facebook cover (1640×924)' },
  'twitter-header': { width: 1500, height: 500, label: 'X/Twitter header (1500×500)' },
  presentation: { width: 1920, height: 1080, label: 'Presentation (1920×1080)' },
  slide: { width: 1920, height: 1080, label: 'Slide (1920×1080)' },
  deck: { width: 1920, height: 1080, label: 'Deck (1920×1080)' },
  'business-card': { width: 1050, height: 600, label: 'Business card (1050×600)' },
  menu: { width: 1240, height: 1754, label: 'Menu (1240×1754)' },
  logo: { width: 1000, height: 1000, label: 'Logo canvas (1000×1000)' },
}

const FORMAT_HINTS: [RegExp, string][] = [
  // order matters: story/reel before the generic instagram hint
  [/\b(?:instagram\s*)?(?:story|reel)\b/, 'story'],
  [/\byoutube\b.*\bthumbnail\b|\bthumbnail\b/, 'youtube-thumbnail'],
  [/\bposter\b/, 'poster'],
  [/\bflyer\b/, 'flyer'],
  [/\bmenu\b/, 'menu'],
  [/\blogo\b/, 'logo'],
  [/\b(business\s*card)\b/, 'business-card'],
  [/\b(linkedin|fb|facebook)\b.*\b(banner|cover|header)\b/, 'linkedin-banner'],
  [/\bfacebook\b.*\bcover\b|\bfb\s*cover\b/, 'facebook-cover'],
  [/\b(twitter|x)\b.*\bheader\b/, 'twitter-header'],
  [/\b(presentation|slide|deck|pitch)\b/, 'presentation'],
  [/\binstagram\b/, 'instagram-post'],
  [/\bbanner\b/, 'linkedin-banner'],
]

const DIMENSIONS_RE = /(\d{3,5})\s*[x×by]\s*(\d{3,5})/

/** Heuristic, deterministic brief extraction — no model calls.
 *  Everything it finds is `mandatory` because the user typed it. */
export function extractBrief(message: string, pageWidth?: number, pageHeight?: number): DesignBrief {
  const m = message.trim()

  // exact quoted strings — the strongest signal ("Design Beyond Limits")
  const requiredTexts: DesignBrief['requiredTexts'] = []
  const seen = new Set<string>()
  for (const q of m.matchAll(QUOTED_RE)) {
    const text = q[1].trim()
    if (text.length >= 2 && !seen.has(text.toLowerCase())) {
      seen.add(text.toLowerCase())
      requiredTexts.push({ tier: 'mandatory', text })
    }
  }
  // "headline: X", "title = Y", "tagline should read Z" unquoted
  // patterns → mandatory too.
  //
  // v0.29.3 REGRESSION GUARD (found on the failed CANVIX production
  // run): the old pattern had an OPTIONAL separator and the /i flag,
  // so "Exact text only:" matched as keyword "text" + capture
  // "only:" — manufacturing a FAKE mandatory string that the agent
  // then placed on the canvas as a real requirement. Three guards now:
  //   1. the separator (:, =, "should be/say/read", "is", …) is
  //      REQUIRED between the keyword and the payload;
  //   2. the payload must START WITH A CAPITAL LETTER (matched with
  //      a case-sensitive test — real headlines do);
  //   3. known instruction words ("only", "exactly", …) are never
  //      valid payloads. Quoted strings already captured above win.
  const UNQUOTED_RE =
    /\b(?:headline|title|heading|saying|tagline|copy|cta|text)\s*(?::|=|should\s+(?:be|say|read)|is|says|reads)?\s*[\"'\u201c\u201d]?([^\n\"'\u201c\u201d.]{2,80})[\"'\u201c\u201d]?/gi
  const STOPWORDS = new Set(['only', 'exactly', 'verbatim', 'character', 'characters', 'word', 'words', 'list', 'following', 'these', 'below', 'above', 'here'])
  for (const mm of m.matchAll(UNQUOTED_RE)) {
    const text = mm[1].trim().replace(/[,;:]\s*$/, '')
    if (!text) continue
    const first = text.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '')
    if (STOPWORDS.has(first)) continue
    // payload must start with a capital letter (case-sensitive)
    if (!/^[A-Z]/.test(text)) continue
    // a quoted list after the keyword is the payload — never also
    // capture the prose between keyword and the first quote
    if (!seen.has(text.toLowerCase())) {
      seen.add(text.toLowerCase())
      requiredTexts.push({ tier: 'mandatory', text, role: 'heading' })
    }
  }

  // exact hex colors
  const requiredColors: DesignBrief['requiredColors'] = []
  const seenHex = new Set<string>()
  for (const mm of m.matchAll(HEX_RE)) {
    const hex = `#${mm[1].toLowerCase()}`
    if (!seenHex.has(hex)) {
      seenHex.add(hex)
      requiredColors.push({ tier: 'mandatory', hex })
    }
  }

  // composite deliverables the user NAMED — these are requirements,
  // not decoration (v0.29.3: "realistic editor mockup", "3 feature
  // cards", "glassmorphism" became verifiable contract fields)
  const requiredFeatures: RequiredFeature[] = []
  const lowerText = m.toLowerCase()
  if (/\bmockup\b/i.test(m)) {
    requiredFeatures.push({
      tier: 'mandatory',
      kind: 'editor-mockup',
      label: 'a realistic editor mockup (a large native panel containing inner UI elements)',
    })
  }
  const cardCount = lowerText.match(/(\d+|three|two|four|five)\s*(?:feature\s*)?cards?\b/)
  if (cardCount) {
    const words: Record<string, number> = { two: 2, three: 3, four: 4, five: 5 }
    const n = /^\d+$/.test(cardCount[1]) ? Number(cardCount[1]) : (words[cardCount[1]] ?? 2)
    requiredFeatures.push({
      tier: 'mandatory',
      kind: 'feature-cards',
      count: Math.min(Math.max(n, 1), 8),
      label: `${Math.min(Math.max(n, 1), 8)} feature cards (semi-transparent native rect + text)`,
    })
  }
  if (/\bglassmorphism\b|\bfrosted\s+glass\b/i.test(m)) {
    requiredFeatures.push({
      tier: 'mandatory',
      kind: 'glassmorphism',
      label: 'glassmorphism (semi-transparent rgba fills with visible borders)',
    })
  }

  // explicit dimensions
  const dims = m.match(DIMENSIONS_RE)
  let dimensions: DesignBrief['dimensions'] | undefined
  if (dims) {
    const w = Number(dims[1])
    const h = Number(dims[2])
    if (w >= 50 && w <= 10000 && h >= 50 && h <= 10000) {
      dimensions = { tier: 'mandatory', width: w, height: h }
    }
  }

  // format detection
  const lower = m.toLowerCase()
  let format: string | undefined
  for (const [re, id] of FORMAT_HINTS) {
    if (re.test(lower)) {
      format = id
      break
    }
  }
  // format fills dimensions ONLY when none were explicit
  if (!dimensions && format && FORMAT_PRESETS[format]) {
    const preset = FORMAT_PRESETS[format]
    dimensions = { tier: 'preference', width: preset.width, height: preset.height }
  }
  // last resort: the current page (edit mode keeps the user's canvas)
  if (!dimensions && pageWidth && pageHeight) {
    dimensions = { tier: 'preference', width: pageWidth, height: pageHeight }
  }

  // design type noun
  const typeMatch = lower.match(/\b(poster|flyer|menu|logo|banner|thumbnail|deck|presentation|slide|business\s*card|infographic|campaign|invitation|certificate|resume|newsletter|ad|advert|social\s*media\s*post)\b/)
  const designType = typeMatch ? typeMatch[1].replace(/\s+/g, ' ') : undefined

  // restrictions
  const restrictions: string[] = []
  for (const mm of m.matchAll(/\b(?:no|don'?t|without|avoid)\s+([a-z][a-z\s-]{2,30})/gi)) {
    restrictions.push(`no ${mm[1].trim()}`)
  }

  return {
    requiredTexts,
    requiredColors,
    ...(requiredFeatures.length ? { requiredFeatures } : {}),
    dimensions,
    format,
    designType,
    restrictions,
    notes: [],
    source: 'user',
  }
}

/** Case-insensitive hex equality ("#FFFFFF" === "#ffffff"). */
function hexEq(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

export interface BriefValidationResult {
  /** all mandatory constraints satisfied against the REAL state */
  satisfied: boolean
  unmet: string[]
  checked: {
    text: { text: string; found: boolean }[]
    color: { hex: string; found: boolean }[]
    features?: { label: string; found: boolean }[]
    dimensions?: { width: number; height: number; match: boolean }
  }
}

/** Minimal element shape the feature validator needs — the client
 *  sends this alongside texts/colors (v0.29.3). */
export interface BriefElementLike {
  type: string
  x?: number
  y?: number
  width?: number
  height?: number
  fill?: string
  stroke?: string
  text?: string
}

/** Parse "#RRGGBB" or "rgba(r,g,b,a)" → {r,g,b,a} (a defaults 1); null unparseable.
 *  Exported for the audit's effective-background math (shared color model). */
export function parseColor(c: unknown): { r: number; g: number; b: number; a: number } | null {
  if (typeof c !== 'string') return null
  const s = c.trim()
  const hex = /^#?([0-9a-f]{6})$/i.exec(s)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }
  }
  const rgx =
    /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(s)
  if (rgx) {
    const a = rgx[4] === undefined ? 1 : rgx[4].endsWith('%') ? Number(rgx[4].slice(0, -1)) / 100 : Number(rgx[4])
    return { r: Number(rgx[1]), g: Number(rgx[2]), b: Number(rgx[3]), a: Math.min(Math.max(a || 0, 0), 1) }
  }
  return null
}

/** Element center inside another's bounds (with tolerance). */
function centerInside(el: BriefElementLike, host: BriefElementLike): boolean {
  const cx = (el.x ?? 0) + (el.width ?? 0) / 2
  const cy = (el.y ?? 0) + (el.height ?? 0) / 2
  return (
    cx >= (host.x ?? 0) && cx <= (host.x ?? 0) + (host.width ?? 0) &&
    cy >= (host.y ?? 0) && cy <= (host.y ?? 0) + (host.height ?? 0)
  )
}

/** Structural validation of the composite deliverables (v0.29.3).
 *  Heuristics on purpose — a FALSE PASS here hides a missing
 *  deliverable; a false failure only costs one extra build step. */
function validateFeatures(
  features: RequiredFeature[],
  els: BriefElementLike[],
): { label: string; found: boolean }[] {
  const rects = els.filter((e) => e.type === 'rect' && (e.width ?? 0) > 0 && (e.height ?? 0) > 0)
  const texts = els.filter((e) => e.type === 'text' && e.text)
  const out: { label: string; found: boolean }[] = []

  for (const f of features) {
    if (f.kind === 'editor-mockup') {
      // a large panel with ≥3 inner elements, at least one non-text
      // (toolbar/canvas chrome) — built from native elements
      const found = rects.some((r) => {
        if ((r.width ?? 0) < 160 || (r.height ?? 0) < 110) return false
        const inner = els.filter((e) => e !== r && centerInside(e, r))
        return inner.length >= 3 && inner.some((e) => e.type !== 'text')
      })
      out.push({ label: f.label, found })
    } else if (f.kind === 'feature-cards') {
      // semi-transparent or stroked rects, each carrying 1-2 texts
      const need = f.count ?? 2
      const cards = rects.filter((r) => {
        const w = r.width ?? 0
        const h = r.height ?? 0
        if (w < 80 || h < 60 || w > 640 || h > 640) return false
        const fill = parseColor(r.fill)
        const semi = fill !== null && fill.a <= 0.92
        const stroked = typeof r.stroke === 'string' && r.stroke.trim().length > 0
        if (!semi && !stroked) return false
        const inside = texts.filter((t) => centerInside(t, r))
        return inside.length >= 1 && inside.length <= 3
      })
      out.push({ label: f.label, found: cards.length >= need })
    } else if (f.kind === 'glassmorphism') {
      // ≥2 semi-transparent elements with visible structure (fill
      // alpha 0.03–0.6); a border on at least one
      const glass = els.filter((e) => {
        const fill = parseColor(e.fill)
        return fill !== null && fill.a >= 0.03 && fill.a <= 0.6
      })
      const bordered = glass.some((e) => typeof e.stroke === 'string' && e.stroke.trim().length > 0)
      out.push({ label: f.label, found: glass.length >= 2 && bordered })
    }
  }
  return out
}

/** Validate a brief against REAL page state (post-apply, refreshed).
 *  Pure — the caller supplies what the client sent back. */
export function validateBrief(
  brief: DesignBrief,
  state: {
    texts: string[]
    /** every color on the page: fills, strokes, text colors, backgrounds */
    colors: string[]
    width: number
    height: number
    /** flattened page elements — enables feature validation (optional
     *  so older callers keep working) */
    elements?: BriefElementLike[]
  },
): BriefValidationResult {
  const unmet: string[] = []
  const text = brief.requiredTexts
    .filter((t) => t.tier === 'mandatory')
    .map((t) => {
      // case-insensitive + whitespace-tolerant containment: catches
      // the user's copy through case/wrap variations while still
      // rejecting substitutions ("Creative Pulse" ≠ "Design Beyond
      // Limits"). Hex colors are case-insensitive the same way.
      const wanted = t.text.replace(/\s+/g, ' ').trim().toLowerCase()
      const found = state.texts.some((s) => s.replace(/\s+/g, ' ').trim().toLowerCase().includes(wanted))
      if (!found) unmet.push(`Required text missing or altered: "${t.text}"`)
      return { text: t.text, found }
    })
  const color = brief.requiredColors
    .filter((c) => c.tier === 'mandatory')
    .map((c) => {
      const found = state.colors.some((s) => hexEq(s, c.hex))
      if (!found) unmet.push(`Required color #${c.hex.slice(1).toUpperCase()} not used anywhere on the page`)
      return { hex: c.hex, found }
    })
  let features: BriefValidationResult['checked']['features']
  if (brief.requiredFeatures?.length && state.elements?.length) {
    features = validateFeatures(brief.requiredFeatures, state.elements)
    for (const f of features) {
      if (!f.found) unmet.push(`Required element missing: ${f.label} — build it from NATIVE elements (rect panels, semi-transparent fills, borders, text).`)
    }
  }
  let dimensions: BriefValidationResult['checked']['dimensions']
  if (brief.dimensions && brief.dimensions.tier === 'mandatory') {
    const match = state.width === brief.dimensions.width && state.height === brief.dimensions.height
    dimensions = { width: brief.dimensions.width, height: brief.dimensions.height, match }
    if (!match) {
      unmet.push(`Canvas must be ${brief.dimensions.width}×${brief.dimensions.height} (currently ${state.width}×${state.height})`)
    }
  }
  return { satisfied: unmet.length === 0, unmet, checked: { text, color, features, dimensions } }
}

/** Compact one-line serialization for the system prompt. */
export function briefPromptSection(brief: DesignBrief): string {
  const parts: string[] = ['DESIGN BRIEF CONTRACT (extracted from the user — MANDATORY, never substitute):']
  if (brief.designType) parts.push(`· Type: ${brief.designType}`)
  if (brief.format) parts.push(`· Format: ${brief.format}`)
  if (brief.dimensions) {
    parts.push(`· Canvas: ${brief.dimensions.width}×${brief.dimensions.height}px${brief.dimensions.tier === 'mandatory' ? ' (exact)' : ' (suggested)'}`)
  }
  if (brief.requiredTexts.length) {
    parts.push(`· EXACT text (copy character-for-character): ${brief.requiredTexts.map((t) => `"${t.text}"`).join(' ')}`)
  }
  if (brief.requiredColors.length) {
    parts.push(`· EXACT colors (use these hex values verbatim): ${brief.requiredColors.map((c) => c.hex.toUpperCase()).join(' ')}`)
  }
  if (brief.requiredFeatures?.length) {
    parts.push(`· REQUIRED ELEMENTS (build these as real native, editable elements — they are deliverables, not decoration): ${brief.requiredFeatures.map((f) => f.label).join('; ')}`)
    parts.push('· COLOR USAGE RULE: required colors must appear as the page background, text fills, or panel/card fills and borders — NEVER as bare decorative strips or bars with no content on them.')
  }
  if (brief.restrictions.length) parts.push(`· Restrictions: ${brief.restrictions.join('; ')}`)
  if (brief.notes.length) parts.push(`· Notes: ${brief.notes.join('; ')}`)
  parts.push('Brand kit and templates may FILL GAPS only — they never override the exact values above.')
  parts.push('You are not done until validate_brief passes or every mandatory item is verifiably present.')
  return parts.join('\n')
}
