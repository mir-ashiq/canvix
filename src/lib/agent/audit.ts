/**
 * v0.29.3 QUALITY AUDIT — local design heuristics the agent runs on its
 * own canvas before accepting completion. No model calls, no vision:
 * WCAG 2.x contrast math, per-text EFFECTIVE backgrounds (z-order aware,
 * rgba-composited — intentional text-on-card layering is preserved, not
 * flagged), obscuring-shape detection, real client-measured text widths,
 * and decorative color-strip detection. The loop consumes the returned
 * issues in ONE auto-fix round (see loop.ts); empty = clean.
 *
 * v0.29 → v0.29.3 changes (the failed CANVIX production run):
 *  · the page background is the ctx's REAL `background` field only —
 *    never a guessed "dominant" in-use color (the old guess made
 *    contrast checks fire against the wrong backdrop);
 *  · contrast is computed per text against what is actually BEHIND it
 *    (semi-transparent panels are alpha-composited onto the page), so
 *    text on a glass card is judged against the card, not the page;
 *  · elements ABOVE a text that cover it (z-order, opaque) are
 *    reported as obscured — a present element is not a visible one;
 *  · text overflow uses the CLIENT-MEASURED pixel width (canvas
 *    measureText) when available — the 0.58×fontSize glyph-average
 *    formula is only a last-resort estimate and is labeled as such;
 *  · required colors used ONLY as bare decorative strips are flagged
 *    (strips satisfy the color check but are not design).
 */
import type { AgentDesignCtx, AgentElementCtx } from './context'
import { parseColor } from './brief'
import { elementBoxes, intentionalOverlaps, isIntentional, hierarchyLines } from './spatial'

const HEX = /^#?[0-9a-f]{6}$/i

interface RGB {
  r: number
  g: number
  b: number
  a: number
}

/** WCAG 2.x relative luminance of a parsed color (0..1). */
function luminance(c: RGB): number {
  const channel = (v: number) => {
    const x = v / 255
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
}

/** WCAG contrast ratio (1..21). */
function contrastRatio(fg: RGB, bg: RGB): number {
  const lf = luminance(fg)
  const lb = luminance(bg)
  return (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05)
}

/** Alpha-composite src over dst (both may carry alpha). */
function blend(src: RGB, dst: RGB): RGB {
  const a = src.a + dst.a * (1 - src.a)
  if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 }
  return {
    r: (src.r * src.a + dst.r * dst.a * (1 - src.a)) / a,
    g: (src.g * src.a + dst.g * dst.a * (1 - src.a)) / a,
    b: (src.b * src.a + dst.b * dst.a * (1 - src.a)) / a,
    a,
  }
}

function toHex(c: RGB): string {
  const h = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`
}

function box(e: AgentElementCtx) {
  return { x: e.x ?? 0, y: e.y ?? 0, w: e.width ?? 0, h: e.height ?? 0 }
}

/** Fraction of `inner`'s area covered by `outer`'s bounds. */
function coverage(inner: AgentElementCtx, outer: AgentElementCtx): number {
  const a = box(inner)
  const b = box(outer)
  if (a.w <= 0 || a.h <= 0) return 0
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  return (ix * iy) / (a.w * a.h)
}

/** The backdrop a text actually sits on: page background with every
 *  semi-transparent covering element BELOW the text composited on top
 *  (z-order = array order, bottom first). Preserves text-on-card. */
function effectiveBackdrop(text: AgentElementCtx, els: AgentElementCtx[], pageBg: RGB | null): RGB | null {
  const idx = els.indexOf(text)
  let acc: RGB | null = pageBg
  for (let i = 0; i < idx; i++) {
    const el = els[i]
    if (el.type === 'text') continue // text under text doesn't form a backdrop
    const fill = parseColor(el.fill)
    if (!fill) continue
    // only shapes that actually sit under (cover ≥70% of) the text
    if (coverage(text, el) < 0.7) continue
    acc = acc ? blend(fill, acc) : fill
  }
  return acc
}

/** Worst N issues, human-readable and FIXABLE (the model acts on these). */
export interface PlanBand {
  name: string
  y: number
  h: number
}

export function auditDesign(
  d: AgentDesignCtx,
  brief?: { requiredColors?: { hex: string; tier?: string }[] } | null,
  planBands?: PlanBand[],
): string[] {
  const issues: string[] = []
  const els = d.elements ?? []
  const texts = els.filter((e) => e && e.type === 'text')

  // the REAL page background — hex only; no dominant-color guessing.
  // When the page has no parseable solid background the page-level
  // contrast check is skipped (the per-text backdrop still works when
  // a card sits behind the text).
  const pageBg = typeof d.background === 'string' && HEX.test(d.background) ? parseColor(d.background) : null

  // 1. text contrast against each text's EFFECTIVE backdrop (text on
  //    a card is checked against the card — intentional layering)
  let contrastHits = 0
  for (const t of texts) {
    const fill = parseColor(t.fill)
    if (!fill) continue
    const backdrop = effectiveBackdrop(t, els, pageBg)
    if (!backdrop) continue
    const effText = fill.a < 1 ? blend(fill, backdrop) : fill
    const ratio = contrastRatio(effText, backdrop)
    if (ratio <= 0) continue
    const size = typeof t.fontSize === 'number' ? t.fontSize : 0
    const need = size >= 24 ? 3 : 4.5
    if (ratio < need) {
      contrastHits += 1
      if (contrastHits <= 4) {
        issues.push(
          `Low contrast: text "${String(t.text ?? '').slice(0, 30)}" ${String(t.fill)} on its effective backdrop ${toHex(backdrop)} is ${ratio.toFixed(1)}:1 (needs ${need}:1) — change the text fill or the card behind it.`,
        )
      }
    }
  }
  if (contrastHits > 4) issues.push(`…and ${contrastHits - 4} more low-contrast text elements.`)

  // 2. OBSCURED text: an opaque-ish element ABOVE a text covering ≥50%
  //    of it — structurally present but not visible (v0.29.3)
  for (const t of texts) {
    const idx = els.indexOf(t)
    for (let i = idx + 1; i < els.length; i++) {
      const el = els[i]
      if (el.type === 'text') continue
      const fill = parseColor(el.fill)
      if (!fill || fill.a < 0.5) continue
      const cov = coverage(t, el)
      if (cov >= 0.5) {
        issues.push(
          `Text "${String(t.text ?? '').slice(0, 30)}" is covered by ${el.type}#${el.id} (${Math.round(cov * 100)}% of it) — move the shape below the text (reorder_layers) or move one of them.`,
        )
        break
      }
    }
  }

  // 3. element overlaps (client-computed) — hard readability failures.
  //    v0.32.7: INTENTIONAL layering is not a defect — spatial.ts
  //    classifies container/backdrop/backing-card pairs (a card
  //    behind its text is layering); only GENUINE collisions remain.
  if (d.overlaps?.length) {
    const intentional = intentionalOverlaps(elementBoxes(d), d.width ?? 1080, d.height ?? 1080)
    const genuine = (d.overlaps ?? []).filter((o) => {
      const ids = [...o.matchAll(/#([\w-]+)/g)].map((m) => m[1])
      if (ids.length !== 2) return true // unparseable — keep the finding
      return !isIntentional(intentional, ids[0], ids[1])
    })
    for (const o of genuine.slice(0, 3)) issues.push(`Elements overlap: ${o} — move or resize one of them.`)
    if (genuine.length > 3) issues.push(`…and ${genuine.length - 3} more overlapping pairs.`)
  }

  // 4. off-canvas elements
  for (const o of (d.offCanvas ?? []).slice(0, 3)) issues.push(`Element is outside the canvas: ${o} — move it back inside ${d.width ?? '?'}x${d.height ?? '?'}.`)
  if ((d.offCanvas ?? []).length > 3) issues.push(`…and ${(d.offCanvas ?? []).length - 3} more off-canvas elements.`)

  // 5. text overflow — REAL client-measured width when the panel sent
  //    it (canvas measureText, the same pipeline the renderer uses);
  //    the glyph-average estimate only when it did not, labeled as such
  let overflowHits = 0
  for (const t of texts) {
    const text = String(t.text ?? '')
    const size = typeof t.fontSize === 'number' ? t.fontSize : 0
    const width = typeof t.width === 'number' ? t.width : 0
    if (!text || size < 8 || width <= 0) continue
    const measured = typeof t.measuredWidth === 'number' && t.measuredWidth > 0 ? t.measuredWidth : null
    const est = measured ?? text.length * 0.58 * size
    const tag = measured ? 'measured' : 'estimated'
    if (est > width * 1.06) {
      overflowHits += 1
      if (overflowHits <= 3) {
        issues.push(
          `Text overflows its box: "${text.slice(0, 30)}" (${tag} ${Math.round(est)}px at ${size}px, box is ${Math.round(width)}px) — reduce fontSize, shorten the text, or widen the box. Call measure_text for exact numbers.`,
        )
      }
    }
  }
  if (overflowHits > 3) issues.push(`…and ${overflowHits - 3} more overflowing text elements.`)

  // 6. tiny text — illegible at presentation size
  const tiny = texts.filter((t) => typeof t.fontSize === 'number' && t.fontSize > 0 && t.fontSize < 14)
  if (tiny.length) issues.push(`${tiny.length} text element(s) use fontSize under 14 — too small to read; raise them to at least 14.`)

  // 7. decorative color strips: a required color that appears ONLY as
  //    bare strips (thin bars with nothing on them) satisfies the color
  //    check without being design — flag it (v0.29.3)
  const required = (brief?.requiredColors ?? []).filter((c) => !c.tier || c.tier === 'mandatory')
  for (const req of required) {
    const want = parseColor(req.hex)
    if (!want) continue
    let realUse = 0
    let stripUse = 0
    let stripExample = ''
    if (pageBg && Math.round(pageBg.r) === Math.round(want.r) && Math.round(pageBg.g) === Math.round(want.g) && Math.round(pageBg.b) === Math.round(want.b)) {
      realUse += 1 // the page background itself is the best use
      continue
    }
    for (const el of els) {
      const fill = parseColor(el.fill)
      const stroke = parseColor(el.stroke)
      const usesIt = (c: RGB | null) => c && Math.round(c.r) === Math.round(want.r) && Math.round(c.g) === Math.round(want.g) && Math.round(c.b) === Math.round(want.b)
      if (!usesIt(fill) && !usesIt(stroke)) continue
      if (el.type === 'text') {
        realUse += 1
        continue
      }
      const w = el.width ?? 0
      const h = el.height ?? 0
      const thin = (w > 0 && h > 0 && (w / h >= 6 || h / w >= 6)) || h <= 56 || w <= 56
      const carriesText = texts.some((t) => coverage(t, el) >= 0.4)
      if (thin && !carriesText) {
        stripUse += 1
        if (!stripExample) stripExample = `${el.type}#${el.id} (${Math.round(w)}x${Math.round(h)})`
      } else {
        realUse += 1
      }
    }
    if (realUse === 0 && stripUse > 0) {
      issues.push(
        `Required color ${req.hex.toUpperCase()} appears only as a bare decorative strip (${stripExample}) — use it as the page background, a text fill, or a real panel/card fill instead.`,
      )
    }
  }

  // 8. DUPLICATE TEXT (v0.32.4): the same normalized text twice with
  //    boxes that overlap or centers within 80px — the near-twin the
  //    live coffee run left behind (a human had to remove it).
  //    Distant repeats (page furniture, repeated distant labels) are
  //    intentional and NOT flagged — proximity is the discriminator.
  const norm = (t: string | undefined) => String(t ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  let dupTextHits = 0
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i]
      const b = texts[j]
      const na = norm(a.text)
      if (!na || na !== norm(b.text)) continue
      const ba = box(a)
      const bb = box(b)
      const cx = (e: { x: number; y: number; w: number; h: number }) => ({ x: e.x + e.w / 2, y: e.y + e.h / 2 })
      const ca = cx(ba)
      const cb = cx(bb)
      const near = Math.hypot(ca.x - cb.x, ca.y - cb.y) < 80
      const overlapped = coverage(a, b) > 0.2 || coverage(b, a) > 0.2
      if (!near && !overlapped) continue
      dupTextHits += 1
      if (dupTextHits <= 3) {
        issues.push(
          `Duplicate text: "${na.slice(0, 30)}" exists twice (text#${a.id} at (${Math.round(ba.x)},${Math.round(ba.y)}) and text#${b.id} at (${Math.round(bb.x)},${Math.round(bb.y)})) — delete one (delete_elements) or move the other where it belongs.`,
        )
      }
    }
  }
  if (dupTextHits > 3) issues.push(`…and ${dupTextHits - 3} more duplicate text pairs.`)

  // 9. DUPLICATE SHAPES (v0.32.4): same type + same size (±2px) +
  //    same fill + centers within 24px — a layered twin, almost
  //    always a re-add artifact. Repeated cards at different x are
  //    intentional and pass (their centers are far apart).
  const shapes = els.filter((e) => e && e.type !== 'text')
  let dupShapeHits = 0
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i]
      const b = shapes[j]
      if (a.type !== b.type) continue
      const fa = a.fill ?? ''
      const fb = b.fill ?? ''
      if (fa !== fb) continue
      const ba = box(a)
      const bb = box(b)
      if (Math.abs(ba.w - bb.w) > 2 || Math.abs(ba.h - bb.h) > 2) continue
      if (Math.hypot(ba.x - bb.x, ba.y - bb.y) > 24) continue
      dupShapeHits += 1
      if (dupShapeHits <= 2) {
        issues.push(
          `Duplicate shape: ${a.type}#${a.id} and ${b.type}#${b.id} are stacked at the same position with the same size and fill — delete one (delete_elements; approval will be asked).`,
        )
      }
    }
  }

  // 10. TEXT IN THE MARGIN (v0.32.4, advisory): text hugging a page
  //     edge by >40px inside the 6% margin zone — a readability
  //     risk, not a hard failure (shapes may full-bleed by design).
  if (d.width && d.height) {
    const mx = d.width * 0.06
    const my = d.height * 0.06
    let marginHits = 0
    for (const t of texts) {
      const b = box(t)
      const intrusions: string[] = []
      if (b.x < mx - 40) intrusions.push(`left (x=${Math.round(b.x)}, safe ≥ ${Math.round(mx)})`)
      if (b.y < my - 40) intrusions.push(`top (y=${Math.round(b.y)}, safe ≥ ${Math.round(my)})`)
      if (b.x + b.w > d.width! - mx + 40) intrusions.push(`right (ends ${Math.round(b.x + b.w)}, safe ≤ ${Math.round(d.width! - mx)})`)
      if (b.y + b.h > d.height! - my + 40) intrusions.push(`bottom (ends ${Math.round(b.y + b.h)}, safe ≤ ${Math.round(d.height! - my)})`)
      if (intrusions.length) {
        marginHits += 1
        if (marginHits <= 2) {
          issues.push(`Text "${String(t.text ?? '').slice(0, 24)}" sits deep inside the page margin: ${intrusions.join(', ')} — move it into the safe area.`)
        }
      }
    }
  }

  // 11. PLAN ADHERENCE (v0.32.4): every planned section band should
  //     hold at least one element — an empty band means the build
  //     diverged from the validated plan (missing section).
  if (planBands?.length) {
    let emptyBands = 0
    for (const band of planBands) {
      const has = els.some((e) => {
        const b = box(e)
        const iy = Math.max(0, Math.min(b.y + b.h, band.y + band.h) - Math.max(b.y, band.y))
        return iy > 0
      })
      if (!has) {
        emptyBands += 1
        if (emptyBands <= 3) {
          issues.push(`Planned section "${band.name}" (y ${Math.round(band.y)}..${Math.round(band.y + band.h)}) is empty — build it, or the canvas no longer matches the plan.`)
        }
      }
    }
  }

  // 12. ALIGNMENT (v0.32.7): wide text elements (≥30% page width)
  //     that claim to span the content column should sit centered
  //     (x-center within 12px of the page center) — advisory, not
  //     a hard failure (asymmetric layouts are legitimate).
  if (d.width) {
    const cx = d.width / 2
    const misaligned: string[] = []
    for (const t of texts) {
      const b = box(t)
      if (b.w < 0.3 * d.width!) continue
      const c = b.x + b.w / 2
      if (Math.abs(c - cx) > 12) misaligned.push(`"${String(t.text ?? '').slice(0, 24)}" (x-center ${Math.round(c)} vs page center ${Math.round(cx)})`)
    }
    if (misaligned.length === 1) {
      issues.push(`ADVISORY alignment: wide text is off the page center — ${misaligned[0]}; center it (align_elements cx) unless the asymmetry is intentional.`)
    } else if (misaligned.length > 1) {
      issues.push(`ADVISORY alignment: ${misaligned.length} wide text elements are off the page center (${misaligned.slice(0, 2).join('; ')}); align them (align_elements cx) unless the asymmetry is intentional.`)
    }
  }

  // 13. TYPOGRAPHY (v0.32.7): more than 3 font families on one page
  //     reads as noise — advisory (decorative pairings are legitimate).
  const families = new Set(texts.map((t) => t.fontFamily).filter((f): f is string => !!f && f !== 'Poppins'))
  if (families.size > 3) {
    issues.push(`ADVISORY typography: ${families.size} font families on one page (${[...families].slice(0, 5).join(', ')}) — reduce to a heading + body pairing (set_text_style / set_font).`)
  }

  // 14. VISUAL HIERARCHY (v0.32.7): the largest text should clearly
  //     dominate the body (spatial.ts ladder) — advisory.
  const hierarchy = hierarchyLines(d)
  for (const h of hierarchy) {
    if (h.startsWith('ADVISORY')) issues.push(h)
  }

  return issues.slice(0, 12)
}

export { luminance, contrastRatio }

/** String-friendly contrast (hex or rgba) for client-side guards. */
export function contrastBetween(a: string, b: string): number {
  const ca = parseColor(a)
  const cb = parseColor(b)
  if (!ca || !cb) return 0
  return contrastRatio(ca, cb)
}
