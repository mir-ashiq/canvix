// ─────────────────────────────────────────────────────────────
// v0.14 (D3): even distribution — pure geometry.
//
// Shared by the store action (editor toolbar + undo/collab), the AI
// assistant / plugin path and the unit tests. No DOM, no store
// imports allowed in this file (the v06-geometry contract).
//
// Semantics = Canva/Figma "spacing": equal GAPS between element
// EDGES; the leftmost/topmost and rightmost/bottommost elements stay
// exactly where they are. Boxes already overlapping still distribute
// (the overlap is evened out) — we refuse nothing, matching the
// behaviour users know from Canva and Figma.
//
// Geometry uses the element's local box (x/y/width/height), the same
// simplification the page-align modes use; rotation is ignored for
// distribute exactly as it is for align (documented honestly here).
// Positions are rounded to integers per element (the document model
// is integer coordinates); the cursor walks in floats so rounding
// never accumulates drift — adjacent gaps may differ by ≤ 1 px.
// ─────────────────────────────────────────────────────────────

export type DistributeAxis = 'x' | 'y'

export interface DistributableBox {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Evenly distribute `boxes` along `axis`, keeping the extremes fixed
 * and equalizing the edge gaps between neighbours.
 *
 * Returns one {x, y} per input box, in INPUT order (patch only the
 * axis you distributed; the other coordinate is passed through
 * unchanged). For fewer than 3 boxes distribution is a no-op — the
 * input positions are returned verbatim (nothing to space evenly).
 */
export function distributeEvenly<T extends DistributableBox>(boxes: T[], axis: DistributeAxis): { x: number; y: number }[] {
  const n = boxes.length
  if (n < 3) return boxes.map((b) => ({ x: b.x, y: b.y }))

  const lead = (b: DistributableBox): number => (axis === 'x' ? b.x : b.y)
  const size = (b: DistributableBox): number => (axis === 'x' ? b.width : b.height)

  // sort indices by leading edge; ties keep input order (stable intent)
  const order = boxes
    .map((b, i) => ({ i, lead: lead(b), size: size(b) }))
    .sort((a, b) => a.lead - b.lead || a.i - b.i)

  const first = order[0]
  const last = order[n - 1]
  // span = leading edge of the last box to the FAR edge of the last box
  const span = last.lead + last.size - first.lead
  const sizes = order.reduce((s, e) => s + e.size, 0)
  // may be negative when the boxes overlap — that still distributes
  // (the overlap is evened out); NaN only if callers feed NaN boxes
  const gap = (span - sizes) / (n - 1)

  const out = boxes.map((b) => ({ x: b.x, y: b.y }))
  let cursor = first.lead
  for (const e of order) {
    out[e.i] =
      axis === 'x'
        ? { x: Math.round(cursor), y: boxes[e.i].y }
        : { x: boxes[e.i].x, y: Math.round(cursor) }
    cursor += e.size + gap
  }
  return out
}
