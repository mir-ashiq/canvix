/**
 * v0.32.5 · honest outcome classification — shared by the chat UI.
 *
 * The P0 run ended with zero elements after three infeasible plans,
 * yet the panel's verification line rendered with an emerald check
 * (or nothing at all): a failure was displayed as — or next to —
 * success. The classifier below lets the UI pick the honest tone:
 * failure markers → amber alert, otherwise the emerald check.
 *
 * PURE on purpose (no React, no db) so unit tests can pin it.
 */

/** Markers that appear ONLY in disclosed failure/partial outcomes —
 *  never in a clean success verification string. */
const FAILURE_MARKERS: readonly string[] = [
  'NOT completed',
  'NOT verified',
  'Visual critique UNAVAILABLE',
  'Visual critique unavailable',
  'disclosed, unfixed',
  'INCOMPLETE',
  'Infeasible',
  'infeasible',
  'Stopped after',
  'wrapped up',
  'INCOMPLETE —',
  'unmet',
  'Unmet',
  'failed',
  'Failed',
  'provider failed',
  'no design changes',
]

/** True when the text discloses a failure or partial outcome. */
export function isFailureOutcome(text: string | undefined | null): boolean {
  if (!text) return false
  return FAILURE_MARKERS.some((m) => text.includes(m))
}

/** The UI status of a finished agent turn: success, failure or none. */
export type TurnOutcome = 'success' | 'failure' | 'unknown'

/** Modes whose job is to change the design — a finished turn in one
 *  of these modes that applied nothing did not succeed. */
const CREATIVE_MODES: readonly string[] = ['create', 'improve']

export function turnOutcome(opts: {
  mode?: string
  verification?: string
  content?: string
  appliedActions?: number
}): TurnOutcome {
  // an explicit verification/content failure marker wins, whatever
  // the action count (a partial run that stopped honestly is a
  // failure to present accurately, not a success to gloss)
  if (isFailureOutcome(opts.verification) || isFailureOutcome(opts.content)) return 'failure'
  // a CREATE/IMPROVE turn that applied nothing and verified nothing
  // is not a success either. (review/discuss/explain turns apply
  // nothing BY DESIGN — they are judged by their markers only.)
  if (!opts.verification && CREATIVE_MODES.includes(opts.mode ?? '') && (opts.appliedActions ?? 0) === 0) {
    return 'failure'
  }
  if (opts.verification) return 'success'
  return 'unknown'
}
