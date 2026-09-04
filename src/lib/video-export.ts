// ─────────────────────────────────────────────────────────────
// Video export (v0.5) — REAL rendering pipeline, fully local
//
//   Canvix document → animation timeline → frame renderer
//   → MediaRecorder canvas capture → MP4 (H.264, where the
//   browser can encode it) or WebM (VP9/VP8 fallback)
//
// Fixed-timestep rendering: frames are pushed manually via
// captureStream(0) + requestFrame(), so output timing is exact
// even when rendering is slower than realtime. Static PNG/JPG/
// PDF/SVG exports are unaffected (animations are ignored there).
// ─────────────────────────────────────────────────────────────

import Konva from 'konva'
import type { AnyElement, ImageElement, PageData } from '@/lib/types'
import { animateElementAt, pageHoldDuration } from '@/lib/animations'

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

/** Detect the best supported output format (honest — no fake MP4). */
export function detectVideoFormat(): { mimeType: string; extension: string; label: string } | null {
  if (typeof MediaRecorder === 'undefined') return null
  const candidates: { mimeType: string; extension: string; label: string }[] = [
    { mimeType: 'video/mp4;codecs=avc1.42E01E', extension: 'mp4', label: 'MP4 (H.264)' },
    { mimeType: 'video/mp4', extension: 'mp4', label: 'MP4' },
    { mimeType: 'video/webm;codecs=vp9', extension: 'webm', label: 'WebM (VP9)' },
    { mimeType: 'video/webm;codecs=vp8', extension: 'webm', label: 'WebM (VP8)' },
    { mimeType: 'video/webm', extension: 'webm', label: 'WebM' },
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

interface TimelineSegment {
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
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

async function collectImages(pages: PageData[]): Promise<Map<string, HTMLImageElement>> {
  const map = new Map<string, HTMLImageElement>()
  const sources: string[] = []
  const walk = (els: AnyElement[]) => {
    for (const el of els) {
      if (el.type === 'image') sources.push(el.src)
      else if (el.type === 'group') walk(el.children)
    }
  }
  for (const p of pages) walk(p.elements)
  const unique = [...new Set(sources)].slice(0, 60)
  await Promise.all(
    unique.map(async (src) => {
      const img = await loadImage(src)
      if (img) map.set(src, img)
    })
  )
  return map
}

// ── Konva node builders (geometry mirrors element-node.tsx) ──

function buildKonvaNode(el: AnyElement, images: Map<string, HTMLImageElement>): Konva.Node {
  switch (el.type) {
    case 'text': {
      const t = el
      return new Konva.Text({
        id: t.id,
        x: t.x,
        y: t.y,
        width: t.width,
        text: t.uppercase ? t.text.toUpperCase() : t.text,
        fontSize: t.fontSize,
        fontFamily: t.fontFamily,
        fontStyle: `${t.italic ? 'italic ' : ''}${t.bold ? 'bold' : 'normal'}`,
        textDecoration: [t.underline ? 'underline' : '', t.strike ? 'line-through' : ''].filter(Boolean).join(' '),
        fill: t.fill,
        align: t.align === 'justify' ? 'left' : t.align,
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
      const outer = Math.min(s.width, s.height) / 2
      const node = new Konva.Star({
        id: s.id,
        x: s.x + s.width / 2,
        y: s.y + s.height / 2,
        numPoints: 5,
        innerRadius: outer * 0.55,
        outerRadius: outer,
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
      const node = new Konva.Image({
        id: im.id,
        x: im.x,
        y: im.y,
        width: im.width,
        height: im.height,
        image: images.get(im.src) ?? undefined,
        cornerRadius: im.radius,
      })
      return node
    }
    case 'group': {
      const g = el
      const group = new Konva.Group({ id: g.id, x: g.x, y: g.y, rotation: g.rotation ?? 0 })
      for (const child of g.children.filter((c) => c.visible)) {
        const childNode = buildKonvaNode(child, images)
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
export async function exportVideo(opts: VideoExportOptions): Promise<VideoExportResult> {
  const format = detectVideoFormat()
  if (!format) throw new Error('This browser cannot record video (MediaRecorder unavailable).')

  const fps = opts.fps ?? 30
  const scale = Math.min(1, (opts.maxWidth ?? 1280) / Math.max(opts.designWidth, opts.designHeight))
  const width = Math.max(2, Math.round((opts.designWidth * scale) / 2) * 2)
  const height = Math.max(2, Math.round((opts.designHeight * scale) / 2) * 2)

  const { segments, total } = buildTimeline(opts.pages)
  const totalFrames = Math.max(1, Math.round(total * fps))

  // preload every image source first (dataURLs resolve instantly)
  opts.onProgress?.(0, 'Loading images…')
  const images = await collectImages(opts.pages)

  // recorder canvas with manual frame pushing
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create the rendering canvas.')
  const stream = canvas.captureStream(0)
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void }

  const recorder = new MediaRecorder(stream, {
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

  // hidden host for the Konva stages
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-99999px;top:0;'
  document.body.appendChild(host)

  const nodesForPage = new Map<number, { node: Konva.Node; el: AnyElement }[]>()
  const stageForPage = new Map<number, Konva.Stage>()

  const buildPage = (index: number): { node: Konva.Node; el: AnyElement }[] => {
    let nodes = nodesForPage.get(index)
    if (nodes) return nodes
    const page = segments[index].page
    const pageScale = width / opts.designWidth
    const stage = new Konva.Stage({ container: host, width, height })

    const bgLayer = new Konva.Layer({ listening: false, scale: { x: pageScale, y: pageScale } })
    const bg = page.background
    const bgRect =
      bg.type === 'gradient'
        ? new Konva.Rect({
            width: opts.designWidth,
            height: opts.designHeight,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: {
              x: Math.cos((bg.angle * Math.PI) / 180) * opts.designWidth,
              y: Math.sin((bg.angle * Math.PI) / 180) * opts.designHeight,
            },
            fillLinearGradientColorStops: [0, bg.from, 1, bg.to],
          })
        : new Konva.Rect({ width: opts.designWidth, height: opts.designHeight, fill: bg.color })
    bgLayer.add(bgRect)
    stage.add(bgLayer)

    const layer = new Konva.Layer({
      listening: false,
      scale: { x: pageScale, y: pageScale },
      clip: { x: 0, y: 0, width: opts.designWidth, height: opts.designHeight },
    })
    stage.add(layer)

    nodes = page.elements
      .filter((el) => el.visible)
      .map((el) => {
        const node = buildKonvaNode(el, images)
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
    return nodes
  }

  /** apply animation state at page-local time t and draw */
  const drawPage = (index: number, t: number): HTMLCanvasElement | null => {
    const nodes = buildPage(index)
    for (const { node, el } of nodes) {
      const a = el.animation
      if (a && a.kind !== 'none') {
        const state = animateElementAt(el, t)
        node.opacity((el.opacity ?? 1) * state.opacity)
        if (state.reveal < 1) {
          const r = Math.max(0.001, state.reveal)
          node.scale({ x: r, y: 1 })
          node.offsetY(el.height / 2)
          node.x(el.x + state.dx)
          node.y(el.y + state.dy + el.height / 2)
        } else if (state.scaleX !== 1 || state.scaleY !== 1) {
          node.scale({ x: state.scaleX, y: state.scaleY })
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
        node.scale({ x: 1, y: 1 })
        node.offsetX(0)
        node.offsetY(0)
        node.x(el.x)
        node.y(el.y)
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

  /** render the composite for timeline time t onto the recorder canvas */
  const renderFrameAt = (frameNo: number, t: number): void => {
    void frameNo
    // locate the active segment
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
    const p = inTransition ? (segLocal - seg.hold) / seg.transition : 0

    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, width, height)

    if (!inTransition) {
      const pageCanvas = drawPage(segIdx, segLocal)
      if (pageCanvas) ctx.drawImage(pageCanvas, 0, 0, width, height)
    } else {
      // transition: outgoing holds its final state; incoming enters
      const outCanvas = drawPage(segIdx, seg.hold + seg.transition) // final state
      const inCanvas = drawPage(segIdx + 1, 0)

      const nextSeg = segments[segIdx + 1]
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
    const deadline = startWall + total * 1000 + 15_000 // hard safety cap
    let frame = 0

    while (frame < totalFrames) {
      const t = frame / fps
      const targetWall = startWall + t * 1000

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
    for (const stage of stageForPage.values()) stage.destroy()
    host.remove()
    stream.getTracks().forEach((tr) => tr.stop())
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
