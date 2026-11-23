// ─────────────────────────────────────────────────────────────
// Agent router (v0.27) — one cheap classification call that keeps
// simple work cheap (tldraw request() vs prompt(); Anthropic's
// "don't default to agents").
//
//   act  → one completion with the tools spec → up to 3 actions
//   ask  → one completion, answer only, no tools
//   plan → the full agent loop
//
// The classifier is a model call with a tiny JSON contract. On any
// doubt (parse failure, provider error, timeout) it falls back to
// `plan` — the loop handles everything an `act` could, just slower.
// ─────────────────────────────────────────────────────────────

export type AgentIntent = 'act' | 'ask' | 'plan'

/** Heuristic pre-classifier — free, zero-latency. Runs BEFORE the model
 *  call; when it is confident (≥ 2 signals), the model call is skipped
 *  entirely. Returns null when unsure. */
export function heuristicIntent(message: string): AgentIntent | null {
  const m = message.trim().toLowerCase()
  if (!m) return null
  // questions about the design / advice
  const askSignals = [
    /^(what|why|how|which|when|where|who)\b/,
    /\b(is|are|do|does|can|should) (this|it|the|these)\b.*\?/,
    /\bwhat do you think\b/,
    /\breview (this|my)\b/,
    /\bfeedback\b.*\?/,
    /\bcritique\b/,
  ]
  if (askSignals.filter((re) => re.test(m)).length >= 1 && m.endsWith('?')) return 'ask'
  // multi-step briefs → plan
  const planSignals = [
    /\b(and|then|also|plus)\b.*\b(and|then|also|plus|with|including)\b/,
    /\b(design|create|make|build)\s+(a|an|me|the)\b/,
    /\bfull\b.*\b(layout|design|page)\b/,
    /\bposter\b.*\b(with|and|palette)\b/,
    /\blaunch\b.*\b(with|and|palette)\b/,
    /\bnew colors and fonts\b/,
    /\bcolors? and fonts?\b.*\b(new|change|swap)\b/,
  ]
  // strong plan intents fire on ONE match — a redesign/rebrand is
  // never a surgical edit no matter how it's phrased (harness catch)
  const strongPlan = /\b(complete|full|total)\s+(redesign|makeover|rebrand)\b|\brebrand\b|\bcomplete redesign\b/
  if (strongPlan.test(m) || planSignals.filter((re) => re.test(m)).length >= 2) return 'plan'
  // surgical single edits → act
  const actSignals = [
    /\b(make|set|change|turn|swap|move|align|center|centre|delete|remove|add|bold|italic|underline|bigger|smaller|recolor|recolour|color|colour)\b/,
    /^\s*(bold|italic|underline)\s+(this|it|the)\b/,
  ]
  if (actSignals.some((re) => re.test(m)) && m.split(/\s+/).length <= 18) return 'act'
  return null
}

/** System prompt for the model classifier. */
export const ROUTER_SYSTEM =
  'You classify user messages to a design-editor AI. Reply ONLY with JSON: {"intent":"act"|"ask"|"plan"}.\n' +
  'act = one surgical edit or 2-3 quick edits (change a color, make the title bold, add one text).\n' +
  'ask = a question or advice request about the design, expecting an answer not edits (review, what font is this, how does this look).\n' +
  'plan = a bigger brief needing several steps (design/redesign/rebrand/complete layouts, anything with multiple goals or "and" chains of edits).\n' +
  'When unsure between act and plan, choose plan.'

/** Parse the classifier reply. Anything unreadable → plan (safe default). */
export function parseIntent(raw: string): AgentIntent {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
  const m = cleaned.match(/"intent"\s*:\s*"(act|ask|plan)"/)
  return m ? (m[1] as AgentIntent) : 'plan'
}
