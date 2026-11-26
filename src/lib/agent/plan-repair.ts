/**
 * v0.32.5 · DETERMINISTIC PLAN REPAIR — the P0 regression fix.
 *
 * The v0.32.4 hard validator REJECTED invalid plans and told the
 * model to redo the gap arithmetic. A model that cannot do that
 * arithmetic failed three times in a row and the run died with
 * ZERO elements ("Stopped after 3 consecutive invalid tool calls")
 * — on the panel's own coffee-launch suggestion. Forcing the model
 * to compute geometry is the bug: the SERVER computes it.
 *
 * This module is PURE (no db, no client, no model): given the
 * canvas, the 6% margins, the 40px minimum gap and the requested
 * sections, it deterministically produces a valid band layout —
 * or an honest infeasibility with the exact math. Never a
 * fabrication: heights, order and contents are the model's own;
 * only the y-positions and gaps are computed.
 *
 *   repairPlanBands(sections, H) →
 *     { ok: true,  bands, repairs, gap }   valid or repaired
 *     { ok: false, infeasible }            cannot fit — exact math
 */

export interface PlanSection {
  name: string
  y: number
  h: number
}

export interface RepairedBand {
  name: string
  y: number
  h: number
}

export interface PlanRepairOk {
  ok: true
  /** valid bands, ordered top-to-bottom, all inside the safe area */
  bands: RepairedBand[]
  /** the gap actually used between consecutive bands (≥ minGap) */
  gap: number
  /** human-readable disclosures — EMPTY when the plan was already valid */
  repairs: string[]
}

export interface PlanRepairInfeasible {
  ok: false
  /** the exact math, for the model AND the UI — never a vague "try again" */
  infeasible: string
}

export type PlanRepairResult = PlanRepairOk | PlanRepairInfeasible

export const PLAN_MIN_GAP = 40
export const PLAN_MARGIN = 0.06

/**
 * Deterministic layout solver.
 *
 * Rules, in order:
 *  1. A plan whose bands already tile the safe area top-to-bottom
 *     with ≥minGap gaps is accepted UNCHANGED (repairs = []).
 *  2. Otherwise the sections are re-laid out from the top of the
 *     safe area, in the model's intended order, with the requested
 *     heights and a uniform gap: max(minGap, leftover / (n-1)) —
 *     the natural composition the model meant to build.
 *  3. If the content cannot fit even at exactly minGap gaps, the
 *     result is INFEASIBLE with the exact numbers — the model must
 *     shrink heights or drop sections (its choice, its hierarchy).
 */
export function repairPlanBands(
  requested: PlanSection[],
  H: number,
  opts?: { minGap?: number; margin?: number },
): PlanRepairResult {
  const minGap = opts?.minGap ?? PLAN_MIN_GAP
  const margin = opts?.margin ?? PLAN_MARGIN
  const n = requested.length
  if (n === 0) {
    return { ok: false, infeasible: 'No sections to lay out.' }
  }
  // invalid heights are not geometry to repair — they are rejected
  // upstream by the tool; here they are clamped defensively
  const sections = requested
    .map((s) => ({ name: s.name || 'section', y: Math.max(0, s.y), h: Math.max(1, Math.round(s.h)) }))
    .sort((a, b) => a.y - b.y)

  const safeTop = Math.round(H * margin)
  const safeBottom = Math.round(H * (1 - margin))
  const usable = safeBottom - safeTop
  const sumH = sections.reduce((acc, s) => acc + s.h, 0)

  if (sumH > usable) {
    return {
      ok: false,
      infeasible:
        `Infeasible plan: the sections total ${sumH}px of content, but the safe area is only ${usable}px ` +
        `(page ${H}px, 6% margins top/bottom ${safeTop}px, ${H - safeBottom}px). ` +
        `Reduce the section heights or drop sections — the smallest fitting layout needs ≤${Math.floor(usable / n)}px per section.`,
    }
  }

  // Rule 1 — already valid? Keep the model's exact geometry.
  const valid =
    sections[0].y >= safeTop &&
    sections[n - 1].y + sections[n - 1].h <= safeBottom &&
    sections.every((s, i) => i === 0 || s.y - (sections[i - 1].y + sections[i - 1].h) >= minGap)
  if (valid) {
    return {
      ok: true,
      bands: sections.map((s) => ({ name: s.name, y: s.y, h: s.h })),
      gap: n > 1 ? sections[1].y - (sections[0].y + sections[0].h) : minGap,
      repairs: [],
    }
  }

  // Rule 2 — deterministic re-layout: requested heights, uniform
  // gap (minGap, or the natural spread when there is room).
  const gap = n > 1 ? Math.max(minGap, Math.floor((usable - sumH) / (n - 1))) : minGap
  const bands: RepairedBand[] = []
  const repairs: string[] = []
  let y = safeTop
  for (const s of sections) {
    bands.push({ name: s.name, y, h: s.h })
    if (s.y !== y) {
      repairs.push(`"${s.name}" y ${Math.round(s.y)}→${y}`)
    }
    y += s.h + gap
  }
  if (bands[n - 1].y + bands[n - 1].h <= safeBottom) {
    if (n > 1) repairs.push(`uniform ${gap}px gaps between all ${n} sections`)
    return { ok: true, bands, gap, repairs }
  }

  // Single band that still overflows the safe area (clamped h >
  // usable): shrink honestly with a disclosure.
  if (n === 1 && sumH > usable) {
    return {
      ok: false,
      infeasible: `Infeasible plan: the single section is ${sumH}px tall, but the safe area is only ${usable}px (page ${H}px).`,
    }
  }
  // unreachable for n ≥ 1 with sumH ≤ usable — kept for honesty
  return {
    ok: false,
    infeasible: `Infeasible plan: the sections (${sumH}px + gaps) cannot fit the ${usable}px safe area.`,
  }
}
