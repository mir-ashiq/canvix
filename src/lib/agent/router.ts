// ─────────────────────────────────────────────────────────────
// Agent modes (v0.28, Phase 8) — intent → MODE with a tool surface.
//
// Replaces the v0.27 act/ask/plan triage. Seven modes:
//   create  — build a new design from a written request
//   edit    — specific modifications to the existing design
//   review  — inspect + feedback, ZERO write tools
//   improve — apply design refinements
//   explain — answer questions about the design/tools, ZERO writes
//   plan    — prepare a spec or proposed changes, ZERO writes
//   discuss — product/engineering talk, ZERO writes
//
// Read-only modes are ENFORCED STRUCTURALLY: the loop builds the
// tool map from the mode's allowlist, so a review run physically
// cannot call add_text no matter what the model tries. This kills
// the "agent edited the canvas during a review" failure class.
//
// The heuristic pre-classifier stays free (zero model calls) and
// now returns a mode; the model classifier refines when unsure.
// ─────────────────────────────────────────────────────────────

import type { AgentMode } from './protocol'

/** Which tool-risk tiers each mode may use. Write-capable modes get
 *  read+write (+destructive through the confirm gate); read-only
 *  modes get reads only. */
export const MODE_TOOL_RISK: Record<AgentMode, readonly ('read' | 'write' | 'destructive')[]> = {
  create: ['read', 'write', 'destructive'],
  edit: ['read', 'write', 'destructive'],
  improve: ['read', 'write', 'destructive'],
  review: ['read'],
  explain: ['read'],
  plan: ['read'],
  discuss: [],
}

export function modeAllowsWrites(mode: AgentMode): boolean {
  return MODE_TOOL_RISK[mode].includes('write')
}

/** System-prompt heading per mode. */
export const MODE_PROMPTS: Record<AgentMode, string> = {
  create: 'MODE: CREATE — build the requested design on the canvas. Empty or stale pages are yours to fill; respect the Design Brief Contract exactly.',
  edit: 'MODE: EDIT — perform the specific requested modifications. Touch only what the request implies; preserve everything else. If the canvas is empty with nothing to edit, say so honestly in your summary and ask what to create instead — do not invent elements and do not keep re-reading the page.',
  review: 'MODE: REVIEW — inspect the design and report findings. You have NO write tools: every critique must be grounded in the page state you read. Report only what is actually present; missing required items are findings, not facts to invent. End with {"done":true,"summary":…,"findings":[{severity,issue,fix}]}.',
  improve: 'MODE: IMPROVE — apply professional design refinements (typography, hierarchy, spacing, contrast, alignment). Preserve content and intent; improve execution.',
  explain: 'MODE: EXPLAIN — answer the question about the design, its elements or the editor. Read state as needed; do not modify anything.',
  plan: 'MODE: PLAN — read the design and produce a concrete plan (steps, elements, colors, fonts) WITHOUT applying it. End with {"done":true,"summary":…,"plan":[…steps]}.',
  discuss: 'MODE: DISCUSS — a product/engineering conversation about Canvix (architecture, features, bugs, workflow). The canvas is not in scope; answer directly and end with {"done":true,"summary":…}.',
}

/** Free heuristic pre-classifier — runs before any model call.
 *  Returns { mode, confidence }: 'high' skips the model call,
 *  'low' lets the model classifier decide. */
export function heuristicMode(message: string): { mode: AgentMode; confidence: 'high' | 'low' } {
  const m = message.trim()
  if (!m) return { mode: 'discuss', confidence: 'low' }
  const lower = m.toLowerCase()

  // v0.29.4 (user report: "ask him anything and it starts building"):
  // greetings and chitchat must NEVER fall through to the model
  // router, where a provider with a bias can invent a build task out
  // of "hi" or "thanks". Pure conversation → discuss, no model call.
  const words = lower.replace(/[^a-z0-9\s']/g, ' ').split(/\s+/).filter(Boolean)
  const GREETINGS = new Set([
    'hi', 'hey', 'hello', 'yo', 'hiya', 'howdy', 'hallo', 'hola',
    'thanks', 'thank', 'thx', 'ty', 'cheers', 'ok', 'okay', 'k', 'cool',
    'nice', 'great', 'awesome', 'perfect', 'good', 'bye', 'cya', 'test',
    'ping', 'wassup', 'namaste', 'salam', 'sup', 'goodbye', 'morning',
    'evening', 'afternoon', 'welcome', 'alright', 'right',
  ])
  const CHITCHAT = new Set([
    'there', 'you', 'so', 'much', 'very', 'again', 'a', 'the', 'to',
    'too', 'man', 'dude', 'bro', 'yeah', 'yep', 'nope', 'lol', 'wow',
    'haha', 'hehe', 'um', 'uh', 'well', 'now', 'then', 'and', 'for',
  ])
  const hasGreeting = words.some((w) => GREETINGS.has(w))
  if (hasGreeting && words.length > 0 && words.length <= 5 && words.every((w) => GREETINGS.has(w) || CHITCHAT.has(w))) {
    return { mode: 'discuss', confidence: 'high' }
  }

  // v0.29.3 (found on the failed CANVIX production prompt): an obvious
  // BUILD brief must win over the product-discuss guard below. The
  // prompt "Create a premium 1080×1080 promo poster for CANVIX … 3
  // feature cards …" mentions the brand ("canvix") and the word
  // "feature" — both discuss-guard triggers — even though it is a
  // creation request for a poster ABOUT the product. Artifact noun +
  // build verb + not a question → create, full stop.
  //
  // v0.32.2 (defect A, production report): the artifact vocabulary
  // missed the entire social-media family — "Design a bold Instagram
  // post for a coffee launch" had NO artifact noun, so the styling
  // adjective "bold" became the only signal … and "bold" sat in the
  // EDIT lists. Platform posts/stories/reels are first-class design
  // artifacts now.
  const artifactNoun =
    /\b(poster|flyer|menu|logo|banner|thumbnail|deck|presentation|slide|campaign|invitation|infographic|card|graphic|advert|ad|cover|header|brochure|certificate|resume|newsletter|posts?|stor(ies|y)|reels?|story)\b|\b(instagram|insta|tiktok|pinterest|linkedin|facebook|twitter|threads|snapchat|youtube|social[- ]media)\b/
  const buildVerb = /\b(design|create|make|build|generate|add|produce)\b/
  const asksQuestion = /\?\s*$/.test(m) || /^(how|why|what|when|which|who)\b/i.test(m)
  // v0.32.7: an interrogative OPENER ("why is my poster broken?")
  // is a question about the artifact, not a create brief — polite
  // question FORMS ("can you make me a poster?") still create.
  const interrogative = /^(how|why|what|when|where|which|who)\b/i.test(m)

  // v0.32.2 (defect A): an artifact noun + build verb normally means
  // create — but "make the poster title bold" is an EDIT of an
  // existing thing. Exempt messages that pair an edit verb with a
  // reference to an EXISTING element ("the title", "this logo",
  // "existing headline") from the create-first guard.
  // v0.32.7 (production report: "ask him something to design and he
  // only talks"): the fix/improve/update verb family sat in NONE of
  // these lists — "fix it", "improve it", "update the design" fell to
  // the model router, and a provider outage (429/502 — exactly when
  // users retry) let the catch keep the catch-all: DISCUSS. Every
  // write verb is listed here so write requests classify free.
  const editVerb = /\b(make|set|change|turn|swap|move|align|center|centre|delete|remove|add|resize|rename|duplicate|rotate|flip|recolor|recolour|fix|improve|update|adjust|tweak|edit|redo|rework|revamp|restyle|rearrange|reorder)\b/
  // v0.32.7: the artifact family joins the element references —
  // "update the poster" references the EXISTING artifact, it is not a
  // create brief ("i want a poster" still creates: no the/this/…).
  const elementRef = /\b(the|this|that|these|those|existing|current|selected)\s+(\w+\s+){0,2}(title|headline|subtitle|texts?|logo|icon|image|images?|photo|picture|shape|element|background|border|caption|body|copy|button|card|badge|label|grid|rows?|columns?|lines?|boxes?|circles?|cup|price|prices|tagline|posters?|flyers?|menus?|banners?|thumbnails?|decks?|presentations?|slides?|infographics?|graphics?|newsletters?|brochures?|covers?|headers?|posts?|stories|story|reels?|design|layout)\b/
  const editingExisting = editVerb.test(lower) && elementRef.test(lower)
  if (artifactNoun.test(lower) && buildVerb.test(lower) && !asksQuestion && !editingExisting) {
    return { mode: 'create', confidence: 'high' }
  }

  // discuss: about the tool/product itself, not the user's design
  // v0.32.7: the product guard's verb set grows with the write-verb
  // family — "improve the app" / "update your code" are product
  // requests and must stay conversations even though improve/update
  // are now first-class write verbs for DESIGNS. Product nouns and
  // artifact nouns never overlap (app/code/repo vs poster/logo…),
  // the brand may sit between article and noun ("fix the Canvix
  // agent"), and a product noun followed by a DESIGN noun ("change
  // the app icon") is an element edit, not product talk.
  const productWords = /\b(canvix|the (app|editor|product|repo|codebase)|your (architecture|agent|tools?|code)|this project|github)\b/
  const asksAboutProduct = productWords.test(lower) && /\b(how (does|do|is|are)|why|bug|broken|error|architecture|implemented|feature|work)s?\b/.test(lower)
  const fixTheProduct =
    /\b(fix|improve|update|redo|rework|revamp|change) (the|your|my|this|that) (canvix )?(agent|editor|app|code|codebase|bug|repo|product|backend|frontend|server|api|site)(?! (icon|image|images?|logo|title|titles?|texts?|elements?|buttons?|cards?|photos?|pictures?|shapes?|stickers?|badges?|labels?|backgrounds?|banners?|headers?|illustrations?))\b/.test(lower) ||
    /\bfix (the|your) (canvix )?(agent|editor|app|code|bug)\b/.test(lower) ||
    /\bagent'?s? (tool|loop|architecture)\b/.test(lower)
  if (asksAboutProduct || fixTheProduct) return { mode: 'discuss', confidence: 'high' }

  // review: critique/feedback asks — never modify
  // v0.32.2: "What is wrong with this design?" (no apostrophe) joins
  // "what's wrong" — the reproduction report showed it falling past
  // this guard into the model router
  if (/\b(what(?:['’]?s| is) wrong|what(?:['’]?s| is) (the problem|missing)|critique|review|feedback|rate|score|assess|evaluate|how does (this|it) look)\b/.test(lower)) {
    return { mode: /\band (fix|improve|change)\b/.test(lower) ? 'improve' : 'review', confidence: 'high' }
  }

  // explain: questions about the current design or editor features
  if (
    (/\b(what (font|color|size|element)s?|which font|how many (elements|pages|texts)|what does (this|the))\b/.test(lower) &&
      (lower.endsWith('?') || lower.includes('what'))) ||
    /^how (does|do|can) .+(work|function)\b.*\??$/.test(lower) // "how does gradient editing work?"
  ) {
    return { mode: 'explain', confidence: 'high' }
  }

  // plan: explicit planning asks
  if (/\b(plan|propose|outline|design spec|how would you (redesign|approach))\b/.test(lower) && !/\b(then do it|and apply|then apply)\b/.test(lower)) {
    return { mode: 'plan', confidence: 'high' }
  }

  // improve: polish/make-professional requests on an existing design
  // v0.32.7 (production report, the JNV Baramula session): "fix it",
  // "fix the design it looks like shit", "improve it", "make it look
  // cool", "it doesn't look cool …" — the ENTIRE fix-family routed
  // nowhere deterministically. It reached the model router, and on a
  // provider outage the catch kept the catch-all: DISCUSS. A user who
  // watches a broken design and asks for a fix during an outage got a
  // product chat that touched nothing. The fix-family improves the
  // WHOLE artifact (the intent classifier decides the per-message
  // intent — add/refine/restyle — inside the run):
  if (
    /\b(make (this|it|that) (more )?(professional|better|prettier|nicer|polished|cooler|cool|good|great|awesome)|polish|clean up|refine|jazz|spice|tighten)\b/.test(lower) ||
    /\b(fix|improve|redo|rework|revamp) (it|this|that|them|everything|up)\b/.test(lower) ||
    /\b(fix|improve|redo|rework|revamp) (the|my|our|this|that) (design|poster|flyer|banner|menu|deck|presentation|slides?|infographic|cards?|graphics?|layout|page|canvas|look|feel|branding)\b/.test(lower) ||
    /\bfix (the )?(design|poster|flyer|layout)\b/.test(lower) ||
    /\bmake (this|it|that) look (better|cooler|nicer|good|great|cool|professional|prettier)\b/.test(lower) ||
    /\b(doesn'?t|does not|don'?t|didn'?t|not) look (good|great|cool|nice|professional|right|appealing)\b/.test(lower) ||
    /\blooks? (bad|terrible|awful|boring|plain|ugly|horrible|like (shit|crap|garbage|ass))\b/.test(lower) ||
    /\bredesign\b/.test(lower)
  ) {
    return { mode: 'improve', confidence: 'high' }
  }

  // create: build briefs. Artifact nouns make intent unambiguous —
  // "make a poster" is create even though "make" is also a surgical
  // edit verb ("make the title bold"). (artifactNoun is declared in
  // the v0.29.3 create-first guard at the top of this function.)
  // v0.32.2: editingExisting ("make the poster title bold") is exempt
  // here too — an artifact noun inside an existing-element reference
  // is still an edit.
  if (artifactNoun.test(lower) && m.split(/\s+/).length >= 2 && !editingExisting && !interrogative) {
    return { mode: 'create', confidence: 'high' }
  }
  const createSignals = [
    /\b(design|create|make|build|generate)\b.*\b(a|an|me|the|some)\b/,
    /\bcomplete redesign\b|\brebrand\b|\bmakeover\b/,
  ]
  if (createSignals.filter((re) => re.test(lower)).length >= 1 && m.split(/\s+/).length >= 3) {
    // "make X bold" is edit, not create — surgical verbs on a short
    // message. v0.32.2 (defect A): the STYLING ADJECTIVES
    // (bold/italic/underline/bigger/smaller) are gone from this list —
    // "Design a bold Instagram post" describes a NEW artifact's style,
    // it does not ask to bold anything. An adjective alone must never
    // be edit evidence; the verb carries the intent ("make … bold").
    const surgical =
      editVerb.test(lower) && m.split(/\s+/).length <= 18
    const mentionsBuilding = /\b(from scratch|new|blank)\b/.test(lower)
    if (!surgical || mentionsBuilding) return { mode: 'create', confidence: 'high' }
  }

  // edit: surgical single-element changes
  // v0.32.2: same adjective removal — edit evidence is a VERB
  // ("make/move/change …"), never a styling adjective
  if (editVerb.test(lower) && m.split(/\s+/).length <= 25) return { mode: 'edit', confidence: 'high' }

  return { mode: 'discuss', confidence: 'low' }
}

/** Design-domain vocabulary for the outage fallback below. Broad by
 *  design: a typo'd artifact noun ("posetr") must still count as a
 *  design request — none of these words belong in small talk. */
const DESIGN_DOMAIN_WORDS =
  /\b(designs?|designing|designed|posters?|flyers?|menus?|logos?|banners?|thumbnails?|decks?|presentations?|slides?|infographics?|cards?|graphics?|brochures?|newsletters?|stories|story|reels?|campaigns?|invitations?|adverts?|instagram|insta|tiktok|pinterest|linkedin|facebook|twitter|youtube|social[- ]media|canvas|pages?|elements?|texts?|titles?|headlines?|headings?|subtitles?|captions?|images?|photos?|pictures?|icons?|shapes?|stickers?|backgrounds?|colou?rs?|fonts?|typography|layouts?|spacing|margins?|borders?|buttons?|badges?|labels?|grids?|rows?|columns?|brands?|themes?|styles?|make|makes|made|create|creates|created|build|builds|built|add|adds|added|remove|removes|removed|delete|deletes|deleted|move|moves|moved|change|changes|changed|fix|fixes|fixed|fixing|improve|improves|improved|edit|edits|edited|update|updates|updated|adjust|adjusts|adjusted|tweak|tweaks|tweaked|redesign|redesigns|redesigned|polish|polished|refine|refines|refined|restyle|restyles|restyled|draw|draws|drawing|illustrations?|look|looks|looking)\b/

/** v0.32.7 · the provider-outage escape hatch. When the heuristic
 *  could not classify (confidence 'low' — it recognized no pattern)
 *  and the model router call FAILED (429/502/network, or unparseable
 *  output), the old code kept the heuristic catch-all: DISCUSS. So
 *  "fix my poster" during an outage became a product chat that
 *  touched nothing — the user watches a broken design and asks for
 *  a fix, the provider is down BECAUSE everyone is retrying, and
 *  the agent answers in paragraphs.
 *
 *  This deterministic fallback classifies by vocabulary + canvas
 *  state — no provider, no latency, no failure mode:
 *    · design-domain vocabulary + empty canvas    → create
 *      (nothing to damage; the plan-first gate governs the build)
 *    · design-domain vocabulary + elements exist  → edit
 *      (surgical: "touch only what the request implies" — the edit
 *      prompt degrades honestly on an empty canvas)
 *    · no design vocabulary                       → discuss
 *      (it really was conversation)
 */
export function fallbackMode(message: string, canvasHasElements: boolean): AgentMode {
  const m = message.trim()
  if (!m) return 'discuss'
  return DESIGN_DOMAIN_WORDS.test(m.toLowerCase()) ? (canvasHasElements ? 'edit' : 'create') : 'discuss'
}

/** System prompt for the model classifier (used when heuristics are
 *  unsure). Reply JSON {"mode": "…"}. */
export const ROUTER_SYSTEM =
  'You classify user messages to a graphic-design editor AI. Reply ONLY with JSON: {"mode":"create"|"edit"|"review"|"improve"|"explain"|"plan"|"discuss"}.\n' +
  'create = build a new design or a major rebuild from a brief (poster, deck, menu, campaign, Instagram/social post, "design me…").\n' +
  'edit = specific modifications to an existing design (make the title bold, move the logo, change this color). Styling words like "bold", "minimal", "elegant", "dark" or "colorful" describe the design being asked for — they are NOT edit evidence; a request for a new artifact ("a bold Instagram post") is create.\n' +
  'review = inspect and critique the design WITHOUT changing it (what is wrong, how does it look, rate it).\n' +
  'improve = apply professional refinements to the existing design (make it professional, polish it, fix the layout).\n' +
  'explain = answer a question about the current design or the editor (what font is this, how many pages).\n' +
  'plan = produce a plan/spec without applying it (propose a redesign, outline a deck).\n' +
  'discuss = conversation about Canvix the product (architecture, bugs, features) with no canvas work.\n' +
  'When unsure between create and edit, choose create only if the user asks for a new/rebuilt design; otherwise edit.'

/** Parse the classifier reply. Unreadable → null (caller keeps the
 *  heuristic mode). */
export function parseMode(raw: string): AgentMode | null {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
  const m = cleaned.match(/"mode"\s*:\s*"(create|edit|review|improve|explain|plan|discuss)"/)
  return m ? (m[1] as AgentMode) : null
}
