// ─────────────────────────────────────────────────────────────
// Video export — REAL rendering pipeline, fully local
//
//   Canvix document → animation timeline → frame renderer
//   → [v0.15 R2] WebCodecs VideoEncoder + WebM muxer (silent
//     designs: deterministic µs-stamped frames, explicit bitrate,
//     latencyMode 'quality') — or — MediaRecorder canvas capture
//     → MP4 (H.264 where the browser can encode it) / WebM,
//     which stays the path for page-audio designs (it muxes audio).
//   [v0.15 R3] autoplay VIDEO elements render their moving content
//     frame-accurately: windowedSourceTime is the one source-time
//     mapping; the WebCodecs engine seeks each video to its exact
//     per-frame position, the MediaRecorder engine plays them in wall
//     clock beside the page audio.
//
// Static PNG/JPG/PDF/SVG exports are unaffected (animations are
// ignored there). See chooseVideoExportEngine for the matrix.
// ─────────────────────────────────────────────────────────────

import Konva from 'konva'
import type { AnyElement, AudioElement, ChartElement, EmbedElement, FrameElement, ImageElement, PageData, PluginElement, TableElement, TextElement, VideoElement } from '@/lib/types'
import { imageHasFilters, renderFilteredCanvas } from '@/lib/image-filters'
import { chartPrimitives } from '@/lib/chart-geometry'
import { embedLayout, hexPoints, hostOf, tableGeometry, youtubeThumbUrl } from '@/lib/v06-geometry'
import { createCanvasMeasure, layoutRichLines, normalizeSpans } from '@/lib/rich-text'
import { animateElementAt, pageHoldDuration } from '@/lib/animations'
import { beatEnvelopeAt, beatSourceOf } from '@/lib/media/beat-detect'
import { awaitRender, renderKey } from '@/lib/plugins/renderer-cache'
import { pageSize } from '@/lib/editor-utils'
import { isMaskShape, maskPolygon, polygonPoints, starPointsEx, stretchPts, tracePts } from '@/lib/shapes'
import { stickerDataUrl } from '@/lib/sticker-image'
import { fitFontSize } from '@/lib/text-fit'
import { layoutListLines } from '@/lib/list-text'
import { WebMMuxer } from '@/lib/webm-muxer'
import { isSfxId, sfxUrl } from '@/lib/assets/sfx-pack'

export interface VideoExportOptions {
  designWidth: number
  designHeight: number
  pages: PageData[]
  /** output pixel cap on the longest page edge */
  maxWidth?: number
  fps?: number
  onProgress?: (ratio: number, stage: string) => void
}

export interface VideoExportResult {
  blob: Blob
  mimeType: string
  extension: string
  durationSec: number
  frames: number
}

/** Detect the best supported output format (honest — no fake MP4).
 * v0.11: candidates that declare an audio codec can mux the page audio;
 * the recorder only gets an audio track when the mime supports it. */
export function detectVideoFormat(): { mimeType: string; extension: string; label: string; audio: boolean } | null {
  if (typeof MediaRecorder === 'undefined') return null
  const candidates: { mimeType: string; extension: string; label: string; audio: boolean }[] = [
    { mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', extension: 'mp4', label: 'MP4 (H.264 + AAC)', audio: true },
    { mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm', label: 'WebM (VP9 + Opus)', audio: true },
    { mimeType: 'video/webm;codecs=vp8,opus', extension: 'webm', label: 'WebM (VP8 + Opus)', audio: true },
    { mimeType: 'video/mp4;codecs=avc1.42E01E', extension: 'mp4', label: 'MP4 (H.264)', audio: false },
    { mimeType: 'video/mp4', extension: 'mp4', label: 'MP4', audio: false },
    { mimeType: 'video/webm;codecs=vp9', extension: 'webm', label: 'WebM (VP9)', audio: false },
    { mimeType: 'video/webm;codecs=vp8', extension: 'webm', label: 'WebM (VP8)', audio: false },
    { mimeType: 'video/webm', extension: 'webm', label: 'WebM', audio: false },
  ]
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c.mimeType)) return c
    } catch {
      /* continue */
    }
  }
  return null
}

export interface TimelineSegment {
  page: PageData
  /** hold time before the transition (seconds) */
  hold: number
  /** transition INTO the next page (seconds, 0 on the last page) */
  transition: number
}

/** Build the page timeline (holds + transitions). */
export function buildTimeline(pages: PageData[]): { segments: TimelineSegment[]; total: number } {
  const segments: TimelineSegment[] = pages.map((page, i) => ({
    page,
    hold: pageHoldDuration(page),
    transition:
      i < pages.length - 1
        ? Math.min(2.5, Math.max(0.1, pages[i + 1].transition?.duration ?? 0.7))
        : 0,
  }))
  const total = segments.reduce((sum, s) => sum + s.hold + s.transition, 0)
  return { segments, total }
}

/** Estimated video duration (for the UI, before rendering). */
export function estimateVideoDuration(pages: PageData[]): number {
  return buildTimeline(pages).total
}

// ── image preload (dataURLs + remote, best-effort) ──────────

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    // v0.22 robustness: node (SSR pass / unit tests) has no Image —
    // a missing bitmap degrades to the placeholder paths instead of
    // crashing the whole export (the loadStickerImage posture)
    const Ctor = (globalThis as { Image?: typeof Image }).Image
    if (typeof Ctor !== 'function') {
      resolve(null)
      return
    }
    const img = new Ctor()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

export async function collectImages(pages: PageData[]): Promise<Map<string, HTMLImageElement>> {
  const map = new Map<string, HTMLImageElement>()
  const sources: string[] = []
  const walk = (els: AnyElement[]) => {
    for (const el of els) {
      if (el.type === 'image') sources.push(el.src)
      else if (el.type === 'video') sources.push(el.poster) // v0.11: poster dataURL
      else if (el.type === 'frame' && el.src) sources.push(el.src) // v0.14 D7 parity: frames render in video
      else if (el.type === 'embed') {
        // v0.14 D7 parity: youtube thumbs attempted via the CORS loader —
        // a blocked thumb degrades to the tinted band (same as SVG export)
        const t = el.kind === 'youtube' ? youtubeThumbUrl(el.url) : null
        if (t) sources.push(t)
      } else if (el.type === 'sticker' && el.svg) {
        // v0.22 sticker packs: the authored SVG rides the same loader
        sources.push(stickerDataUrl(el.svg))
      } else if (el.type === 'group') walk(el.children)
    }
  }
  for (const p of pages) walk(p.elements)
  // v0.22: 60 → 150 — sticker-heavy decks stack many small SVG
  // data-URLs (each decodes to a ~120px bitmap, cheap next to photos)
  const unique = [...new Set(sources)].slice(0, 150)
  await Promise.all(
    unique.map(async (src) => {
      const img = await loadImage(src)
      if (img) map.set(src, img)
    })
  )

  // v0.13 (P4): plugin elements — await each renderer (bounded by
  // the 10 s contract deadline) and load the sanitized data URL as
  // the element's raster. Failures (missing/failed plugin) leave no
  // entry: buildKonvaNode draws the placeholder card instead.
  const pluginEls: PluginElement[] = []
  const walkPlugins = (els: AnyElement[]) => {
    for (const el of els) {
      if (el.type === 'plugin') pluginEls.push(el)
      else if (el.type === 'group') walkPlugins(el.children)
    }
  }
  for (const p of pages) walkPlugins(p.elements)
  await Promise.all(
    pluginEls.slice(0, 60).map(async (el) => {
      const entry = await awaitRender(el, 'export')
      if (entry.status !== 'ok') return
      const img = await loadImage(entry.dataUrl)
      if (img) map.set(renderKey(el, 'export'), img)
    })
  )
  return map
}

// ── v0.15 (R3): live video preload ──────────────────────────

/** A preloaded live <video> backing one autoplay video element. */
interface VideoAsset {
  el: HTMLVideoElement
  /** canplay fired within budget — false ⇒ the node keeps the poster */
  ok: boolean
  /** the loaded file's duration (NaN until metadata arrives) */
  duration: number
  /** last requested seek target in whole ms (−1 = never sought) */
  lastSeekMs: number
}

/** Bounded wait for a media event — resolves false on timeout or the
 *  error event, and always removes its listeners. */
function waitMediaEvent(v: HTMLMediaElement, event: string, budgetMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const done = (val: boolean) => {
      if (settled) return
      settled = true
      v.removeEventListener(event, onOk)
      v.removeEventListener('error', onErr)
      clearTimeout(timer)
      resolve(val)
    }
    const onOk = () => done(true)
    const onErr = () => done(false)
    const timer = setTimeout(() => done(false), budgetMs)
    v.addEventListener(event, onOk)
    v.addEventListener('error', onErr)
  })
}

/** R3: preload one live, MUTED <video> per autoplay video element.
 *  Presentation semantics: a video moves in an export exactly when
 *  presentation would play it — visible + autoplay; everything else
 *  keeps the static poster render and gets no asset here.
 *
 *  CORS-clean by construction: crossOrigin='anonymous' means same-origin
 *  media ids and data URLs load trivially while a remote without CORS
 *  headers FAILS to load (poster fallback) instead of tainting the
 *  canvas — fail-closed, the same rule as the image loader. Videos are
 *  always muted: the export muxes page AUDIO only (the R3 acceptance
 *  keeps that boundary — “audio mux unchanged”). Capped at
 *  MAX_EXPORT_VIDEOS so a hostile design cannot demand unbounded
 *  decode; elements past the cap fall back to their poster. */
async function collectVideos(
  pages: PageData[],
  onProgress?: (ratio: number, stage: string) => void,
): Promise<Map<string, VideoAsset>> {
  const assets = new Map<string, VideoAsset>()
  const els: VideoElement[] = []
  const walk = (list: AnyElement[]): void => {
    for (const el of list) {
      if (isPlayableExportVideo(el)) els.push(el)
      else if (el.type === 'group') walk(el.children)
    }
  }
  for (const p of pages) walk(p.elements)
  if (els.length === 0) return assets
  onProgress?.(0, 'Loading videos…')
  await Promise.all(
    els.slice(0, MAX_EXPORT_VIDEOS).map(async (vd) => {
      const v = document.createElement('video')
      v.crossOrigin = 'anonymous'
      v.muted = true
      v.playsInline = true
      v.preload = 'auto'
      const asset: VideoAsset = { el: v, ok: false, duration: Number.NaN, lastSeekMs: -1 }
      assets.set(vd.id, asset)
      const loaded = waitMediaEvent(v, 'canplay', 12_000)
      v.src = vd.src
      asset.ok = await loaded
      if (Number.isFinite(v.duration)) asset.duration = v.duration
      if (!asset.ok) return
      // park at the trim start so pre-roll and incoming transitions
      // show the window's first frame in BOTH engines (bounded,
      // best-effort — a failed park just means the first explicit
      // seek / seek+play does the work instead)
      const start = Math.max(0, Number.isFinite(vd.trimStart) ? vd.trimStart : 0)
      if (start > 0.05) {
        try {
          v.currentTime = start
          if (await waitMediaEvent(v, 'seeked', 3_000)) asset.lastSeekMs = Math.round(start * 1000)
        } catch {
          /* not seekable yet */
        }
      } else {
        asset.lastSeekMs = 0 // a fresh canplay sits at 0
      }
    }),
  )
  return assets
}

// ── Konva node builders (geometry mirrors element-node.tsx) ──

/** clip function for a frame shape (mirrors v06-nodes frameClip) */
function frameClipFunc(fr: FrameElement): (ctx: Konva.Context) => void {
  return (ctx: Konva.Context) => {
    const w = fr.width
    const h = fr.height
    if (fr.frameShape === 'ellipse' || fr.frameShape === 'circle') {
      const rx = fr.frameShape === 'circle' ? Math.min(w, h) / 2 : w / 2
      const ry = fr.frameShape === 'circle' ? Math.min(w, h) / 2 : h / 2
      ctx.beginPath()
      ctx.ellipse(w / 2, h / 2, rx, ry, 0, 0, Math.PI * 2, false)
      ctx.closePath()
    } else if (fr.frameShape === 'triangle') {
      ctx.beginPath()
      ctx.moveTo(0, h)
      ctx.lineTo(w / 2, 0)
      ctx.lineTo(w, h)
      ctx.closePath()
    } else if (fr.frameShape === 'hexagon') {
      const pts = hexPoints(w, h)
      ctx.beginPath()
      ctx.moveTo(pts[0][0], pts[0][1])
      for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1])
      ctx.closePath()
    } else {
      const rr = Math.min(fr.radius, w / 2, h / 2)
      ctx.beginPath()
      ctx.moveTo(rr, 0)
      ctx.lineTo(w - rr, 0)
      ctx.quadraticCurveTo(w, 0, w, rr)
      ctx.lineTo(w, h - rr)
      ctx.quadraticCurveTo(w, h, w - rr, h)
      ctx.lineTo(rr, h)
      ctx.quadraticCurveTo(0, h, 0, h - rr)
      ctx.lineTo(0, rr)
      ctx.quadraticCurveTo(0, 0, rr, 0)
      ctx.closePath()
    }
  }
}

/** v0.15 (R1): browser-side measure for rich text runs (same canvas-2d
 *  metrics the editor's Konva renderer uses — frame parity by sharing
 *  the geometry module, the D7 charts pattern). */
const videoRichMeasure = createCanvasMeasure()

/** v0.18 (Wave 3): the video-side effective font size — the same
 *  derivation the editor canvas and the SVG export use (lib/text-fit
 *  fitFontSize over the shared canvas measure), so all three
 *  renderers agree to the pixel. */
function videoEffectiveFontSize(t: TextElement): number {
  if (!t.autoFit) return t.fontSize
  return fitFontSize(
    {
      text: t.uppercase ? t.text.toUpperCase() : t.text,
      fontFamily: t.fontFamily,
      bold: t.bold,
      italic: t.italic,
      letterSpacing: t.letterSpacing,
      lineHeight: t.lineHeight,
      fontSize: t.fontSize,
    },
    { width: t.width, height: t.height },
    (text, style) => videoRichMeasure(text, style),
  )
}

export function buildKonvaNode(
  el: AnyElement,
  images: Map<string, HTMLImageElement>,
  videos: Map<string, VideoAsset>,
): Konva.Node {
  switch (el.type) {
    case 'text': {
      const t = el
      // v0.18 (Wave 3): list text renders through the shared list layout
      // (flat — rich spans and curved text keep their own paths, exactly
      // like the editor canvas and the SVG export)
      const isList = !!t.listStyle && t.listStyle !== 'none' && (t.curve ?? 0) === 0 && t.effect !== 'splice'
      const rtl = t.direction === 'rtl'
      if (isList) {
        const size = videoEffectiveFontSize(t)
        const lines = layoutListLines(
          {
            text: t.uppercase ? t.text.toUpperCase() : t.text,
            fontFamily: t.fontFamily,
            bold: t.bold,
            italic: t.italic,
            letterSpacing: t.letterSpacing,
            lineHeight: t.lineHeight,
            fontSize: size,
            width: t.width,
            listStyle: t.listStyle ?? 'none',
            direction: rtl ? 'rtl' : 'ltr',
          },
          (text, style) => videoRichMeasure(text, style),
        )
        const blockH = lines.length ? Math.max(...lines.map((l) => l.y)) + size * t.lineHeight : size * t.lineHeight
        const fontStyle = `${t.italic ? 'italic ' : ''}${t.bold ? 'bold' : 'normal'}`
        const group = new Konva.Group({ id: t.id, x: t.x, y: t.y })
        group.height(blockH)
        for (const line of lines) {
          if (line.marker) {
            group.add(
              new Konva.Text({
                x: line.markerX,
                y: line.y,
                text: line.marker,
                fontSize: size,
                fontFamily: t.fontFamily,
                fontStyle,
                fill: t.fill,
                width: t.width,
                align: rtl ? 'right' : 'left',
                lineHeight: t.lineHeight,
                wrap: 'none',
              }),
            )
          }
          if (line.text) {
            group.add(
              new Konva.Text({
                x: line.textX,
                y: line.y,
                text: line.text,
                fontSize: size,
                fontFamily: t.fontFamily,
                fontStyle,
                fill: t.fill,
                width: line.textWidth,
                align: rtl ? 'right' : 'left',
                lineHeight: t.lineHeight,
                wrap: 'none',
              }),
            )
          }
        }
        return group
      }
      // v0.15 (R1): rich text — one Text node per positioned run from the
      // shared layout module (curved text stays flat, single-style by design)
      if ((t.curve ?? 0) === 0) {
        const richSpans = normalizeSpans(t.spans, t.text)
        if (richSpans) {
          const runs = layoutRichLines(t, richSpans, videoRichMeasure)
          const group = new Konva.Group({ id: t.id, x: t.x, y: t.y })
          group.height(runs.length ? Math.max(...runs.map((r) => r.y)) + t.fontSize * t.lineHeight : t.fontSize * t.lineHeight)
          for (const run of runs) {
            group.add(
              new Konva.Text({
                x: run.x,
                y: run.y,
                text: run.text,
                fontSize: t.fontSize,
                fontFamily: t.fontFamily,
                fontStyle: `${run.style.italic ? 'italic ' : ''}${run.style.bold ? 'bold' : 'normal'}`,
                textDecoration: [run.style.underline ? 'underline' : '', run.style.strike ? 'line-through' : ''].filter(Boolean).join(' '),
                fill: run.style.color,
              }),
            )
          }
          return group
        }
      }
      // v0.18 (Wave 3): auto-fit derives the size (never mutates it) and
      // rtl mirrors the default alignment (centre stays) — both flat-path
      const effSize = videoEffectiveFontSize(t)
      const alignAttr =
        t.align === 'center' ? 'center' : t.align === 'justify' ? 'left' : rtl ? (t.align === 'left' ? 'right' : 'left') : t.align
      return new Konva.Text({
        id: t.id,
        x: t.x,
        y: t.y,
        width: t.width,
        text: t.uppercase ? t.text.toUpperCase() : t.text,
        fontSize: effSize,
        fontFamily: t.fontFamily,
        fontStyle: `${t.italic ? 'italic ' : ''}${t.bold ? 'bold' : 'normal'}`,
        textDecoration: [t.underline ? 'underline' : '', t.strike ? 'line-through' : ''].filter(Boolean).join(' '),
        fill: t.fill,
        align: alignAttr,
        lineHeight: t.lineHeight,
        letterSpacing: t.letterSpacing,
        wrap: 'word',
      })
    }
    case 'rect': {
      const s = el
      const node = new Konva.Rect({
        id: s.id,
        x: s.x,
        y: s.y,
        width: s.width,
        height: s.height,
        fill: s.fillGradient ? undefined : s.fill,
        stroke: s.stroke,
        strokeWidth: s.strokeWidth,
        cornerRadius: s.cornerRadius,
      })
      applyGradient(node, s)
      return node
    }
    case 'ellipse': {
      const s = el
      const node = new Konva.Ellipse({
        id: s.id,
        x: s.x + s.width / 2,
        y: s.y + s.height / 2,
        radiusX: s.width / 2,
        radiusY: s.height / 2,
        fill: s.fillGradient ? undefined : s.fill,
        stroke: s.stroke,
        strokeWidth: s.strokeWidth,
      })
      applyGradient(node, s)
      return node
    }
    case 'triangle': {
      const s = el
      const node = new Konva.Line({
        id: s.id,
        x: s.x,
        y: s.y,
        points: [0, s.height, s.width / 2, 0, s.width, s.height],
        closed: true,
        fill: s.fillGradient ? undefined : s.fill,
        stroke: s.stroke,
        strokeWidth: s.strokeWidth,
      })
      applyGradient(node, s)
      return node
    }
    case 'star': {
      const s = el
      // v0.18 (Wave 3): parametric — same stretchPts geometry as the
      // editor canvas + SVG/PDF exports (fills the element box)
      const pts = stretchPts(starPointsEx(s.numPoints ?? 5, s.innerRatio), 0, 0, s.width, s.height)
      const node = new Konva.Line({
        id: s.id,
        x: s.x + s.width / 2,
        y: s.y + s.height / 2,
        points: pts.flatMap(([px, py]) => [px - s.width / 2, py - s.height / 2]),
        closed: true,
        fill: s.fillGradient ? undefined : s.fill,
        stroke: s.stroke,
        strokeWidth: s.strokeWidth,
      })
      applyGradient(node, s)
      return node
    }
    case 'polygon': {
      const s = el
      // v0.18 (Wave 3): regular polygon — centred geometry like the star
      const pts = stretchPts(polygonPoints(s.sides ?? 6), 0, 0, s.width, s.height)
      const node = new Konva.Line({
        id: s.id,
        x: s.x + s.width / 2,
        y: s.y + s.height / 2,
        points: pts.flatMap(([px, py]) => [px - s.width / 2, py - s.height / 2]),
        closed: true,
        fill: s.fillGradient ? undefined : s.fill,
        stroke: s.stroke,
        strokeWidth: s.strokeWidth,
      })
      applyGradient(node, s)
      return node
    }
    case 'path': {
      const s = el
      const node = new Konva.Path({
        id: s.id,
        x: s.x,
        y: s.y,
        data: s.pathData ?? '',
        fill: s.fillGradient ? undefined : s.fill,
        stroke: s.stroke,
        strokeWidth: s.strokeWidth,
      })
      node.scaleX(s.width / 100)
      node.scaleY(s.height / 100)
      return node
    }
    case 'line': {
      const l = el
      return new Konva.Arrow({
        id: l.id,
        x: l.x,
        y: l.y,
        points: [0, 0, Math.max(l.width, 12), 0],
        stroke: l.stroke,
        fill: l.stroke,
        strokeWidth: l.strokeWidth,
        lineCap: 'round',
        dash: l.dashed ? [l.strokeWidth * 2.2, l.strokeWidth * 1.8] : undefined,
        pointerLength: Math.max(10, l.strokeWidth * 2.4),
        pointerWidth: Math.max(8, l.strokeWidth * 2),
        pointerAtBeginning: l.arrowStart,
        pointerAtEnd: l.arrowEnd,
      })
    }
    case 'stroke': {
      const s = el
      return new Konva.Line({
        id: s.id,
        x: s.x,
        y: s.y,
        points: s.points,
        stroke: s.stroke,
        strokeWidth: s.strokeWidth,
        lineCap: 'round',
        lineJoin: 'round',
        tension: 0.25,
      })
    }
    case 'sticker': {
      const sk = el
      // v0.22 sticker packs: authored vector stickers draw as the
      // preloaded data-URL bitmap (collectImages); emoji stay on text
      if (sk.svg) {
        const img = images.get(stickerDataUrl(sk.svg))
        return new Konva.Image({
          id: sk.id,
          x: sk.x,
          y: sk.y,
          width: sk.width,
          height: sk.height,
          image: img,
          rotation: sk.rotation ?? 0,
        })
      }
      return new Konva.Text({
        id: sk.id,
        x: sk.x,
        y: sk.y,
        width: sk.width,
        height: sk.height,
        text: sk.char,
        fontSize: sk.fontSize,
        fontFamily: "'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif",
        align: 'center',
      })
    }
    case 'image': {
      const im = el as ImageElement
      // v0.14 (D4): adjustments + filter preset are pre-baked into the
      // bitmap (pixel-exact twin of the editor's Konva pipeline) — and
      // while here, flips/rotation finally export too (parity fix)
      const img = images.get(im.src)
      const bitmap = img && imageHasFilters(im) ? renderFilteredCanvas(im, img, im.width, im.height) : img
      // v0.18 (Wave 3): validated mask — the clip polygon from the shared
      // geometry module (identical to the editor's ImageNode)
      const maskPts =
        isMaskShape(im.maskShape) && im.maskShape !== 'none'
          ? maskPolygon(im.maskShape, im.maskSides, im.maskInnerRatio)
          : null
      const image = new Konva.Image({
        id: maskPts ? undefined : im.id,
        x: maskPts ? 0 : im.x,
        y: maskPts ? 0 : im.y,
        width: im.width,
        height: im.height,
        image: bitmap ?? undefined,
        cornerRadius: maskPts ? 0 : im.radius,
        scaleX: im.flipH ? -1 : 1,
        scaleY: im.flipV ? -1 : 1,
        offsetX: im.flipH ? im.width : 0,
        offsetY: im.flipV ? im.height : 0,
        rotation: maskPts ? 0 : im.rotation ?? 0,
      })
      if (!maskPts) return image
      const group = new Konva.Group({ id: im.id, x: im.x, y: im.y, rotation: im.rotation ?? 0 })
      group.clipFunc((ctx) => tracePts(ctx, maskPts, im.width, im.height))
      group.add(image)
      return group
    }
    case 'plugin': {
      // v0.13 (P4): the renderer's sanitized output as an Image; no
      // render (missing/failed/timed-out plugin) → the placeholder
      // card, mirroring the editor canvas
      const pl = el as PluginElement
      const raster = images.get(renderKey(pl, 'export'))
      if (raster) {
        return new Konva.Image({
          id: pl.id,
          x: pl.x,
          y: pl.y,
          width: pl.width,
          height: pl.height,
          image: raster,
        })
      }
      const group = new Konva.Group({ id: pl.id, x: pl.x, y: pl.y })
      group.add(
        new Konva.Rect({
          width: pl.width,
          height: pl.height,
          cornerRadius: Math.min(10, Math.min(pl.width, pl.height) / 8),
          fill: '#F4F5F7',
          stroke: '#C9CDD6',
          strokeWidth: 1,
          dash: [6, 4],
        }),
      )
      const titleSize = Math.max(11, Math.min(20, Math.round(Math.min(pl.width, pl.height) / 12)))
      group.add(
        new Konva.Text({
          y: pl.height / 2 - titleSize * 0.6,
          width: pl.width,
          align: 'center',
          text: pl.name?.trim() || pl.kind,
          fontSize: titleSize,
          fontStyle: '600',
          fontFamily: 'Inter, system-ui, sans-serif',
          fill: '#3A3F4B',
        }),
      )
      group.add(
        new Konva.Text({
          y: pl.height / 2 + titleSize * 0.6,
          width: pl.width,
          align: 'center',
          text: pl.pluginId,
          fontSize: Math.max(9, Math.round(titleSize * 0.72)),
          fontFamily: 'Inter, system-ui, sans-serif',
          fill: '#878E9C',
        }),
      )
      return group
    }
    case 'audio': {
      // vector waveform card — geometry mirrors element-node.tsx AudioNode
      const au = el as AudioElement
      const group = new Konva.Group({ id: au.id, x: au.x, y: au.y })
      group.add(
        new Konva.Rect({
          width: au.width,
          height: au.height,
          cornerRadius: 14,
          fill: '#1B1D27',
          stroke: 'rgba(255,255,255,0.13)',
          strokeWidth: 1,
        }),
      )
      group.add(new Konva.Path({ x: 18, y: au.height / 2 - 13, data: 'M13 0 L26 13 L13 26 Z', fill: '#02C0CC' }))
      const peaks = au.peaks?.length ? au.peaks : null
      const barCount = peaks ? Math.min(peaks.length, Math.max(24, Math.floor(au.width / 6))) : 32
      const barW = 3
      const gap = peaks ? Math.max(1.5, (au.width - 116 - barCount * barW) / Math.max(1, barCount - 1)) : 4
      for (let i = 0; i < barCount; i++) {
        const v = peaks ? peaks[Math.floor((i / barCount) * peaks.length)] ?? 0 : 0.35 + 0.3 * Math.abs(Math.sin(i * 1.7))
        const h = Math.max(2, v * (au.height - 34))
        group.add(
          new Konva.Rect({
            x: 116 + i * (barW + gap),
            y: au.height / 2 - h / 2,
            width: barW,
            height: h,
            cornerRadius: 1.5,
            fill: '#7BE8E1',
            opacity: 0.35 + 0.65 * v,
          }),
        )
      }
      group.add(
        new Konva.Text({
          x: 18,
          y: au.height - 20,
          text: au.name.slice(0, 42),
          fontSize: 11,
          fontFamily: 'Inter, system-ui, sans-serif',
          fill: 'rgba(255,255,255,0.6)',
          width: au.width - 36,
        }),
      )
      return group
    }
    case 'video': {
      const vd = el as VideoElement
      const group = new Konva.Group({ id: vd.id, x: vd.x, y: vd.y })
      group.add(new Konva.Rect({ width: vd.width, height: vd.height, cornerRadius: 12, fill: '#101218' }))
      // v0.15 (R3): an autoplay video with a loaded source renders its
      // LIVE frame — the moving content IS the export representation
      // (no play chip: that is an editor affordance, and this video is
      // playing). Everything else keeps the v0.11 poster render.
      const asset = videos.get(vd.id)
      if (vd.autoplay && asset?.ok) {
        group.add(
          new Konva.Image({
            width: vd.width,
            height: vd.height,
            cornerRadius: 12,
            image: asset.el,
          }),
        )
        return group
      }
      group.add(
        new Konva.Image({
          width: vd.width,
          height: vd.height,
          cornerRadius: 12,
          image: images.get(vd.poster) ?? undefined,
        }),
      )
      const play = new Konva.Group({ x: vd.width / 2 - 24, y: vd.height / 2 - 24, opacity: 0.92 })
      play.add(new Konva.Ellipse({ radiusX: 24, radiusY: 24, fill: 'rgba(0,0,0,0.67)' }))
      play.add(new Konva.Path({ x: 16, y: 14, data: 'M0 0 L16 10 L0 20 Z', fill: '#FFFFFF' }))
      group.add(play)
      return group
    }
    // ── v0.14 (D7): charts + the table/frame/embed parity fix ──
    // these previously fell through to the default (empty group) —
    // tables, frames and embed cards simply VANISHED from video
    // exports. Geometry mirrors the editor nodes (v06-nodes.tsx).

    case 'chart': {
      const ch = el as ChartElement
      const group = new Konva.Group({ id: ch.id, x: ch.x, y: ch.y, rotation: ch.rotation ?? 0, opacity: ch.opacity ?? 1 })
      for (const p of chartPrimitives(ch)) {
        switch (p.kind) {
          case 'rect':
            group.add(new Konva.Rect({ x: p.x, y: p.y, width: p.w, height: p.h, cornerRadius: p.r ?? 0, fill: p.fill, ...(p.stroke ? { stroke: p.stroke, strokeWidth: p.strokeWidth ?? 1 } : {}) }))
            break
          case 'line':
            group.add(new Konva.Line({ points: [p.x1, p.y1, p.x2, p.y2], stroke: p.stroke, strokeWidth: p.width, ...(p.dash ? { dash: p.dash } : {}), lineCap: 'round' }))
            break
          case 'polyline':
            group.add(new Konva.Line({ points: p.points, stroke: p.stroke, strokeWidth: p.width, lineCap: 'round', lineJoin: 'round' }))
            break
          case 'circle':
            group.add(new Konva.Circle({ x: p.cx, y: p.cy, radius: p.r, fill: p.fill, ...(p.stroke ? { stroke: p.stroke, strokeWidth: p.strokeWidth ?? 1 } : {}) }))
            break
          case 'arc':
            // Konva.Arc: sweep `angle` from `rotation` (degrees, 0 = 3 o'clock)
            group.add(new Konva.Arc({ x: p.cx, y: p.cy, innerRadius: p.rIn, outerRadius: p.rOut, angle: ((p.a1 - p.a0) * 180) / Math.PI, rotation: (p.a0 * 180) / Math.PI, fill: p.fill }))
            break
          case 'text': {
            const props: Record<string, unknown> = {
              y: p.y - p.size * 0.78,
              text: p.text,
              fontSize: p.size,
              fontFamily: p.family,
              fill: p.fill,
              fontStyle: p.bold ? '700' : '400',
            }
            if (p.anchor === 'middle') {
              props.x = p.x - 2000
              props.width = 4000
              props.align = 'center'
            } else if (p.anchor === 'end') {
              props.x = p.x - 1000
              props.width = 1000
              props.align = 'right'
            } else {
              props.x = p.x
            }
            group.add(new Konva.Text(props))
            break
          }
        }
      }
      return group
    }

    case 'table': {
      const tb = el as TableElement
      const group = new Konva.Group({ id: tb.id, x: tb.x, y: tb.y, rotation: tb.rotation ?? 0, opacity: tb.opacity ?? 1 })
      const geo = tableGeometry(tb)
      for (let idx = 0; idx < tb.rows * tb.cols; idx += 1) {
        const r = Math.floor(idx / tb.cols)
        const c = idx % tb.cols
        const cell = tb.cells[idx] ?? { text: '' }
        const isHeader = r === 0
        const cellFill = cell.fill ?? (isHeader ? tb.headerFill : tb.fill)
        group.add(
          new Konva.Rect({
            x: geo.colX[c],
            y: r * geo.rowH,
            width: geo.colW[c],
            height: geo.rowH,
            ...(cellFill !== 'transparent' ? { fill: cellFill } : {}),
            stroke: tb.borderColor,
            strokeWidth: tb.borderWidth,
          }),
        )
        if (cell.text) {
          group.add(
            new Konva.Text({
              x: geo.colX[c] + 10,
              y: r * geo.rowH,
              width: Math.max(8, geo.colW[c] - 20),
              height: geo.rowH,
              text: cell.text,
              fontSize: tb.fontSize,
              fontFamily: tb.fontFamily,
              fontStyle: cell.bold || isHeader ? 'bold' : 'normal',
              fill: isHeader ? (tb.headerTextColor ?? '#FFFFFF') : tb.textColor,
              verticalAlign: 'middle',
              wrap: 'none',
              ellipsis: true,
            }),
          )
        }
      }
      return group
    }

    case 'frame': {
      const fr = el as FrameElement
      const group = new Konva.Group({ id: fr.id, x: fr.x, y: fr.y, rotation: fr.rotation ?? 0, opacity: fr.opacity ?? 1 })
      const img = fr.src ? images.get(fr.src) : undefined
      if (img && fr.naturalWidth > 0 && fr.naturalHeight > 0) {
        const scale = Math.max(fr.width / fr.naturalWidth, fr.height / fr.naturalHeight)
        const dw = fr.naturalWidth * scale
        const dh = fr.naturalHeight * scale
        group.clipFunc(frameClipFunc(fr))
        group.add(new Konva.Image({ image: img, x: (fr.width - dw) / 2, y: (fr.height - dh) / 2, width: dw, height: dh }))
      } else {
        const stroke = 'rgba(255,255,255,0.85)'
        if (fr.frameShape === 'ellipse' || fr.frameShape === 'circle') {
          const rx = fr.frameShape === 'circle' ? Math.min(fr.width, fr.height) / 2 : fr.width / 2
          const ry = fr.frameShape === 'circle' ? Math.min(fr.width, fr.height) / 2 : fr.height / 2
          group.add(new Konva.Ellipse({ x: fr.width / 2, y: fr.height / 2, radiusX: rx, radiusY: ry, fill: fr.fill, fillOpacity: 0.16, stroke, strokeWidth: 2, dash: [8, 6] }))
        } else if (fr.frameShape === 'triangle') {
          group.add(new Konva.Line({ points: [0, fr.height, fr.width / 2, 0, fr.width, fr.height], closed: true, fill: fr.fill, fillOpacity: 0.16, stroke, strokeWidth: 2, dash: [8, 6] }))
        } else if (fr.frameShape === 'hexagon') {
          group.add(new Konva.Line({ points: hexPoints(fr.width, fr.height).flat(), closed: true, fill: fr.fill, fillOpacity: 0.16, stroke, strokeWidth: 2, dash: [8, 6] }))
        } else {
          group.add(new Konva.Rect({ width: fr.width, height: fr.height, cornerRadius: fr.radius, fill: fr.fill, fillOpacity: 0.16, stroke, strokeWidth: 2, dash: [8, 6] }))
        }
      }
      return group
    }

    case 'embed': {
      const em = el as EmbedElement
      const group = new Konva.Group({ id: em.id, x: em.x, y: em.y, rotation: em.rotation ?? 0, opacity: em.opacity ?? 1 })
      const { bandH, iconR } = embedLayout(em.width, em.height)
      const cx = em.width / 2
      const cy = bandH / 2
      group.add(new Konva.Rect({ width: em.width, height: em.height, cornerRadius: 14, fill: '#15171C' }))
      const thumbUrl = em.kind === 'youtube' ? youtubeThumbUrl(em.url) : null
      const thumb = thumbUrl ? images.get(thumbUrl) : undefined
      if (thumb) {
        group.add(new Konva.Image({ image: thumb, y: 0, width: em.width, height: bandH, crop: { x: 45, y: 0, width: 270, height: 157 } }))
      } else {
        group.add(new Konva.Rect({ y: 0, width: em.width, height: bandH, cornerRadius: [14, 14, 0, 0], fill: em.tint, opacity: 0.28 }))
      }
      if (em.kind === 'youtube') {
        group.add(new Konva.Ellipse({ x: cx, y: cy, radiusX: iconR, radiusY: iconR, fill: 'rgba(255,255,255,0.92)' }))
        group.add(new Konva.Line({ points: [cx - iconR * 0.32, cy - iconR * 0.42, cx - iconR * 0.32, cy + iconR * 0.42, cx + iconR * 0.46, cy], closed: true, fill: '#FF0033' }))
      } else if (em.kind === 'map') {
        group.add(new Konva.Ellipse({ x: cx, y: cy, radiusX: iconR, radiusY: iconR, fill: 'rgba(255,255,255,0.95)' }))
        group.add(new Konva.Ellipse({ x: cx, y: cy - iconR * 0.12, radiusX: iconR * 0.34, radiusY: iconR * 0.46, fill: '#34A853' }))
        group.add(new Konva.Line({ points: [cx - iconR * 0.24, cy + iconR * 0.1, cx, cy + iconR * 0.58, cx + iconR * 0.24, cy + iconR * 0.1], closed: true, fill: '#34A853' }))
      } else {
        const sc = iconR * 0.8
        group.add(new Konva.Ellipse({ x: cx, y: cy, radiusX: iconR, radiusY: iconR, fill: 'rgba(255,255,255,0.14)', stroke: 'rgba(255,255,255,0.9)', strokeWidth: 2.5 }))
        group.add(
          new Konva.Path({
            data: `M ${cx - sc * 0.4} ${cy + sc * 0.4} L ${cx + sc * 0.42} ${cy - sc * 0.42} M ${cx - sc * 0.05} ${cy - sc * 0.42} L ${cx + sc * 0.42} ${cy - sc * 0.42} L ${cx + sc * 0.42} ${cy + sc * 0.05}`,
            stroke: '#FFFFFF',
            strokeWidth: Math.max(2, iconR * 0.16),
            lineCap: 'round',
            lineJoin: 'round',
          }),
        )
      }
      group.add(
        new Konva.Text({
          x: 14,
          y: bandH + 10,
          width: Math.max(8, em.width - 28),
          height: 18,
          text: hostOf(em.url).toUpperCase(),
          fontSize: Math.max(9, Math.round(em.height * 0.055)),
          fontFamily: 'Inter',
          fill: 'rgba(255,255,255,0.55)',
          letterSpacing: 1.2,
          wrap: 'none',
          ellipsis: true,
        }),
      )
      group.add(
        new Konva.Text({
          x: 14,
          y: bandH + 30,
          width: Math.max(8, em.width - 28),
          height: Math.max(16, em.height - bandH - 40),
          text: em.title ?? em.url,
          fontSize: Math.max(11, Math.round(em.height * 0.07)),
          fontFamily: 'Inter',
          fontStyle: '600',
          fill: '#FFFFFF',
          wrap: 'word',
          ellipsis: true,
        }),
      )
      return group
    }

    case 'group': {
      const g = el
      const group = new Konva.Group({ id: g.id, x: g.x, y: g.y, rotation: g.rotation ?? 0 })
      for (const child of g.children.filter((c) => c.visible)) {
        const childNode = buildKonvaNode(child, images, videos)
        childNode.x(child.x - g.x)
        childNode.y(child.y - g.y)
        group.add(childNode as Konva.Shape | Konva.Group)
      }
      return group
    }
    default:
      return new Konva.Group({ id: (el as { id: string }).id })
  }
}

function applyGradient(
  node: Konva.Shape,
  s: { fillGradient?: { type: 'linear' | 'radial'; from: string; to: string; angle: number } | null; width: number; height: number }
): void {
  if (!s.fillGradient) return
  if (s.fillGradient.type === 'radial') {
    node.fillRadialGradientStartPoint({ x: s.width / 2, y: s.height / 2 })
    node.fillRadialGradientEndPoint({ x: s.width / 2, y: s.height / 2 })
    node.fillRadialGradientStartRadius(0)
    node.fillRadialGradientEndRadius(Math.max(s.width, s.height) / 2)
    node.fillRadialGradientColorStops([0, s.fillGradient.from, 1, s.fillGradient.to])
  } else {
    const rad = (s.fillGradient.angle * Math.PI) / 180
    node.fillLinearGradientStartPoint({ x: 0, y: 0 })
    node.fillLinearGradientEndPoint({ x: Math.cos(rad) * s.width, y: Math.sin(rad) * s.height })
    node.fillLinearGradientColorStops([0, s.fillGradient.from, 1, s.fillGradient.to])
  }
}

// ── the export pipeline ──────────────────────────────────────

/**
 * Render the design timeline into a real video file (in-browser).
 */
// ─────────────────────────────────────────────────────────────
// v0.15 (R2): two export engines behind one entry point.
//
//   'webcodecs'     — silent designs: VideoEncoder (VP9, VP8
//                     fallback) + the hand-rolled WebM muxer.
//                     DETERMINISTIC frame pacing (every frame gets
//                     its exact timestamp — nothing is dropped
//                     when rendering is slow), explicit bitrate,
//                     latencyMode 'quality'. No wall clock.
//   'mediarecorder' — designs with page audio (it muxes the audio
//                     the WebCodecs path can't, yet) and browsers
//                     without WebCodecs. MP4/H.264 rides this path.
//
// The engine choice is a pure function of three facts (WebCodecs
// support at this size, MediaRecorder availability + audio muxing,
// whether the design has autoplay audio) — see
// chooseVideoExportEngine. Both paths share ONE render session
// (canvas + Konva stages + the frame compositor), so the WebCodecs
// path draws exactly what the MediaRecorder path draws.
// ─────────────────────────────────────────────────────────────

/** Output pixel size for a design at a maxWidth cap (even numbers —
 *  VP8/VP9 chroma subsampling demands it). */
export function computeExportSize(
  designWidth: number,
  designHeight: number,
  maxWidth: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxWidth / Math.max(designWidth, designHeight))
  return {
    width: Math.max(2, Math.round((designWidth * scale) / 2) * 2),
    height: Math.max(2, Math.round((designHeight * scale) / 2) * 2),
  }
}

/** Does any page carry an autoplay audio element? (The same filter
 *  the MediaRecorder path uses for its audio muxing.) */
export function pagesHaveAutoplayAudio(pages: PageData[]): boolean {
  return pages.some((p) =>
    (p.elements as AnyElement[]).some((e) => e.type === 'audio' && e.visible !== false && e.autoplay),
  )
}

// ── v0.22: SFX on the export timeline ─────────────────────────

/** One scheduled pack sound. Mirrors the present-mode triggers
 *  (preview-stage): the incoming page's transition SFX at 0.7, an
 *  element's animation SFX at 0.8 when the page-local clock
 *  crosses its delay. */
export interface SfxCue {
  /** pack catalogue id */
  id: string
  /** timeline time (seconds) the sound fires */
  t: number
  volume: number
  kind: 'transition' | 'element'
}

/** Build the SFX cue sheet for the export timeline — pure, so the
 *  engine decision and the tests can reason about it without a
 *  browser. Semantics (the preview-stage mirror):
 *  - page i's ELEMENT sfx fire at `start_i + delay` — the page's
 *    animation clock runs from its segment start (during the
 *    transition into it the incoming page is drawn frozen at
 *    local 0, so nothing fires early)
 *  - the TRANSITION sfx (stored on the incoming page) fires when
 *    that page mounts: page 0 at t=0, page i at the moment the
 *    transition into it begins (`start_{i-1} + hold_{i-1}`)
 *  - same-id retriggers within 60 ms collapse to the first — the
 *    player's retrigger guard, kept so the sheet is faithful
 *  - a cue past the page's whole visible window is dropped: its
 *    trigger never arrives on screen */
export function buildSfxCues(segments: TimelineSegment[]): SfxCue[] {
  const starts: number[] = []
  let acc = 0
  for (const s of segments) {
    starts.push(acc)
    acc += s.hold + s.transition
  }
  const cues: SfxCue[] = []
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const start = starts[i]
    const end = start + seg.hold + seg.transition
    const tr = seg.page.transition
    if (tr && tr.kind !== 'none' && isSfxId(tr.sfxId)) {
      cues.push({ id: tr.sfxId, t: i === 0 ? 0 : starts[i - 1] + segments[i - 1].hold, volume: 0.7, kind: 'transition' })
    }
    for (const el of seg.page.elements) {
      const a = el.animation
      if (!el.visible || !a || a.kind === 'none' || !isSfxId(a.sfxId)) continue
      const t = start + Math.max(0, a.delay || 0)
      if (t < end) cues.push({ id: a.sfxId, t, volume: 0.8, kind: 'element' })
    }
  }
  cues.sort((a, b) => a.t - b.t)
  const last: Record<string, number> = {}
  return cues.filter((c) => {
    if (last[c.id] !== undefined && c.t - last[c.id] < 0.06) return false
    last[c.id] = c.t
    return true
  })
}

/** Does any page carry a triggerable pack sound? (The dialog's
 *  mirror of what buildSfxCues would schedule — the same facts the
 *  engine decision needs, before a timeline is built.) */
export function pagesHaveSfxCues(pages: PageData[]): boolean {
  return pages.some(
    (p) =>
      (p.transition?.kind !== 'none' && isSfxId(p.transition?.sfxId)) ||
      p.elements.some((el) => el.visible && el.animation && el.animation.kind !== 'none' && isSfxId(el.animation.sfxId)),
  )
}

// ── v0.15 (R3): moving video in exports ──────────────────────

/** Hard cap on simultaneously decoded export videos — each is a live
 *  <video> the compositor seeks or plays; a hostile design must not be
 *  able to demand unbounded decode. Elements past the cap keep their
 *  poster render. */
export const MAX_EXPORT_VIDEOS = 12

/** The filter every export path shares (asset preload, the recorder's
 *  segment lists, the dialog note): a video renders MOVING content in
 *  an export exactly when presentation would play it — visible +
 *  autoplay. Non-autoplay videos deliberately keep the static poster
 *  render (the presentation semantic). */
export function isPlayableExportVideo(el: AnyElement): el is VideoElement {
  return el.type === 'video' && el.visible !== false && !!el.autoplay
}

/** Does any page carry a video that will move in the export? (dialog
 *  honesty note — same shape as pagesHaveAutoplayAudio.) */
export function pagesHaveAutoplayVideo(pages: PageData[]): boolean {
  const walk = (els: AnyElement[]): boolean => els.some((el) => isPlayableExportVideo(el) || (el.type === 'group' && walk(el.children)))
  return pages.some((p) => walk(p.elements))
}

/**
 * The ONE source-time mapping both export engines share — the position
 * (seconds into the source file) an autoplay video must show at
 * PAGE-LOCAL time t. Mirrors presentation semantics exactly:
 *
 *   t = 0       → trimStart (the page appearing starts playback there)
 *   looping     → wraps within [trimStart, end]
 *   non-looping → HOLDS the final frame once the window is spent
 *   end         → min(trimEnd, loadedDuration): a trim past what the
 *                 file actually contains clamps to the file
 *
 * Every input is garbage-safe (finite-clamped with sane defaults): the
 * mapping can never return NaN or a negative time.
 */
export function windowedSourceTime(
  trimStart: number,
  trimEnd: number,
  loop: boolean,
  t: number,
  loadedDuration = Number.POSITIVE_INFINITY,
): number {
  const finite = (v: number, dflt: number): number => (Number.isFinite(v) ? v : dflt)
  const dur = finite(loadedDuration, Number.POSITIVE_INFINITY)
  let end = finite(trimEnd, 0)
  if (Number.isFinite(dur) && dur > 0) end = Math.min(end, dur)
  let start = Math.max(0, finite(trimStart, 0))
  if (start > end) start = end
  const span = end - start
  if (span <= 0) return start
  const tt = Math.max(0, finite(t, 0))
  return loop ? start + (tt % span) : Math.min(start + tt, end)
}

export interface WebCodecsVideoSupport {
  supported: boolean
  /** Matroska CodecID the muxer should declare. */
  codecId: 'V_VP9' | 'V_VP8' | null
  /** The WebCodecs codec string to configure. */
  codecString: string | null
}

/** Probe WebCodecs VP9→VP8 at the real export size (isConfigSupported
 *  is size-sensitive; a 640×360 yes does not promise 1920×1080). */
export async function detectWebCodecsVideoSupport(width: number, height: number): Promise<WebCodecsVideoSupport> {
  const none: WebCodecsVideoSupport = { supported: false, codecId: null, codecString: null }
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return none
  const candidates: { codecId: 'V_VP9' | 'V_VP8'; codecString: string }[] = [
    { codecId: 'V_VP9', codecString: 'vp09.00.10.08' },
    { codecId: 'V_VP8', codecString: 'vp8' },
  ]
  for (const c of candidates) {
    try {
      const probe = await VideoEncoder.isConfigSupported({
        codec: c.codecString,
        width,
        height,
        bitrate: 1_000_000,
        framerate: 30,
      })
      if (probe.supported) return { supported: true, codecId: c.codecId, codecString: c.codecString }
    } catch {
      /* try the next candidate */
    }
  }
  return none
}

export interface VideoEngineInputs {
  webcodecs: boolean
  mediaRecorder: boolean
  /** the recorder candidate can mux audio (mp4a/opus in its mime) */
  mediaRecorderAudio: boolean
  hasPageAudio: boolean
  /** v0.22: the design carries triggerable pack sounds (transition
   *  SFX / element animation SFX) — these also need the audio-muxing
   *  recorder, exactly like page audio. Optional: pre-v0.22 callers
   *  and tests that only know about page audio keep compiling. */
  hasSfxCues?: boolean
}

export type VideoExportEngineDecision =
  | { engine: 'webcodecs'; reason: string }
  | { engine: 'mediarecorder'; reason: string }
  | { engine: null; reason: string }

/** The engine matrix, as one pure function (unit-tested):
 *   - timeline audio (page audio OR v0.22 SFX cues) + a recorder
 *     that can mux it → MediaRecorder (the WebCodecs path is
 *     silent; Opus-in-WebM via AudioEncoder is a documented
 *     post-R3 evaluation)
 *   - WebCodecs available otherwise → WebCodecs (frame-exact)
 *   - neither → null (exportVideo throws, as before) */
export function chooseVideoExportEngine(inputs: VideoEngineInputs): VideoExportEngineDecision {
  const hasTimelineAudio = inputs.hasPageAudio || (inputs.hasSfxCues ?? false)
  if (hasTimelineAudio && inputs.mediaRecorder && inputs.mediaRecorderAudio) {
    return { engine: 'mediarecorder', reason: 'page audio or SFX — MediaRecorder muxes it (the WebCodecs path is video-only for now)' }
  }
  if (inputs.webcodecs) {
    if (hasTimelineAudio) {
      return {
        engine: 'webcodecs',
        reason: inputs.mediaRecorder
          ? 'audio-preserving MediaRecorder unavailable here — exporting silent via WebCodecs'
          : 'MediaRecorder unavailable — WebCodecs is the only engine in this browser',
      }
    }
    return { engine: 'webcodecs', reason: 'frame-exact VP9/VP8 WebM at an explicit bitrate' }
  }
  if (inputs.mediaRecorder) {
    return { engine: 'mediarecorder', reason: 'WebCodecs unavailable in this browser' }
  }
  return { engine: null, reason: 'neither WebCodecs nor MediaRecorder can encode video here' }
}

/** v0.15 (R4): buildKonvaNode + collectImages are ALSO the PDF export's
 * raster-strip path — any element the vector PDF cannot express
 * (stickers, plugin renders, filtered images, shadows, fx text) is
 * rendered pixel-perfect by this same compositor. */
/** Everything both engines share: the render canvas, the per-page
 *  Konva stages, and the timeline compositor (renderFrameAt). */
export interface RenderSession {
  readonly canvas: HTMLCanvasElement
  readonly ctx: CanvasRenderingContext2D
  readonly segments: TimelineSegment[]
  readonly segStarts: number[]
  readonly totalFrames: number
  /** R3: preloaded live videos by element id (empty when no autoplay videos) */
  readonly videos: ReadonlyMap<string, VideoAsset>
  renderFrameAt(frameNo: number, t: number): void
  /** R3: deterministic engines call this BEFORE renderFrameAt so every
   *  visible video sits at its exact source frame when the composite is
   *  drawn (a no-op when the design has no autoplay videos). */
  prepareFrameAt(t: number): Promise<void>
  destroy(): void
}

/** v0.15 (R5): the GIF engine rides the SAME render session as
 * the two video engines — one compositor, one source of truth
 * about what is on screen at time t. */
export async function createRenderSession(
  opts: VideoExportOptions,
  width: number,
  height: number,
  segments: TimelineSegment[],
  totalFrames: number,
): Promise<RenderSession> {
  // preload every image source first (dataURLs resolve instantly)
  opts.onProgress?.(0, 'Loading images…')
  const images = await collectImages(opts.pages)
  // v0.15 (R3): live videos for the moving-content render (no-op when
  // the design has none — the map stays empty and every code path
  // below degrades to the v0.11 poster behaviour)
  const videos = await collectVideos(opts.pages, opts.onProgress)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create the rendering canvas.')

  // hidden host for the Konva stages
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-99999px;top:0;'
  document.body.appendChild(host)

  const nodesForPage = new Map<number, { node: Konva.Node; el: AnyElement }[]>()
  const stageForPage = new Map<number, Konva.Stage>()
  // v0.11: Beat Sync sources per page (beats ride the audio element)
  const beatsForPage = new Map<number, { beats: number[]; bpm: number } | null>()

  const buildPage = (index: number): { node: Konva.Node; el: AnyElement }[] => {
    let nodes = nodesForPage.get(index)
    if (nodes) return nodes
    const page = segments[index].page
    // v0.18 (Wave 3): per-page size — each page fits + centres in the
    // output frame (identical to the old uniform scale when the page
    // keeps the design size)
    const { width: pw, height: pgh } = pageSize(page, opts.designWidth, opts.designHeight)
    const pageScale = Math.min(width / pw, height / pgh)
    const pageOffX = (width - pw * pageScale) / 2
    const pageOffY = (height - pgh * pageScale) / 2
    const stage = new Konva.Stage({ container: host, width, height })

    const bgLayer = new Konva.Layer({ listening: false, x: pageOffX, y: pageOffY, scale: { x: pageScale, y: pageScale } })
    const bg = page.background
    const bgRect =
      bg.type === 'gradient'
        ? new Konva.Rect({
            width: pw,
            height: pgh,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: {
              x: Math.cos((bg.angle * Math.PI) / 180) * pw,
              y: Math.sin((bg.angle * Math.PI) / 180) * pgh,
            },
            fillLinearGradientColorStops: [0, bg.from, 1, bg.to],
          })
        : new Konva.Rect({ width: pw, height: pgh, fill: bg.color })
    bgLayer.add(bgRect)
    stage.add(bgLayer)

    const layer = new Konva.Layer({
      listening: false,
      x: pageOffX,
      y: pageOffY,
      scale: { x: pageScale, y: pageScale },
      clip: { x: 0, y: 0, width: pw, height: pgh },
    })
    stage.add(layer)

    nodes = page.elements
      .filter((el) => el.visible)
      .map((el) => {
        const node = buildKonvaNode(el, images, videos)
        const shape = node as Konva.Shape
        if (el.shadow?.enabled && typeof shape.shadowColor === 'function') {
          shape.shadowColor(el.shadow.color)
          shape.shadowBlur(el.shadow.blur)
          shape.shadowOffset({ x: el.shadow.offsetX, y: el.shadow.offsetY })
        }
        layer.add(node as Konva.Shape | Konva.Group)
        return { node, el }
      })
    layer.batchDraw()
    nodesForPage.set(index, nodes)
    stageForPage.set(index, stage)
    beatsForPage.set(index, beatSourceOf(page))
    return nodes
  }

  /** apply animation + beat-pulse state at page-local time t and draw */
  const drawPage = (index: number, t: number): HTMLCanvasElement | null => {
    const nodes = buildPage(index)
    const beatSrc = beatsForPage.get(index)
    for (const { node, el } of nodes) {
      // v0.11: Beat Sync — pulses multiply whatever the entry animation
      // (or rest state) produced, so beats compose with any animation
      const beatScale =
        beatSrc && (el.beatPulse ?? 0) > 0 ? 1 + (el.beatPulse ?? 0) * 0.12 * beatEnvelopeAt(beatSrc.beats, t) : 1
      const a = el.animation
      if (a && a.kind !== 'none') {
        const state = animateElementAt(el, t)
        node.opacity((el.opacity ?? 1) * state.opacity)
        if (state.reveal < 1) {
          const r = Math.max(0.001, state.reveal)
          node.scale({ x: r * beatScale, y: 1 })
          node.offsetY(el.height / 2)
          node.x(el.x + state.dx)
          node.y(el.y + state.dy + el.height / 2)
        } else if (state.scaleX !== 1 || state.scaleY !== 1 || beatScale !== 1) {
          node.scale({ x: state.scaleX * beatScale, y: state.scaleY * beatScale })
          node.offsetX(el.width / 2)
          node.offsetY(el.height / 2)
          node.x(el.x + state.dx + el.width / 2)
          node.y(el.y + state.dy + el.height / 2)
        } else {
          node.scale({ x: 1, y: 1 })
          node.offsetX(0)
          node.offsetY(0)
          node.x(el.x + state.dx)
          node.y(el.y + state.dy)
        }
        node.rotation((el.rotation ?? 0) + state.rotation)
      } else {
        node.opacity(el.opacity ?? 1)
        if (beatScale !== 1) {
          node.scale({ x: beatScale, y: beatScale })
          node.offsetX(el.width / 2)
          node.offsetY(el.height / 2)
          node.x(el.x + el.width / 2)
          node.y(el.y + el.height / 2)
        } else {
          node.scale({ x: 1, y: 1 })
          node.offsetX(0)
          node.offsetY(0)
          node.x(el.x)
          node.y(el.y)
        }
        node.rotation(el.rotation ?? 0)
      }
    }
    stageForPage.get(index)?.batchDraw()
    return stageForPage.get(index)!.toCanvas()
  }

  /** timeline segment start times */
  let tCursor = 0
  const segStarts = segments.map((s) => {
    const start = tCursor
    tCursor += s.hold + s.transition
    return start
  })

  /** which pages are on screen at timeline time t: the active segment
   *  (holding — or frozen at its FINAL state once its out-transition
   *  starts) and, mid-transition, the incoming page entering at local
   *  t = 0. One definition shared by the compositor and the R3 video
   *  scheduler, so the two can never disagree about what is visible. */
  const pagesVisibleAt = (t: number): { outSeg: number; outLocal: number; incSeg: number | null; progress: number } => {
    let segIdx = segments.length - 1
    let segLocal = t - segStarts[segments.length - 1]
    for (let i = 0; i < segments.length; i++) {
      const start = segStarts[i]
      const end = start + segments[i].hold + segments[i].transition
      if (t >= start && t < end) {
        segIdx = i
        segLocal = t - start
        break
      }
    }
    const seg = segments[segIdx]
    const inTransition = segLocal >= seg.hold && seg.transition > 0
    return {
      outSeg: segIdx,
      outLocal: inTransition ? seg.hold + seg.transition : segLocal,
      incSeg: inTransition ? segIdx + 1 : null,
      progress: inTransition ? (segLocal - seg.hold) / seg.transition : 0,
    }
  }

  /** render the composite for timeline time t onto the recorder canvas */
  const renderFrameAt = (frameNo: number, t: number): void => {
    void frameNo
    const { outSeg, outLocal, incSeg, progress: p } = pagesVisibleAt(t)

    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, width, height)

    if (incSeg === null) {
      const pageCanvas = drawPage(outSeg, outLocal)
      if (pageCanvas) ctx.drawImage(pageCanvas, 0, 0, width, height)
    } else {
      // transition: outgoing holds its final state; incoming enters
      const outCanvas = drawPage(outSeg, outLocal) // final state
      const inCanvas = drawPage(incSeg, 0)

      const nextSeg = segments[incSeg]
      const kind = nextSeg.page.transition?.kind ?? 'fade'
      const dir = nextSeg.page.transition?.direction ?? 'left'

      if (outCanvas) ctx.drawImage(outCanvas, 0, 0, width, height)
      if (inCanvas) {
        ctx.save()
        switch (kind) {
          case 'fade':
            ctx.globalAlpha = p
            ctx.drawImage(inCanvas, 0, 0, width, height)
            break
          case 'slide': {
            const off = (1 - p) * (dir === 'right' ? -width : width)
            ctx.drawImage(inCanvas, off, 0, width, height)
            break
          }
          case 'morph':
            ctx.globalAlpha = p
            ctx.translate((1 - p) * width * 0.05, (1 - p) * height * 0.05)
            ctx.scale(0.9 + 0.1 * p, 0.9 + 0.1 * p)
            ctx.drawImage(inCanvas, 0, 0, width, height)
            break
          default:
            ctx.drawImage(inCanvas, 0, 0, width, height)
        }
        ctx.restore()
      }
    }
  }

  /** v0.15 (R3): put every VISIBLE autoplay video at its exact source
   *  position for timeline time t — the deterministic engine's
   *  pre-render step. Seeks are deduped (same rounded target ⇒ no-op),
   *  run in parallel across videos and are individually bounded: a seek
   *  that never completes draws the last decoded frame — the export can
   *  stall on NOTHING, it can only get slower. */
  const prepareFrameAt = async (t: number): Promise<void> => {
    if (videos.size === 0) return
    const vis = pagesVisibleAt(t)
    const jobs: Promise<void>[] = []
    const schedulePage = (segIndex: number, localT: number): void => {
      const walk = (els: AnyElement[]): void => {
        for (const el of els) {
          if (isPlayableExportVideo(el)) {
            const asset = videos.get(el.id)
            if (!asset?.ok) continue
            const target = windowedSourceTime(el.trimStart, el.trimEnd, !!el.loop, localT, asset.duration)
            const targetMs = Math.round(target * 1000)
            if (targetMs === asset.lastSeekMs) continue // dedupe
            asset.lastSeekMs = targetMs
            jobs.push(
              (async () => {
                try {
                  asset.el.currentTime = target
                } catch {
                  return // not seekable — keep the last decoded frame
                }
                await waitMediaEvent(asset.el, 'seeked', 3_000)
              })(),
            )
          } else if (el.type === 'group') walk(el.children)
        }
      }
      walk(segments[segIndex].page.elements)
    }
    schedulePage(vis.outSeg, vis.outLocal)
    if (vis.incSeg !== null) schedulePage(vis.incSeg, 0)
    if (jobs.length > 0) await Promise.all(jobs)
  }


  /** tear down the Konva stages + hidden host (stream/audio teardown
   *  belongs to the engine path that created them). */
  const destroy = (): void => {
    for (const stage of stageForPage.values()) stage.destroy()
    host.remove()
    // R3: release the video decoders
    for (const asset of videos.values()) {
      try {
        asset.el.pause()
        asset.el.removeAttribute('src')
        asset.el.load()
      } catch {
        /* already released */
      }
    }
  }

  return { canvas, ctx, segments, segStarts, totalFrames, videos, renderFrameAt, prepareFrameAt, destroy }
}

export async function exportVideo(opts: VideoExportOptions): Promise<VideoExportResult> {
  const fps = opts.fps ?? 30
  const { width, height } = computeExportSize(opts.designWidth, opts.designHeight, opts.maxWidth ?? 1280)
  const { segments, total } = buildTimeline(opts.pages)
  const totalFrames = Math.max(1, Math.round(total * fps))

  const wc = await detectWebCodecsVideoSupport(width, height)
  const mr = detectVideoFormat()
  const decision = chooseVideoExportEngine({
    webcodecs: wc.supported,
    mediaRecorder: mr !== null,
    mediaRecorderAudio: mr?.audio ?? false,
    hasPageAudio: pagesHaveAutoplayAudio(opts.pages),
    // v0.22: pack sounds (transition/element SFX) are timeline audio
    // too — they ride the same MediaRecorder mux the page audio does
    hasSfxCues: pagesHaveSfxCues(opts.pages),
  })
  if (decision.engine === 'webcodecs' && wc.codecId && wc.codecString) {
    return exportViaWebCodecs(opts, wc, { fps, width, height, segments, total, totalFrames })
  }
  if (decision.engine === null) {
    throw new Error('This browser cannot record video (no WebCodecs encoder and no MediaRecorder).')
  }
  if (!mr) throw new Error('This browser cannot record video (MediaRecorder unavailable).')
  return exportViaMediaRecorder(opts, mr, { fps, width, height, segments, total, totalFrames })
}

interface SizedExport {
  fps: number
  width: number
  height: number
  segments: TimelineSegment[]
  total: number
  totalFrames: number
}

// ── engine A: WebCodecs → WebM (v0.15 R2) ─────────────────────

async function exportViaWebCodecs(
  opts: VideoExportOptions,
  wc: WebCodecsVideoSupport,
  sized: SizedExport,
): Promise<VideoExportResult> {
  const { fps, width, height, segments, total, totalFrames } = sized
  const session = await createRenderSession(opts, width, height, segments, totalFrames)
  const { canvas, ctx, renderFrameAt } = session

  const gopFrames = Math.max(1, Math.round(fps * 2))
  const bitrate = Math.min(20_000_000, Math.max(250_000, Math.round(width * height * fps * 0.14)))
  const mimeType = wc.codecId === 'V_VP9' ? 'video/webm;codecs=vp9' : 'video/webm;codecs=vp8'
  const muxer = new WebMMuxer({
    width,
    height,
    codec: wc.codecId ?? 'V_VP9',
    durationMs: Math.round((totalFrames / fps) * 1000),
  })

  let encodeError: DOMException | null = null
  const encoder = new VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)
      muxer.addFrame({
        data,
        keyframe: chunk.type === 'key',
        timestampUs: chunk.timestamp,
        durationUs: chunk.duration !== null && chunk.duration > 0 ? chunk.duration : Math.round(1e6 / fps),
      })
    },
    error: (e) => {
      encodeError = e
    },
  })
  encoder.configure({
    codec: wc.codecString ?? 'vp09.00.10.08',
    width,
    height,
    bitrate,
    framerate: fps,
    // no realtime constraint — the file export prefers quality
    latencyMode: 'quality',
    alpha: 'discard',
  })

  /** tiny yield so the encoder queue and the UI can breathe */
  const breathe = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 4))

  try {
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, width, height)

    // DETERMINISTIC PACING — every frame carries its exact µs stamp
    // (frame / fps). There is no wall clock anywhere in this loop:
    // slow rendering only makes the export take longer, never drops
    // or duplicates a frame. Backpressure rides encodeQueueSize.
    for (let frame = 0; frame < totalFrames; frame++) {
      if (encodeError) throw encodeError
      const t = frame / fps
      await session.prepareFrameAt(t) // R3: every video at its exact frame
      renderFrameAt(frame, t)
      while (encoder.encodeQueueSize > 4 && !encodeError) await breathe()
      const videoFrame = new VideoFrame(canvas, {
        timestamp: Math.round((frame * 1e6) / fps),
        duration: Math.round(1e6 / fps),
      })
      encoder.encode(videoFrame, { keyFrame: frame % gopFrames === 0 })
      videoFrame.close()
      if (frame % 10 === 0) {
        opts.onProgress?.(frame / totalFrames, `Encoding frame ${frame + 1} / ${totalFrames}`)
        await breathe()
      }
    }
    await encoder.flush()
    if (encodeError) throw encodeError

    opts.onProgress?.(1, 'Finalizing…')
    const bytes = muxer.finalize()
    if (muxer.frames === 0 || bytes.length === 0) {
      throw new Error('The video encoder produced an empty file — try fewer pages or a smaller resolution.')
    }
    return { blob: new Blob([bytes], { type: mimeType }), mimeType, extension: 'webm', durationSec: total, frames: muxer.frames }
  } finally {
    try {
      encoder.close()
    } catch {
      /* already closed on error */
    }
    session.destroy()
  }
}

// ── engine B: MediaRecorder (unchanged behaviour) ─────────────

async function exportViaMediaRecorder(
  opts: VideoExportOptions,
  format: { mimeType: string; extension: string; label: string; audio: boolean },
  sized: SizedExport,
): Promise<VideoExportResult> {
  const { fps, width, height, segments, total, totalFrames } = sized
  const session = await createRenderSession(opts, width, height, segments, totalFrames)
  const { canvas, ctx, renderFrameAt, segStarts, videos } = session

  // ── v0.15 (R3): moving video on the wall-clock engine ───────
  // The recorder paces frames against real time, so autoplay videos
  // PLAY alongside it — exactly how the page audio works — instead of
  // being seeked per frame. Segment entry: seek to trimStart + play
  // (muted — the export never muxes video-element audio). Segment
  // exit: pause + reset. The loop's trim tick applies the window with
  // the same rule the presentation rAF tick uses.
  const segmentVideos = segments.map((s) => {
    const list: { asset: VideoAsset; vd: VideoElement }[] = []
    const walk = (els: AnyElement[]): void => {
      for (const el of els) {
        if (isPlayableExportVideo(el)) {
          const asset = videos.get(el.id)
          if (asset?.ok) list.push({ asset, vd: el })
        } else if (el.type === 'group') walk(el.children)
      }
    }
    walk(s.page.elements)
    return list
  })

  const stream = canvas.captureStream(0)
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void }

  // ── v0.11: page-audio muxing (best-effort) ──────────────────
  // Each segment's autoplay audio elements play through a shared
  // AudioContext MediaStreamDestination while their page is on the
  // timeline; the wall-clock pacing of the frame loop keeps A/V aligned.
  // Every step is individually guarded — a browser that refuses any of
  // this (autoplay policy, codec) still produces a correct silent video.
  const segmentAudio: HTMLAudioElement[][] = segments.map((s) =>
    (s.page.elements as AnyElement[])
      .filter((e): e is AudioElement => e.type === 'audio' && e.visible !== false && e.autoplay)
      .map((el) => {
        const a = new Audio(el.src)
        a.volume = Math.min(1, Math.max(0, Number.isFinite(el.volume) ? el.volume : 0.8))
        a.loop = el.loop
        return a
      }),
  )
  let audioCtx: AudioContext | null = null
  let audioDest: MediaStreamAudioDestinationNode | null = null
  // v0.22: the SFX cue sheet — present-mode triggers (the incoming
  // page's transition sound, element sounds at their animation
  // delays) mapped onto the recorder's timeline. Pure schedule;
  // the bytes decode below through the SAME context the page audio
  // uses, so both flow one audio track.
  const sfxCues = format.audio ? buildSfxCues(segments) : []
  const sfxBuffers = new Map<string, AudioBuffer>()
  if (format.audio && (segmentAudio.some((els) => els.length) || sfxCues.length > 0)) {
    try {
      const Ctx: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      audioCtx = new Ctx()
      // v0.11.1 fix: resume() is async — a context that is still suspended
      // when the recorder starts records DIGITAL SILENCE for the whole
      // export (racy in headless browsers, possible on real ones after a
      // background-tab suspension). Wait (bounded) for it to run before
      // any audio flows; on timeout we still proceed honestly — the
      // guards below keep the export correct, just silent.
      await Promise.race([audioCtx.resume(), new Promise<void>((r) => setTimeout(r, 750))]).catch(() => {
        /* suspended → silent track */
      })
      audioDest = audioCtx.createMediaStreamDestination()
      for (const els of segmentAudio) {
        for (const a of els) audioCtx.createMediaElementSource(a).connect(audioDest)
      }
      // v0.22: decode each distinct SFX id ONCE (the media-bag
      // posture). Individually guarded — a failed fetch or decode
      // drops that one sound, never the export; bounded like the
      // element-buffer wait so a dead network still exports.
      if (sfxCues.length) {
        const actx: AudioContext = audioCtx
        await Promise.race([
          Promise.all(
            [...new Set(sfxCues.map((c) => c.id))].map(async (id) => {
              try {
                const res = await fetch(sfxUrl(id), { signal: AbortSignal.timeout(8000) })
                if (!res.ok) return
                const buf = await actx.decodeAudioData(await res.arrayBuffer())
                sfxBuffers.set(id, buf)
              } catch {
                /* that sound stays silent */
              }
            }),
          ),
          new Promise<void>((r) => setTimeout(r, 4000)),
        ])
      }
    } catch {
      audioCtx = null
      audioDest = null
    }
  }
  // v0.11.1 fix: WAIT for the audio to be buffered before recording starts.
  // The render loop below yields via MessageChannel in a tight cycle, which
  // starves the media element's resource-selection task — a not-yet-loaded
  // element at recorder.start() never loads during the export (readyState
  // stays 0, play() aborts in the finally) and the track records digital
  // silence. Here the main thread is still idle: the fetch completes in
  // milliseconds. Bounded at 1.5 s — a slow network still exports (silent,
  // honestly) instead of hanging.
  if (audioDest) {
    const all = segmentAudio.flat()
    await Promise.race([
      Promise.all(
        all.map(
          (a) =>
            new Promise<void>((resolve) => {
              if (a.readyState >= 3) return resolve()
              const done = () => {
                a.removeEventListener('canplay', done)
                a.removeEventListener('error', done)
                resolve()
              }
              a.addEventListener('canplay', done)
              a.addEventListener('error', done)
              try {
                a.load() // explicit resource selection — don't rely on the queued task
              } catch {
                resolve()
              }
            }),
        ),
      ),
      new Promise<void>((resolve) => setTimeout(resolve, 1_500)),
    ])
  }

  const recordStream = audioDest ? new MediaStream([track, ...audioDest.stream.getAudioTracks()]) : stream

  const recorder = new MediaRecorder(recordStream, {
    mimeType: format.mimeType,
    videoBitsPerSecond: Math.round(width * height * fps * 0.12),
  })
  const chunks: BlobPart[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  const done = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve()
  })
  recorder.start()

  try {
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, width, height)

    /**
     * REAL-TIME PACED CAPTURE — MediaRecorder stamps requestFrame() calls with
     * wall-clock time, so frames MUST be paced to real time (not rendered as
     * fast as possible) or the video duration drifts. When rendering falls
     * behind schedule we drop frames to stay on the timeline; when ahead, we
     * yield until the target time.
     */
    const yieldToMain = (): Promise<void> =>
      new Promise<void>((resolve) => {
        // MessageChannel tasks are not subject to hidden-tab timer throttling
        if (typeof MessageChannel !== 'undefined') {
          const ch = new MessageChannel()
          ch.port1.onmessage = () => resolve()
          ch.port2.postMessage(null)
          return
        }
        setTimeout(resolve, 0)
      })

    const startWall = performance.now()
    // v0.22: schedule the SFX cue sheet on the audio clock. t0 pairs
    // with startWall — captured back-to-back, so the residual gap is
    // far below audibility — and every cue fires as a one-shot
    // BufferSource at its timeline second. Sounds whose id failed to
    // decode simply never schedule (the honest-silence posture).
    if (audioCtx && audioDest && sfxCues.length) {
      const actx: AudioContext = audioCtx
      const dest: MediaStreamAudioDestinationNode = audioDest
      const t0 = actx.currentTime
      for (const cue of sfxCues) {
        const buf = sfxBuffers.get(cue.id)
        if (!buf) continue
        const when = t0 + Math.max(0, cue.t)
        if (when <= actx.currentTime) continue // the moment passed (late decode) — never fire late
        try {
          const src = actx.createBufferSource()
          src.buffer = buf
          const gain = actx.createGain()
          gain.gain.value = cue.volume
          src.connect(gain)
          gain.connect(dest)
          src.start(when)
        } catch {
          /* one bad schedule never kills the export */
        }
      }
    }
    const deadline = startWall + total * 1000 + 15_000 // hard safety cap
    let frame = 0
    let activeSeg = -1
    /** segment index owning timeline time t (mirrors renderFrameAt) */
    const segmentIndexAt = (t: number): number => {
      for (let i = 0; i < segments.length; i++) {
        const start = segStarts[i]
        if (t >= start && t < start + segments[i].hold + segments[i].transition) return i
      }
      return segments.length - 1
    }

    while (frame < totalFrames) {
      const t = frame / fps
      const targetWall = startWall + t * 1000

      // v0.11: swap the playing page's audio as the timeline crosses a
      // segment boundary (loops within the segment, like presentation)
      const segIdx = segmentIndexAt(t)
      if (segIdx !== activeSeg) {
        if (activeSeg >= 0) {
          for (const a of segmentAudio[activeSeg]) {
            a.pause()
            try {
              a.currentTime = 0
            } catch {
              /* not seekable yet */
            }
          }
          // R3: the outgoing page's videos pause + reset to their window
          for (const { asset, vd } of segmentVideos[activeSeg]) {
            asset.el.pause()
            try {
              asset.el.currentTime = Math.max(0, vd.trimStart)
            } catch {
              /* not seekable yet */
            }
          }
        }
        for (const a of segmentAudio[segIdx]) void a.play().catch(() => { /* stays silent */ })
        // R3: the incoming page's videos start at their trim window
        for (const { asset, vd } of segmentVideos[segIdx]) {
          try {
            asset.el.currentTime = Math.max(0, vd.trimStart)
          } catch {
            /* not seekable — plays from wherever it sits */
          }
          void asset.el.play().catch(() => { /* muted autoplay cannot be policy-blocked; belt and braces */ })
        }
        activeSeg = segIdx
      }

      // R3: trim window on the playing videos — looping wraps back to
      // trimStart, non-looping pauses and holds its final frame (only
      // fight the element when the trim truly ends before the file:
      // the same guard the presentation tick uses)
      if (activeSeg >= 0) {
        for (const { asset, vd } of segmentVideos[activeSeg]) {
          const v = asset.el
          if (Number.isFinite(asset.duration) && vd.trimEnd < asset.duration && v.currentTime >= vd.trimEnd) {
            if (vd.loop) {
              try {
                v.currentTime = Math.max(0, vd.trimStart)
              } catch {
                /* not seekable */
              }
            } else v.pause()
          }
        }
      }

      // behind schedule? skip ahead to the frame the clock says we should render
      let now = performance.now()
      if (now > targetWall + 250) {
        const behind = Math.floor((now - startWall) / 1000 * fps)
        frame = Math.max(frame + 1, Math.min(behind, totalFrames - 1))
        continue
      }

      // ahead of schedule → yield in small chunks until the clock catches up
      while (now < targetWall && performance.now() < deadline) {
        await yieldToMain()
        now = performance.now()
      }
      if (performance.now() >= deadline) break // safety cap

      renderFrameAt(frame, t)
      track.requestFrame?.()

      frame += 1
      if (frame % 10 === 0) {
        opts.onProgress?.(frame / totalFrames, `Rendering frame ${frame + 1} / ${totalFrames}`)
        await yieldToMain() // keep the UI (and devtools) responsive
      }
    }

    // let the encoder flush the final frame
    await new Promise((r) => setTimeout(r, 200))
    track.requestFrame?.()
    recorder.stop()
    await done
    opts.onProgress?.(1, 'Finalizing…')
  } finally {
    session.destroy()
    stream.getTracks().forEach((tr) => tr.stop())
    for (const els of segmentAudio) {
      for (const a of els) {
        a.pause()
        a.removeAttribute('src')
      }
    }
    void audioCtx?.close().catch(() => {})
  }

  const blob = new Blob(chunks, { type: format.mimeType })
  if (!blob.size) throw new Error('The video encoder produced an empty file — try fewer pages or a smaller resolution.')
  return { blob, mimeType: format.mimeType, extension: format.extension, durationSec: total, frames: totalFrames }
}

/** Trigger a download of the produced video blob. */
export function downloadVideo(result: VideoExportResult, filename: string): void {
  const url = URL.createObjectURL(result.blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.${result.extension}`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
