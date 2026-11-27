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
 * fabrication: order and contents are the model's own; only the
 * y-positions, the gaps and (since v0.32.8) the scaling of
 * oversized heights are computed.
 *
 *   repairPlanBands(sections, H) →
 *     { ok: true,  bands, repairs, gap }  valid, repaired or scaled
 *     { ok: false, infeasible }            cannot fit even at the
 *                                         56px floor — exact math
 *
 * v0.32.8 · the NEON 2027 incident: a reasonable 7-section poster
 * plan exceeded the safe area, the model could not redo the height
 * arithmetic in three attempts, and the run died with ZERO elements
 * ("ask the user for a smaller composition"). Heights are the
 * SERVER's job now too: an oversized plan is uniformly SCALED to
 * fit (each band floored at PLAN_MIN_BAND, the model's relative
 * hierarchy preserved) and the scaling is DISCLOSED in repairs.
 * Infeasible survives only for compositions that cannot fit even at
 * the floor — the honest stop nobody can scale their way out of.
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

/** v0.32.6 · an existing element's occupied vertical extent on the
 *  page (label = its text or type, for the canvas map disclosure). */
export interface OccupiedBand {
  y: number
  h: number
  label?: string
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
/** v0.32.8 · the smallest band the solver will ever produce. Below
 *  this a section cannot hold readable content (a real headline needs
 *  ≥40px; the audit flags body text under 14px) — the only plans that
 *  stay infeasible are the ones that cannot fit even at this floor. */
export const PLAN_MIN_BAND = 56

/** Merge raw occupied extents into disjoint bands. Two occupied
 *  extents closer than minGap merge: the sliver between them cannot
 *  host a new band, so it is occupied for planning purposes. */
export function mergeOccupied(raw: OccupiedBand[], minGap = PLAN_MIN_GAP): OccupiedBand[] {
  const bands = raw
    .filter((b) => b.h > 0)
    .map((b) => ({ y: Math.max(0, Math.round(b.y)), h: Math.round(b.h), label: b.label }))
    .sort((a, b) => a.y - b.y)
  const out: OccupiedBand[] = []
  for (const b of bands) {
    const last = out[out.length - 1]
    if (last && b.y - (last.y + last.h) < minGap) {
      // merge: keep the union extent and the earlier label
      const end = Math.max(last.y + last.h, b.y + b.h)
      last.h = end - last.y
      if (!last.label && b.label) last.label = b.label
    } else {
      out.push({ ...b })
    }
  }
  return out
}

/** The free intervals of [top, bottom] not covered by occupied
 *  bands — where new content may be planned. */
function freeIntervals(top: number, bottom: number, occupied: OccupiedBand[]): { y: number; h: number }[] {
  const free: { y: number; h: number }[] = []
  let cursor = top
  for (const b of occupied) {
    const start = Math.max(b.y, top)
    const end = Math.min(b.y + b.h, bottom)
    if (start > cursor) free.push({ y: cursor, h: start - cursor })
    if (end > cursor) cursor = end
  }
  if (bottom > cursor) free.push({ y: cursor, h: bottom - cursor })
  return free.filter((f) => f.h > 0)
}

/** "y 65–365 (headline)" — one map entry */
function mapEntry(b: { y: number; h: number; label?: string }): string {
  return `y ${Math.round(b.y)}–${Math.round(b.y + b.h)}${b.label ? ` (${b.label})` : ''}`
}

/**
 * Deterministic layout solver.
 *
 * Rules, in order:
 *  0. OCCUPIED CANVAS (v0.32.6): when existing elements are present
 *     they are the map — the sections are fitted into the FREE
 *     intervals between them (order preserved, ≥minGap gaps), never
 *     on top of anything. Sections that cannot fit anywhere shrink
 *     proportionally first (v0.32.8); only a layout that cannot fit
 *     even at the PLAN_MIN_BAND floor produces an INFEASIBLE result
 *     carrying the full occupancy map with the exact numbers.
 *  1. A plan whose bands already tile the safe area top-to-bottom
 *     with ≥minGap gaps is accepted UNCHANGED (repairs = []).
 *  2. Otherwise the sections are re-laid out from the top of the
 *     safe area, in the model's intended order, with the requested
 *     heights and a uniform gap: max(minGap, leftover / (n-1)) —
 *     the natural composition the model meant to build.
 *  3. OVERSIZED PLANS ARE SCALED, NOT REJECTED (v0.32.8): content
 *     taller than the safe area minus its gaps is uniformly scaled
 *     down to fit (each band floored at PLAN_MIN_BAND, relative
 *     heights kept, the scaling DISCLOSED) — the model never re-does
 *     height arithmetic. Only compositions that cannot fit even at
 *     the floor are infeasible, with the exact math and the maximum
 *     section count that DOES fit.
 */
export function repairPlanBands(
  requested: PlanSection[],
  H: number,
  opts?: { minGap?: number; margin?: number; occupied?: OccupiedBand[] },
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

  // ── Rule 0 · occupied canvas: fit into the FREE space ────────
  const occupied = mergeOccupied(opts?.occupied ?? [], minGap)
  if (occupied.length) {
    const free = freeIntervals(safeTop, safeBottom, occupied)
    const mapLine = occupied.map(mapEntry).join(', ')
    const freeLine = free.length ? free.map(mapEntry).join(', ') : 'nothing'
    // prefer ONE free interval that fits everything (natural spread)
    const fitsAll = free.filter((f) => f.h >= sumH + minGap * (n - 1))
    if (fitsAll.length) {
      const f = fitsAll[0]
      const gap = n > 1 ? Math.max(minGap, Math.floor((f.h - sumH) / (n - 1))) : minGap
      const bands: RepairedBand[] = []
      const repairs: string[] = []
      let y = f.y
      for (const s of sections) {
        bands.push({ name: s.name, y, h: s.h })
        if (s.y !== y) repairs.push(`"${s.name}" y ${Math.round(s.y)}→${y}`)
        y += s.h + gap
      }
      if (n > 1) repairs.push(`uniform ${gap}px gaps inside the free space y ${f.y}–${f.y + f.h}`)
      return { ok: true, bands, gap, repairs }
    }
    // no single interval fits all: first-fit across intervals in
    // order (still ≥minGap inside an interval, order preserved).
    // v0.32.8: a first-fit failure is not immediately infeasible —
    // the sections shrink proportionally (floored at PLAN_MIN_BAND,
    // up to 20 passes of ×0.88) until they fit the free space. Only
    // a layout that cannot fit even at the floor is infeasible.
    const firstFit = (secs: PlanSection[]): RepairedBand[] | null => {
      const out: RepairedBand[] = []
      let fi = 0
      let y = free.length ? free[0].y : safeTop
      let intervalEnd = free.length ? free[0].y + free[0].h : safeTop
      for (const s of secs) {
        // advance to an interval with room for this section
        while (fi < free.length && y + s.h > intervalEnd) {
          fi += 1
          if (fi < free.length) {
            y = free[fi].y
            intervalEnd = free[fi].y + free[fi].h
          } else break
        }
        if (y + s.h > intervalEnd) return null
        out.push({ name: s.name, y, h: s.h })
        y += s.h + minGap
      }
      return out
    }
    let attempt = sections
    let fit = firstFit(attempt)
    for (let pass = 0; !fit && pass < 20; pass++) {
      const shrunk = attempt.map((s) => ({ ...s, h: Math.max(PLAN_MIN_BAND, Math.floor(s.h * 0.88)) }))
      if (shrunk.every((s, i) => s.h === attempt[i].h)) break // already at the floor
      attempt = shrunk
      fit = firstFit(attempt)
    }
    if (!fit) {
      return {
        ok: false,
        infeasible:
          `Infeasible plan on an occupied canvas: existing elements occupy ${mapLine}; ` +
          `free space: ${freeLine}. Your ${n} sections (${sumH}px of content) do not fit the free space ` +
          `(the largest free interval is ${free.length ? Math.max(...free.map((f) => f.h)) : 0}px) even scaled to the ${PLAN_MIN_BAND}px minimum band. ` +
          `Move or clear existing elements first, or plan fewer sections.`,
      }
    }
    const repairs: string[] = []
    fit.forEach((b, i) => {
      if (sections[i].y !== b.y) repairs.push(`"${b.name}" y ${Math.round(sections[i].y)}→${b.y}`)
      if (sections[i].h !== b.h) repairs.push(`"${b.name}" h ${sections[i].h}→${b.h} (scaled to fit the free space)`)
    })
    return { ok: true, bands: fit, gap: minGap, repairs }
  }

  // ── Rule 3 · v0.32.8 · oversized plans are SCALED to fit ─────
  const budget = usable - minGap * (n - 1)
  let scaled = false
  let eff = sections
  const repairs: string[] = []
  if (sumH > budget) {
    const scale = budget / sumH
    const scaledSections = sections.map((s) => ({
      name: s.name,
      y: s.y,
      h: Math.max(PLAN_MIN_BAND, Math.round(s.h * scale)),
    }))
    const sumScaled = scaledSections.reduce((acc, s) => acc + s.h, 0)
    if (sumScaled > budget) {
      const floorSum = sections.reduce((acc, s) => acc + Math.min(s.h, PLAN_MIN_BAND), 0)
      const maxSections = Math.floor((usable + minGap) / (PLAN_MIN_BAND + minGap))
      return {
        ok: false,
        infeasible:
          `Infeasible plan: ${n} sections at the ${PLAN_MIN_BAND}px minimum band (${floorSum}px) plus ${minGap}px gaps ` +
          `(≥ ${floorSum + minGap * (n - 1)}px) cannot fit the ${usable}px safe area (page ${H}px, 6% margins top/bottom ` +
          `${safeTop}px, ${H - safeBottom}px) — at most ${maxSections} sections fit this page. Drop sections; scaling cannot rescue this composition.`,
      }
    }
    scaled = true
    eff = scaledSections
    repairs.push(
      `section heights scaled ×${scale.toFixed(2)} to fit the ${usable}px safe area (${sumH}px → ${sumScaled}px, floors at ${PLAN_MIN_BAND}px)`,
    )
    sections.forEach((s, i) => {
      if (s.h !== eff[i].h) repairs.push(`"${s.name}" h ${s.h}→${eff[i].h}`)
    })
  }

  // Rule 1 — already valid (and never scaled)? Keep the model's exact geometry.
  if (!scaled) {
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
  }

  // Rule 2 — deterministic re-layout: (possibly scaled) heights,
  // uniform gap (minGap, or the natural spread when there is room).
  const sumEff = eff.reduce((acc, s) => acc + s.h, 0)
  const gap = n > 1 ? Math.max(minGap, Math.floor((usable - sumEff) / (n - 1))) : minGap
  const bands: RepairedBand[] = []
  let y = safeTop
  for (const s of eff) {
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

  // unreachable for n ≥ 1 with the scaled content ≤ budget — kept
  // for honesty: the solver must never claim a fit it cannot prove.
  return {
    ok: false,
    infeasible: `Infeasible plan: the sections (${sumEff}px + gaps) cannot fit the ${usable}px safe area.`,
  }
}
