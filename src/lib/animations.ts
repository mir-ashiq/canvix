// ─────────────────────────────────────────────────────────────
// Canvix animation engine (v0.5)
//
// Pure functions of time — completely independent from Konva.
// The same engine drives: editor preview playback, PreviewOverlay
// page playback + transitions, and video export frame rendering.
// Static exports (PNG/JPG/PDF/SVG) ignore animations entirely.
// ─────────────────────────────────────────────────────────────

import type {
  AnimationEasing,
  AnimationKind,
  AnyElement,
  ElementAnimation,
  PageData,
} from '@/lib/types'

// ── easings ──────────────────────────────────────────────────

export function applyEasing(t: number, easing: AnimationEasing): number {
  switch (easing) {
    case 'linear':
      return t
    case 'easeIn':
      return t * t * t
    case 'easeOut':
      return 1 - Math.pow(1 - t, 3)
    case 'easeInOut':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    case 'spring': {
      // damped spring approximation
      const c = 2 * Math.PI * 0.9 // frequency
      const decay = 4.5
      return 1 - Math.exp(-decay * t) * Math.cos(c * t)
    }
    default:
      return t
  }
}

// ── per-element animation state at time t ────────────────────

export interface AnimatedElementState {
  /** 0..1 multiplier over the element's base opacity */
  opacity: number
  /** page-space translation deltas */
  dx: number
  dy: number
  /** scale multipliers (relative to base size) */
  scaleX: number
  scaleY: number
  /** additional rotation in degrees */
  rotation: number
  /** wipe reveal: 0..1 fraction of the width visible from the anchor edge */
  reveal: number
}

const IDENTITY: AnimatedElementState = {
  opacity: 1,
  dx: 0,
  dy: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  reveal: 1,
}

/** Travel distance for pan/rise — relative to element size / page. */
function travelDistance(el: { width: number; height: number }): { x: number; y: number } {
  return { x: Math.max(80, el.width * 0.35), y: Math.max(80, el.height * 0.35) }
}

/**
 * Compute an element's animated state at time `t` (seconds since the page
 * was shown). Returns IDENTITY when the animation is finished or absent.
 */
export function animateElementAt(
  el: { width: number; height: number; animation?: ElementAnimation },
  t: number
): AnimatedElementState {
  const a = el.animation
  if (!a || a.kind === 'none' || a.kind === undefined) return IDENTITY

  const local = t - (a.delay || 0)
  if (local <= 0) {
    // before the animation starts: element is at its "from" state (hidden)
    return startState(el, a)
  }
  const dur = Math.max(0.05, a.duration || 0.9)
  if (a.kind === 'breathe') {
    // continuous loop — scale pulse 1 → 1.04 → 1
    const phase = (local % dur) / dur
    const s = 1 + 0.04 * Math.sin(phase * Math.PI * 2)
    return { ...IDENTITY, scaleX: s, scaleY: s }
  }
  if (local >= dur) return IDENTITY

  const p = applyEasing(local / dur, a.easing || 'easeOut')
  const inv = 1 - p
  const travel = travelDistance(el)
  const dir = a.direction ?? 'up'

  switch (a.kind) {
    case 'fade':
      return { ...IDENTITY, opacity: p }
    case 'rise': {
      // rise = move up + fade in (direction-aware)
      const dy = dir === 'down' ? inv * travel.y : -inv * travel.y
      return { ...IDENTITY, opacity: p, dy }
    }
    case 'pan': {
      const dx = dir === 'left' ? -inv * travel.x : dir === 'right' ? inv * travel.x : 0
      const dy2 = dir === 'up' ? -inv * travel.y : dir === 'down' ? inv * travel.y : 0
      return { ...IDENTITY, dx, dy: dy2 }
    }
    case 'pop': {
      // overshoot springy scale-in
      const s = 0.6 + 0.4 * p * (1 + 0.25 * Math.sin(p * Math.PI))
      return { ...IDENTITY, scaleX: s, scaleY: s, opacity: Math.min(1, p * 1.6) }
    }
    case 'wipe': {
      // reveal from the anchor edge (scale-on-one-axis approximation)
      return { ...IDENTITY, reveal: p, opacity: 1 }
    }
    case 'zoom': {
      const s = 0.65 + 0.35 * p
      return { ...IDENTITY, scaleX: s, scaleY: s, opacity: p }
    }
    case 'rotate': {
      return { ...IDENTITY, rotation: inv * (dir === 'left' ? -90 : 90), opacity: p, scaleX: Math.max(0.1, 0.8 + 0.2 * p) }
    }
    default:
      return IDENTITY
  }
}

/** the state an element sits in before its animation starts */
function startState(
  el: { width: number; height: number },
  a: ElementAnimation
): AnimatedElementState {
  const travel = travelDistance(el)
  const dir = a.direction ?? 'up'
  switch (a.kind) {
    case 'fade':
    case 'rise':
    case 'zoom':
    case 'pop':
    case 'rotate':
      return { ...IDENTITY, opacity: 0 }
    case 'pan':
      return {
        ...IDENTITY,
        dx: dir === 'left' ? -travel.x : dir === 'right' ? travel.x : 0,
        dy: dir === 'up' ? -travel.y : dir === 'down' ? travel.y : 0,
      }
    case 'wipe':
      return { ...IDENTITY, reveal: 0 }
    case 'breathe':
      return IDENTITY
    default:
      return IDENTITY
  }
}

// ── timing helpers ───────────────────────────────────────────

/** Total playback time of a page's element animations (seconds). */
export function pageAnimationDuration(page: PageData): number {
  let max = 0
  for (const el of page.elements) {
    const a = el.animation
    if (!a || a.kind === 'none') continue
    if (a.kind === 'breathe') continue // looping — does not extend the timeline
    max = Math.max(max, (a.delay || 0) + Math.max(0.05, a.duration || 0.9))
  }
  return max
}

/** Minimum seconds a page stays visible in autoplay (canva-like pacing). */
export function pageHoldDuration(page: PageData): number {
  const anim = pageAnimationDuration(page)
  const complexity = Math.min(4, page.elements.length / 4)
  return Math.max(2.2, anim + 0.8 + complexity * 0.4)
}

// ── Magic Animate — deterministic one-click animation pass ──

const HEADING_FONT_RATIO = 0.06 // fontSize > 6% of page height = heading

/**
 * Magic Animate: assign tasteful entry animations to every element of a page
 * (deterministic — no AI needed). Layout-aware rules:
 *   - large text (headline) → rise, slight delay
 *   - body text → fade
 *   - images → pan (from the nearest edge) or zoom
 *   - shapes/decorations → pop / breathe
 *   - page transition → fade
 * Elements keep relative order: delay scales with stacking order.
 */
export function magicAnimatePage(page: PageData, pageHeight: number, speed: 'slow' | 'medium' | 'fast' = 'medium'): PageData {
  const base = speed === 'slow' ? 1.25 : speed === 'fast' ? 0.7 : 1
  let delayCursor = 0
  const elements = page.elements.map((el) => {
    const anim = magicAnimationFor(el, pageHeight, base, delayCursor)
    if (anim) delayCursor = Math.min(delayCursor + 0.12 * base, 1.4)
    return anim ? { ...el, animation: anim } : { ...el, animation: undefined }
  })
  return {
    ...page,
    elements,
    transition: { kind: 'fade', duration: 0.7 },
  }
}

function magicAnimationFor(
  el: AnyElement,
  pageHeight: number,
  base: number,
  delay: number
): ElementAnimation | undefined {
  const duration = 0.8 * base
  const direction = pickDirection(el)

  if (el.type === 'text') {
    const isHeading = el.fontSize / pageHeight > HEADING_FONT_RATIO || el.bold
    return {
      kind: isHeading ? 'rise' : 'fade',
      duration,
      delay: Math.min(delay, isHeading ? 0.1 : 0.5 * base),
      easing: 'easeOut',
      direction: isHeading ? 'up' : undefined,
    }
  }
  if (el.type === 'image' || el.type === 'sticker') {
    return { kind: 'pan', duration: duration * 1.15, delay: Math.min(delay, 0.8 * base), easing: 'easeOut', direction }
  }
  if (el.type === 'rect' || el.type === 'ellipse' || el.type === 'triangle' || el.type === 'star' || el.type === 'path') {
    return { kind: 'pop', duration: duration * 0.9, delay: Math.min(delay, 1.0 * base), easing: 'spring' }
  }
  if (el.type === 'line' || el.type === 'stroke') {
    return { kind: 'wipe', duration, delay: Math.min(delay, 1.1 * base), easing: 'easeOut', direction: 'left' }
  }
  return { kind: 'fade', duration, delay: Math.min(delay, 1.2 * base), easing: 'easeOut' }
}

function pickDirection(el: { x: number; y: number; width: number; height: number }): 'left' | 'right' | 'up' | 'down' {
  // pan in from the nearest edge of the element
  const distLeft = el.x
  const distRight = Math.abs(1080 - (el.x + el.width)) // page width unknown here; approximate
  const distTop = el.y
  const min = Math.min(distLeft, distTop, distRight)
  if (min === distTop) return 'up'
  if (min === distLeft) return 'left'
  return 'right'
}

/** Remove animations from every element on a page. */
export function clearPageAnimations(page: PageData): PageData {
  return {
    ...page,
    elements: page.elements.map((el) => ({ ...el, animation: undefined })),
    transition: undefined,
  }
}

/** Human labels for the animation panel. */
export const ANIMATION_KINDS: { kind: AnimationKind; label: string; hint: string }[] = [
  { kind: 'none', label: 'None', hint: 'Remove animation' },
  { kind: 'fade', label: 'Fade', hint: 'Softly fades in' },
  { kind: 'rise', label: 'Rise', hint: 'Floats up into place' },
  { kind: 'pan', label: 'Pan', hint: 'Slides in from an edge' },
  { kind: 'pop', label: 'Pop', hint: 'Springy scale-in' },
  { kind: 'wipe', label: 'Wipe', hint: 'Reveals from an edge' },
  { kind: 'zoom', label: 'Zoom', hint: 'Scales up into view' },
  { kind: 'rotate', label: 'Rotate', hint: 'Spins in' },
  { kind: 'breathe', label: 'Breathe', hint: 'Gently pulses (loops)' },
]

export const TRANSITION_KINDS: { kind: 'none' | 'fade' | 'slide' | 'morph'; label: string; hint: string }[] = [
  { kind: 'none', label: 'None', hint: 'Instant cut' },
  { kind: 'fade', label: 'Fade', hint: 'Crossfade between pages' },
  { kind: 'slide', label: 'Slide', hint: 'Slides across' },
  { kind: 'morph', label: 'Morph', hint: 'Zoom + fade blend' },
]

/** normalize/clamp an incoming animation config (used by store + AI actions) */
export function sanitizeAnimation(input: unknown): ElementAnimation | undefined {
  if (!input || typeof input !== 'object') return undefined
  const a = input as Partial<ElementAnimation>
  const kind = a.kind
  if (!kind || !ANIMATION_KINDS.some((k) => k.kind === kind)) return undefined
  if (kind === 'none') return undefined
  const easing = (['linear', 'easeIn', 'easeOut', 'easeInOut', 'spring'] as const).includes(a.easing as never)
    ? (a.easing as AnimationEasing)
    : 'easeOut'
  const direction = (['left', 'right', 'up', 'down'] as const).includes(a.direction as never)
    ? (a.direction as ElementAnimation['direction'])
    : undefined
  return {
    kind,
    duration: Math.min(4, Math.max(0.1, Number(a.duration) || 0.9)),
    delay: Math.min(5, Math.max(0, Number(a.delay) || 0)),
    easing,
    direction,
  }
}
