// ─────────────────────────────────────────────────────────────
// Deterministic Repair (v0.34) — the correction engine.
//
// Predictable design defects — text buried under opaque shapes,
// off-canvas elements, unreadable contrast, sliver-sized assets —
// are repaired IN CODE, not through LLM round-trips. The NEON 2027
// live repro terminated with 12 disclosed-unfixed issues; every
// one of them was mechanically repairable, and the model burned
// its idle window telling the user about them instead of a
// deterministic pass clearing them in milliseconds.
//
// The plan is PURE: (live design snapshot, audit issues) → actions.
// The loop applies them through the same bridge as model tool calls
// (undoable, acked against the authoritative canvas). Everything
// the audit classifies as a blocking issue but this engine cannot
// prove a fix for stays for the model's single fix round.
//
// What is NEVER touched:
//   · content — no text value, image or element is deleted or
//     rewritten; repairs only reorder, reposition and recolour
//   · locked elements (user-owned placement)
//   · intentional layering — card-behind-text is not a defect and
//     the covered-text detection mirrors the audit's own
//     intentional-layering logic (a contained, readable text on its
//     card is never flagged, so it is never "repaired")
//   · full-bleed backgrounds — only elements ENTIRELY outside the
//     canvas are clamped back in; deliberate bleed is preserved
// ─────────────────────────────────────────────────────────────

import type { AgentDesignCtx, AgentElementCtx } from './context'
import { parseColor } from './brief'
import { contrastRatio, effectiveBackdrop, box, coverage, type RGB } from './audit'

/** a DesignAction-shaped object (the loop's action event passes
 *  them through the bridge untouched — the same shapes the model's
 *  tools emit). */
export interface RepairAction {
  type: string
  [key: string]: unknown
}

export interface RepairPlan {
  actions: RepairAction[]
  /** one human-readable line per fix — the observation discloses
   *  exactly what the engine changed and why */
  notes: string[]
}

const EMPTY: RepairPlan = { actions: [], notes: [] }

function hex(c: RGB): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`
}

/** lighten/darken a colour by a fraction (deterministic ladder steps). */
function shade(c: RGB, f: number): RGB {
  return {
    r: f >= 0 ? c.r + (255 - c.r) * f : c.r * (1 + f),
    g: f >= 0 ? c.g + (255 - c.g) * f : c.g * (1 + f),
    b: f >= 0 ? c.b + (255 - c.b) * f : c.b * (1 + f),
    a: c.a,
  }
}

/** Plan the deterministic repairs for the audit's blocking issues.
 *  Pure: same snapshot + same issues → same actions, every time. */
export function planRepair(
  d: AgentDesignCtx | null | undefined,
  issues: string[],
): RepairPlan {
  if (!d || !issues.length) return EMPTY
  const els = d.elements ?? []
  if (!els.length) return EMPTY
  const W = d.width ?? 0
  const H = d.height ?? 0
  if (!W || !H) return EMPTY

  const actions: RepairAction[] = []
  const notes: string[] = []
  const fixed = new Set<string>()

  // which defect classes the audit actually reported — the engine
  // repairs what is proven broken, never speculatively
  const hasContrast = issues.some((i) => i.startsWith('Low contrast:'))
  const hasCoveredText = issues.some((i) => i.includes('is covered by'))
  const hasOffCanvas = issues.some((i) => i.includes('OFF the canvas'))
  const hasSliver = issues.some((i) => i.includes('is a sliver'))

  const pageBg =
    typeof d.background === 'string' && /^#[0-9a-fA-F]{6}$/.test(d.background) ? parseColor(d.background) : null

  // ── 1. covered text → reorder to front (z-order, deterministic) ──
  // text is content: a text ≥95% covered by a higher opaque element
  // is invisible; raising it restores it without moving anything.
  // (the audit's own intentional-layering logic already excludes
  // readable text-on-card pairs, so those never reach this path)
  if (hasCoveredText) {
    for (const t of els) {
      if (t.type !== 'text' || t.locked || fixed.has(t.id)) continue
      const idx = els.indexOf(t)
      for (let i = idx + 1; i < els.length; i++) {
        const cover = els[i]
        if (!cover || cover.type === 'text' || cover.locked) continue
        const fill = parseColor((cover as AgentElementCtx).fill ?? '')
        if (!fill || fill.a < 0.9) continue
        if (coverage(t, cover) >= 0.95) {
          actions.push({ type: 'reorderLayers', ids: [t.id], dir: 'front' })
          notes.push(`raised text "${String(t.text ?? '').slice(0, 24)}" (${t.id}) above ${cover.type}#${cover.id} — it was 100% covered`)
          fixed.add(t.id)
          break
        }
      }
    }
  }

  // ── 2. off-canvas elements → clamp inside the page ──────────
  // only elements ENTIRELY outside (the audit's own threshold):
  // deliberate full-bleed (a rect larger than the page, offset
  // negative for print bleed) is never flagged, never clamped.
  if (hasOffCanvas) {
    for (const e of els) {
      if (e.locked || fixed.has(e.id)) continue
      const b = box(e)
      if (!(b.x + b.w <= 0 || b.y + b.h <= 0 || b.x >= W || b.y >= H)) continue
      const nx = Math.min(Math.max(b.x, 24), Math.max(24, W - b.w - 24))
      const ny = Math.min(Math.max(b.y, 24), Math.max(24, H - b.h - 24))
      actions.push({ type: 'updateElements', ids: [e.id], patch: { x: Math.round(nx), y: Math.round(ny) } })
      notes.push(`moved ${e.type}#${e.id} back inside the page (${Math.round(b.x)},${Math.round(b.y)} → ${Math.round(nx)},${Math.round(ny)})`)
      fixed.add(e.id)
    }
  }

  // ── 3. unreadable text → deterministic fill ladder ──────────
  // candidates in order: white, black, then ±25%/±50% shades of the
  // authored fill (keeps the design's palette when possible). The
  // first candidate clearing the audit's own WCAG need wins.
  if (hasContrast) {
    for (const t of els) {
      if (t.type !== 'text' || t.locked || fixed.has(t.id)) continue
      const fill = parseColor(t.fill ?? '')
      if (!fill) continue
      const backdrop = effectiveBackdrop(t, els, pageBg)
      if (!backdrop) continue
      const need = (t.fontSize ?? 0) >= 24 ? 3 : 4.5
      if (contrastRatio(fill, backdrop) >= need) continue
      const candidates: { hex: string; label: string }[] = [
        { hex: '#FFFFFF', label: 'white' },
        { hex: '#000000', label: 'black' },
        { hex: hex(shade(fill, 0.5)), label: `lighter ${hex(shade(fill, 0.5))}` },
        { hex: hex(shade(fill, 0.25)), label: `lighter ${hex(shade(fill, 0.25))}` },
        { hex: hex(shade(fill, -0.25)), label: `darker ${hex(shade(fill, -0.25))}` },
        { hex: hex(shade(fill, -0.5)), label: `darker ${hex(shade(fill, -0.5))}` },
      ]
      const winner = candidates.find((c) => {
        const cc = parseColor(c.hex)
        return cc ? contrastRatio(cc, backdrop) >= need : false
      })
      if (winner) {
        actions.push({ type: 'updateElements', ids: [t.id], patch: { fill: winner.hex.toUpperCase() } })
        notes.push(`recoloured text "${String(t.text ?? '').slice(0, 24)}" (${t.id}) to ${winner.hex.toUpperCase()} (${winner.label}) for contrast against its backdrop`)
        fixed.add(t.id)
      }
    }
  }

  // ── 4. sliver assets → minimum visible size (proportional) ──
  // an asset <8px on a side is a placement mistake; scale it up to
  // ≥24px keeping its aspect ratio and centre.
  if (hasSliver) {
    for (const e of els) {
      if (e.type === 'text' || e.locked || fixed.has(e.id)) continue
      const b = box(e)
      if (b.w >= 8 && b.h >= 8) continue
      const k = Math.max(24 / Math.max(b.w, 1), 24 / Math.max(b.h, 1), 1)
      const nw = Math.round(b.w * k)
      const nh = Math.round(b.h * k)
      const cx = b.x + b.w / 2
      const cy = b.y + b.h / 2
      actions.push({
        type: 'updateElements',
        ids: [e.id],
        patch: { width: nw, height: nh, x: Math.round(cx - nw / 2), y: Math.round(cy - nh / 2) },
      })
      notes.push(`resized ${e.type}#${e.id} from ${Math.round(b.w)}×${Math.round(b.h)} to ${nw}×${nh} — it was invisible`)
      fixed.add(e.id)
    }
  }

  return { actions, notes }
}
