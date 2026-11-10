// ─────────────────────────────────────────────────────────────
// Canvix sticker packs (v0.22 — the real-sticker-library wave).
//
// The starter set was 40 emoji text stickers. This module is the
// real library: hand-authored vector sticker packs, each sticker a
// self-contained SVG (viewBox 0 0 120 120, presentation attributes
// only — no external refs, no scripts, no CSS classes) rendered
// natively on the canvas, exported inline into SVG files, and
// raster-embedded into PPTX/PDF/PNG/video through the shared
// collectImages preload — the same pipeline photos ride.
//
// The emoji starter set stays (back-compat: documents in the wild
// hold emoji StickerElements, and the text path is untouched).
//
// Style guide every pack follows (so the library reads as ONE
// product, not 11 clip-art folders):
//   • outline ink  #2D2A32, width 3.5 on hero shapes / 3 on details
//   • round caps + joins everywhere
//   • palette      red #FF6B6B · yellow #FFD93D · green #6BCB77
//                 blue #4D96FF · purple #B983FF · orange #FF9F45
//                 pink #FF7BAC · white #FFFFFF
//   • one glossy highlight ellipse (white, 0.35) on curved heroes
// ─────────────────────────────────────────────────────────────

/** One authored vector sticker. */
export interface PackSticker {
  /** stable id — `pack-shortid-name`, unique across the library */
  id: string
  /** human name shown in tooltips / saved as element alt text */
  name: string
  /** lowercase search terms (matched by the picker's search box) */
  keywords: string[]
  /** the self-contained SVG markup (viewBox 0 0 120 120) */
  svg: string
}

/** A themed pack of stickers. */
export interface StickerPack {
  id: string
  name: string
  /** the chip icon in the picker (an emoji glyph — meta-UI, not content) */
  icon: string
  stickers: PackSticker[]
}

import { FACES_PACK } from './faces'
import { HANDS_PACK } from './hands'
import { HEARTS_PACK } from './hearts'
import { STARS_PACK } from './stars'
import { CELEBRATE_PACK } from './celebrate'
import { BUSINESS_PACK } from './business'
import { ARROWS_PACK } from './arrows'
import { NATURE_PACK } from './nature'
import { FOOD_PACK } from './food'
import { FRAMES_PACK } from './frames'
import { TRAVEL_PACK } from './travel'

/** The authored vector packs, picker order. */
export const STICKER_PACKS: StickerPack[] = [
  FACES_PACK,
  HANDS_PACK,
  HEARTS_PACK,
  STARS_PACK,
  CELEBRATE_PACK,
  BUSINESS_PACK,
  ARROWS_PACK,
  NATURE_PACK,
  FOOD_PACK,
  FRAMES_PACK,
  TRAVEL_PACK,
]

/** Total authored vector stickers (excludes the emoji text set). */
export const VECTOR_STICKER_COUNT = STICKER_PACKS.reduce((n, p) => n + p.stickers.length, 0)

/** The emoji text stickers — the original starter set, kept as the
 *  quick "Emoji" tab. Rendered as text (Segoe UI Emoji et al.),
 *  native text runs in PPTX — exactly as before. */
export const EMOJI_STICKERS: readonly string[] = [
  '😀', '😍', '🤩', '🥳', '😎', '🤔', '😴', '🤯', '🥰', '😭',
  '😡', '🤡', '👻', '💀', '👽', '🤖', '🎃', '🎉', '🎈', '🎁',
  '🏆', '🥇', '⚽', '🏀', '🎮', '🎵', '🎸', '🎬', '📷', '🔥',
  '✨', '⚡', '🌈', '☀️', '🌙', '⭐', '❤️', '💜', '✅', '❌',
]

/** Whole-library search across pack name, sticker name and keywords. */
export function searchStickers(query: string): { pack: StickerPack; stickers: PackSticker[] }[] {
  const q = query.trim().toLowerCase()
  if (!q) return STICKER_PACKS.map((pack) => ({ pack, stickers: pack.stickers }))
  const terms = q.split(/\s+/)
  const hit = (s: PackSticker, packName: string): boolean => {
    const hay = `${s.name} ${s.keywords.join(' ')} ${packName}`.toLowerCase()
    return terms.every((t) => hay.includes(t))
  }
  return STICKER_PACKS.map((pack) => ({ pack, stickers: pack.stickers.filter((s) => hit(s, pack.name)) })).filter(
    (r) => r.stickers.length > 0,
  )
}

/** Find a sticker by id (library lookups, tests). */
export function findSticker(id: string): PackSticker | undefined {
  for (const p of STICKER_PACKS) {
    const s = p.stickers.find((x) => x.id === id)
    if (s) return s
  }
  return undefined
}
