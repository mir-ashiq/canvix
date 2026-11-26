/**
 * v0.32.7 · CONTEXT-AWARE EDITING — what does this instruction
 * actually want to DO to the existing design?
 *
 * The defect (seen live): "Check the design for overlaps and fix
 * issues" was treated as an ADDITIVE instruction — the model planned
 * a full new composition and the plan solver tried to fit six new
 * sections onto a nearly-full canvas. Not every instruction on a
 * populated canvas adds content.
 *
 * classifyEditIntent() is a DETERMINISTIC keyword router (the same
 * philosophy as heuristicMode — no model call, no latency, testable):
 *
 *   create       empty canvas — build from scratch (plan required)
 *   add          add NEW content alongside what exists (plan the
 *                ADDITIONS into the free space, never on top)
 *   replace      swap specific elements for something else
 *   reposition   move/align existing elements (no plan — the layout
 *                already exists; planning sections here is noise)
 *   restyle      recolor / fonts / background / contrast / theme
 *                (no plan, no geometry)
 *   redesign     rebuild the composition from scratch (destructive:
 *                plan first, clearing needs confirmation)
 *   remove       delete elements (no plan)
 *   refine       polish/improve in place (default on a populated
 *                canvas when no verb matches — balance, audit-fix)
 *   review       read-only analysis
 */

import type { AgentDesignCtx } from './context'

export type EditIntent =
  | 'create'
  | 'add'
  | 'replace'
  | 'reposition'
  | 'restyle'
  | 'redesign'
  | 'remove'
  | 'refine'
  | 'review'

export interface IntentResult {
  intent: EditIntent
  /** one deterministic reason line, for tests + telemetry */
  reason: string
}

interface Rule {
  intent: Exclude<EditIntent, 'create'>
  /** matched against the lowercased message */
  re: RegExp
  /** rules earlier in the list win when several match */
  order: number
  reason: string
}

/** Ordered: the FIRST matching rule classifies the message. */
const RULES: Rule[] = [
  {
    intent: 'redesign',
    re: /\b(redesign|start over|start again|rebuild|recreate|re-?do|from scratch|completely different|overhaul)\b/,
    order: 1,
    reason: 'rebuild language',
  },
  {
    intent: 'remove',
    re: /\b(remove|delete|get rid of|erase|take (it|that|them) out|clear (it|that|them)( up)?|drop (it|that|them))\b/,
    order: 2,
    reason: 'removal language',
  },
  {
    intent: 'replace',
    re: /\b(replace|swap|substitute|change .{3,40} (to|into|with) .{3,40}|instead of\b.{3,40}\buse|make it a different)\b/,
    order: 3,
    reason: 'replacement language',
  },
  {
    intent: 'reposition',
    re: /\b(move|shift|nudge|reposition|center|centre|align|distribute|space (them|it|that)? ?out|spread out|raise|lower|bring (it|that) (up|down)|push (it|that) (up|down|left|right))\b/,
    order: 4,
    reason: 'positioning language',
  },
  {
    intent: 'review',
    re: /\b(review|check|audit|critique|inspect|look at|assess|feedback|issues?|problems?|wrong with|score|rate)\b/,
    order: 5,
    reason: 'review language',
  },
  {
    intent: 'restyle',
    re: /\b(recolou?r|colou?r|palette|font|typography|bold|italic|weight|theme|contrast|brighter|darker|background|fill|stroke|opacity|shade|tint|round(ed)? corners|restyle|style)\b/,
    order: 6,
    reason: 'styling language',
  },
  {
    intent: 'add',
    re: /\b(add|insert|put|place|include|append|also (add|make|create|put)|another|on top|underneath|below (it|that|the)|above (it|that|the)|next to|more (content|elements?|sections?|text|space|cards?))\b/,
    order: 7,
    reason: 'additive language',
  },
]

/** A "change <style-noun> to …" is a RESTYLE, not a replace — the
 *  target of the change is the look of an existing element, not its
 *  content ("change the font to Montserrat" restyles; "change the
 *  headline to 'Grand Opening'" replaces). */
const STYLE_NOUN_CHANGE_RE = /\bchange (the )?(font|colou?r|fill|stroke|background|palette|size|typeface|typography|style|weight|spacing|opacity)\b/

const REFINE_RE = /\b(improve|polish|refine|balance|fix|clean up|tidy|finish|complete|better|enhance|perfect)\b/

/** "check … and fix …" is a fix/refine, not a review — a check
 *  followed by an action verb wants the action done. */
function fixOverridesReview(message: string): boolean {
  return /\b(fix|repair|resolve|correct)\b/.test(message)
}

export function classifyEditIntent(message: string, design: AgentDesignCtx): IntentResult {
  const m = (message || '').toLowerCase().slice(0, 600)
  const populated = (design.elements ?? []).length > 0

  // an EMPTY canvas: every build instruction is a create
  if (!populated) {
    return { intent: 'create', reason: 'empty canvas' }
  }

  if (fixOverridesReview(m)) {
    return { intent: 'refine', reason: 'fix language on an existing design' }
  }

  for (const rule of RULES) {
    if (rule.re.test(m)) {
      if (rule.intent === 'replace' && STYLE_NOUN_CHANGE_RE.test(m)) {
        return { intent: 'restyle', reason: 'styling language (change <style-noun>)' }
      }
      return { intent: rule.intent, reason: rule.reason }
    }
  }

  if (REFINE_RE.test(m)) {
    return { intent: 'refine', reason: 'refinement language' }
  }

  // no verb matched: on a populated canvas the safe default is a
  // refinement of what exists (never an unrequested rebuild)
  return { intent: 'refine', reason: 'default on a populated canvas' }
}

/** Which intents still require a section plan before writes? */
export function intentRequiresPlan(intent: EditIntent): boolean {
  return intent === 'create' || intent === 'add' || intent === 'redesign'
}

/** The per-intent guidance injected into the system prompt (the
 *  agent knows what the user wants DONE, not just the mode). */
export function intentGuidance(intent: EditIntent): string {
  switch (intent) {
    case 'create':
      return 'CREATE: the canvas is empty — plan the full composition (plan_layout), then build section by section.'
    case 'add':
      return 'ADD: existing content stays. plan_layout is for YOUR ADDITIONS ONLY (the sections you are about to add), fitted by the server into the FREE space — never plan sections that describe existing content. Add around what is there, never on top of it.'
    case 'replace':
      return 'REPLACE: swap the named elements for the new content — update the existing element in place (update_elements / set_text_style / set_text_spans) or delete the target then add the replacement AT THE SAME POSITION. Do NOT re-plan the whole page; the rest of the design stays untouched.'
    case 'reposition':
      return 'REPOSITION: move/align the existing elements (move_elements / align_elements / distribute_elements). No plan_layout — the composition already exists; geometry only shifts.'
    case 'restyle':
      return 'RESTYLE: change colors, fonts, background or contrast of the EXISTING design (recolor / set_text_style / set_font / set_background). No plan_layout and no new sections — same content, new look.'
    case 'redesign':
      return 'REDESIGN: rebuild the composition from scratch. plan_layout first (the new full composition), then clear_page/delete_elements (the destructive gate will ask the user for approval) and rebuild. The stored brief still applies.'
    case 'remove':
      return 'REMOVE: delete the named elements (delete_elements — approval will be asked). Nothing else changes; no plan_layout.'
    case 'refine':
      return 'REFINE: polish what exists — fix overlaps, contrast, alignment, balance; complete missing pieces of the brief. No plan_layout unless you ADD whole new sections; work on the existing elements.'
    case 'review':
      return 'REVIEW: read-only — get_page_state, inspect, report findings with evidence. Do not modify the design.'
  }
}
