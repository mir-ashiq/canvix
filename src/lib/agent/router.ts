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
  edit: 'MODE: EDIT — perform the specific requested modifications. Touch only what the request implies; preserve everything else.',
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
  const artifactNoun =
    /\b(poster|flyer|menu|logo|banner|thumbnail|deck|presentation|slide|campaign|invitation|infographic|card|graphic|advert|ad|cover|header|brochure|certificate|resume|newsletter)\b/
  const buildVerb = /\b(design|create|make|build|generate|add|produce)\b/
  const asksQuestion = /\?\s*$/.test(m) || /^(how|why|what|when|which|who)\b/i.test(m)
  if (artifactNoun.test(lower) && buildVerb.test(lower) && !asksQuestion) {
    return { mode: 'create', confidence: 'high' }
  }

  // discuss: about the tool/product itself, not the user's design
  const productWords = /\b(canvix|the (app|editor|product|repo|codebase)|your (architecture|agent|tools?)|this project|github)\b/
  const asksAboutProduct = productWords.test(lower) && /\b(how (does|do|is|are)|why|bug|broken|error|architecture|implemented|feature|work)s?\b/.test(lower)
  const fixTheProduct = /\bfix (the|your) (agent|editor|app|code|bug)|\bagent'?s (tool|loop|architecture)\b/.test(lower)
  if (asksAboutProduct || fixTheProduct) return { mode: 'discuss', confidence: 'high' }

  // review: critique/feedback asks — never modify
  if (/\b(what'?s wrong|critique|review|feedback|rate|score|assess|evaluate|how does (this|it) look)\b/.test(lower)) {
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
  if (/\b(make (this|it) (more )?(professional|better|prettier|nicer|polished)|polish|clean up|refine|jazz|spice|tighten)\b/.test(lower)) {
    return { mode: 'improve', confidence: 'high' }
  }

  // create: build briefs. Artifact nouns make intent unambiguous —
  // "make a poster" is create even though "make" is also a surgical
  // edit verb ("make the title bold"). (artifactNoun is declared in
  // the v0.29.3 create-first guard at the top of this function.)
  if (artifactNoun.test(lower) && m.split(/\s+/).length >= 2) return { mode: 'create', confidence: 'high' }
  const createSignals = [
    /\b(design|create|make|build|generate)\b.*\b(a|an|me|the|some)\b/,
    /\bcomplete redesign\b|\brebrand\b|\bmakeover\b/,
  ]
  if (createSignals.filter((re) => re.test(lower)).length >= 1 && m.split(/\s+/).length >= 3) {
    // "make X bold" is edit, not create — single-element surgical verbs
    const surgical = /\b(make|set|change|turn|swap|move|align|center|centre|delete|remove|add|bold|italic|underline|bigger|smaller|recolor|recolour|rotate|flip)\b/.test(lower) && m.split(/\s+/).length <= 18
    const mentionsBuilding = /\b(from scratch|new|blank)\b/.test(lower)
    if (!surgical || mentionsBuilding) return { mode: 'create', confidence: 'high' }
  }

  // edit: surgical single-element changes
  const editSignals = /\b(make|set|change|turn|swap|move|align|center|centre|delete|remove|add|bold|italic|underline|bigger|smaller|recolor|recolour|rotate|flip|resize|rename|duplicate)\b/
  if (editSignals.test(lower) && m.split(/\s+/).length <= 25) return { mode: 'edit', confidence: 'high' }

  return { mode: 'discuss', confidence: 'low' }
}

/** System prompt for the model classifier (used when heuristics are
 *  unsure). Reply JSON {"mode": "…"}. */
export const ROUTER_SYSTEM =
  'You classify user messages to a graphic-design editor AI. Reply ONLY with JSON: {"mode":"create"|"edit"|"review"|"improve"|"explain"|"plan"|"discuss"}.\n' +
  'create = build a new design or a major rebuild from a brief (poster, deck, menu, campaign, "design me…").\n' +
  'edit = specific modifications to the existing design (make the title bold, move the logo, change this color).\n' +
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
