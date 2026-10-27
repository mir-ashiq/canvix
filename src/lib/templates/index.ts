// ─────────────────────────────────────────────────────────────
// Canvix built-in template library (seeded into DB + used client-side)
//
// v0.8: 110 templates, organised as collections so the library can
// keep growing without monster files:
//   · collection-v07        — the original 60 (starters + premium)
//   · collection-v08-*      — 50 new premium-grade originals across
//                             every category, styled after what's
//                             trending on the big template platforms
//                             (original designs — nothing is copied)
//
// Every template is free forever. The "premium" badge is a quality
// label, never a paywall.
// ─────────────────────────────────────────────────────────────

import { createPage, type PageData, type TemplateRecord } from '../types'
import type { TemplateDef } from './helpers'
import { COLLECTION_V07 } from './collection-v07'
import { COLLECTION_V08_SOCIAL } from './collection-v08-social'
import { COLLECTION_V08_DECKS } from './collection-v08-decks'
import { COLLECTION_V08_PRINT } from './collection-v08-print'
import { COLLECTION_V08_DOCS } from './collection-v08-docs'
import { COLLECTION_V08_THUMBNAILS } from './collection-v08-thumbnails'
import { COLLECTION_V08_LOGOS } from './collection-v08-logos'

export type { TemplateDef } from './helpers'

export const TEMPLATES: TemplateDef[] = [
  ...COLLECTION_V07,
  ...COLLECTION_V08_SOCIAL,
  ...COLLECTION_V08_DECKS,
  ...COLLECTION_V08_PRINT,
  ...COLLECTION_V08_DOCS,
  ...COLLECTION_V08_THUMBNAILS,
  ...COLLECTION_V08_LOGOS,
]

export function templatesAsRecords(): TemplateRecord[] {
  return TEMPLATES.map((t) => ({
    id: t.slug,
    slug: t.slug,
    name: t.name,
    category: t.category,
    width: t.width,
    height: t.height,
    accent: t.accent,
    pages: t.pages,
  }))
}

export function blankPage(): PageData {
  return createPage()
}
