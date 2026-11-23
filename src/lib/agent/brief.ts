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

export interface DesignBrief {
  /** exact strings the user quoted or demanded — checked verbatim */
  requiredTexts: (BriefConstraint & { text: string; role?: string })[]
  /** exact hex colors — checked case-insensitively against the page */
  requiredColors: (BriefConstraint & { hex: string; role?: string })[]
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
  // "headline X", "say Y", "text Z" unquoted patterns → mandatory too
  for (const mm of m.matchAll(/\b(?:headline|title|heading|saying|text|tagline|copy|cta)\s*(?:should\s*(?:be|say|read)|:|=|is|says|reads)?\s*[“"']?([A-Z][^.\n“"']{2,80})[”"']?/gi)) {
    const text = mm[1].trim()
    if (text && !seen.has(text.toLowerCase())) {
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
    dimensions?: { width: number; height: number; match: boolean }
  }
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
  let dimensions: BriefValidationResult['checked']['dimensions']
  if (brief.dimensions && brief.dimensions.tier === 'mandatory') {
    const match = state.width === brief.dimensions.width && state.height === brief.dimensions.height
    dimensions = { width: brief.dimensions.width, height: brief.dimensions.height, match }
    if (!match) {
      unmet.push(`Canvas must be ${brief.dimensions.width}×${brief.dimensions.height} (currently ${state.width}×${state.height})`)
    }
  }
  return { satisfied: unmet.length === 0, unmet, checked: { text, color, dimensions } }
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
  if (brief.restrictions.length) parts.push(`· Restrictions: ${brief.restrictions.join('; ')}`)
  if (brief.notes.length) parts.push(`· Notes: ${brief.notes.join('; ')}`)
  parts.push('Brand kit and templates may FILL GAPS only — they never override the exact values above.')
  parts.push('You are not done until validate_brief passes or every mandatory item is verifiably present.')
  return parts.join('\n')
}
