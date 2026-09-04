// ─────────────────────────────────────────────────────────────
// Magic Layers — image → editable design pipeline types
//
// Pipeline: upload → normalize → server vision analysis →
// region detection → client reconstruction → native Canvix
// elements with provenance metadata.
// ─────────────────────────────────────────────────────────────

/** Region kinds the vision model can detect. */
export type MagicRegionType = 'text' | 'photo' | 'shape' | 'decoration'

/** Font classification — exact fonts can't be recovered, only classes. */
export type MagicFontClass = 'sans' | 'serif' | 'script' | 'mono'

/** Bounds normalized to 0..1 of the source image dimensions. */
export interface MagicBounds {
  x: number
  y: number
  w: number
  h: number
}

/** A single detected region (server JSON protocol → client). */
export interface MagicRegion {
  id: string
  type: MagicRegionType
  bounds: MagicBounds
  /** text regions */
  text?: string
  color?: string
  fontClass?: MagicFontClass
  bold?: boolean
  italic?: boolean
  /** approx font size as a fraction of image height (0.01–0.3) */
  fontSize?: number
  align?: 'left' | 'center' | 'right'
  /** shape regions */
  shape?: 'rect' | 'rounded-rect' | 'ellipse'
  /** photo regions */
  subject?: string
  /** layer order hint (0 = bottom) */
  z?: number
  /** vision model confidence 0..1 */
  confidence: number
}

export interface MagicBackground {
  kind: 'solid' | 'gradient' | 'photo'
  from?: string
  to?: string
  angle?: number
}

export interface MagicLayerAnalysis {
  background: MagicBackground
  regions: MagicRegion[]
  /** server-side notes about limitations (shown honestly in UI) */
  notes?: string
}

/** Provenance metadata retained on each generated Canvix element. */
export interface MagicLayerMeta {
  /** id of the source region in the analysis */
  sourceRegion: string
  /** raw confidence from the analysis (0..1) */
  confidence: number
  /** what kind of source produced this element */
  sourceType: MagicRegionType
  /** original normalized bounds in the source image */
  originalBounds: MagicBounds
}

/** Fonts we map font classes to (from our 63-font library). */
export const FONT_CLASS_MAP: Record<MagicFontClass, { heading: string; body: string }> = {
  sans: { heading: 'Archivo Black', body: 'Poppins' },
  serif: { heading: 'Playfair Display', body: 'Lora' },
  script: { heading: 'Dancing Script', body: 'Dancing Script' },
  mono: { heading: 'Space Mono', body: 'Space Mono' },
}

/** Canva-style honesty threshold — regions below this are flagged for review. */
export const REVIEW_CONFIDENCE_THRESHOLD = 0.6
