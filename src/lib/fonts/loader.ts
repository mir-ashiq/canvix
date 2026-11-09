// ─────────────────────────────────────────────────────────────
// Canvix on-demand font loader (v0.17 Wave 2).
//
// With a 369-family catalog, preloading everything is off the table.
// The historic 63 families stay on the layout <link>; every other
// family loads here the moment it is previewed or used:
//
//   ensureFontLoaded('Shrikhand')            — css2 <link> injection
//   ensureDocumentFonts(pages)               — scan a document's text
//   registerCustomFont(family, url, format)  — FontFace from /api/media
//
// Konva stages don't redraw on webfont arrival, so after a font
// settles we broadcast `canvix:fonts-loaded`; CanvasStage listens
// and batchDraws.
// ─────────────────────────────────────────────────────────────

import { FONTS, PRELOADED_FONTS } from './catalog'
import type { PageData } from '../types'

const injected = new Set<string>()

/** css2 axis string for a family ('400;700' etc.) */
export function weightAxisFor(family: string): string {
  const entry = FONTS.find((f) => f.family === family)
  return (entry?.weights ?? '400,700').split(',').join(';')
}

function broadcastFontsLoaded() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('canvix:fonts-loaded'))
}

/**
 * Load a Google-font family on demand. No-op for preloaded families,
 * SSR, unknown families (they may be custom uploads) and repeat calls.
 */
export function ensureFontLoaded(family: string): void {
  if (typeof document === 'undefined') return
  if (!family || PRELOADED_FONTS.has(family) || injected.has(family)) return
  // only load catalog families through the Google path — custom uploads
  // register via registerCustomFont instead
  if (!FONTS.some((f) => f.family === family)) return
  injected.add(family)
  const id = `canvix-font-${family.replace(/[^a-zA-Z0-9]/g, '-')}`
  if (document.getElementById(id)) return
  const link = document.createElement('link')
  link.id = id
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@${weightAxisFor(family)}&display=swap`
  link.onload = () => {
    void document.fonts.ready.then(broadcastFontsLoaded)
  }
  document.head.appendChild(link)
}

/**
 * Ensure every font family used by a document's text elements is
 * loaded (editor open, template apply, preview mount).
 */
export function ensureDocumentFonts(pages: PageData[] | undefined): void {
  if (!pages?.length) return
  for (const page of pages) {
    for (const el of page.elements ?? []) {
      if (el.type === 'text') {
        const family = (el as { fontFamily?: string }).fontFamily
        if (family) ensureFontLoaded(family)
      }
    }
  }
}

// ── custom (uploaded) fonts ───────────────────────────────────

export interface CustomFont {
  id: string
  family: string
  url: string
  format: string
}

const customRegistered = new Map<string, Promise<void>>()

/** register an uploaded font with the document FontFace set */
export function registerCustomFont(font: CustomFont): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve()
  const existing = customRegistered.get(font.id)
  if (existing) return existing
  const p = (async () => {
    const res = await fetch(font.url)
    if (!res.ok) throw new Error(`font fetch failed (${res.status})`)
    const buf = await res.arrayBuffer()
    const face = new FontFace(font.family, buf, { weight: '400 700' })
    await face.load()
    document.fonts.add(face)
    broadcastFontsLoaded()
  })().catch((err) => {
    // failed registrations may be retried on next panel open
    customRegistered.delete(font.id)
    throw err
  })
  customRegistered.set(font.id, p)
  return p
}

/** fetch the caller's uploaded fonts and register them all */
export async function loadCustomFonts(): Promise<CustomFont[]> {
  if (typeof window === 'undefined') return []
  try {
    const res = await fetch('/api/fonts/custom', { cache: 'no-store' })
    if (!res.ok) return []
    const fonts = (await res.json()) as { fonts?: CustomFont[] }
    await Promise.allSettled((fonts.fonts ?? []).map((f) => registerCustomFont(f)))
    return fonts.fonts ?? []
  } catch {
    return []
  }
}
