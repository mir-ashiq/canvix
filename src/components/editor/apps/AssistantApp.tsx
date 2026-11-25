'use client'

// ─────────────────────────────────────────────────────────────
// AssistantApp (v0.28) — the Canvix design agent panel.
//
// The v0.28 overhaul (docs/AGENT-ARCHITECTURE.md):
//  · MODE CHIPS — create/edit/review/improve/explain/plan/discuss;
//    pinned modes ride the request; read-only modes are also
//    enforced server-side (zero write tools in the surface)
//  · LIVE RUN VIEW — mode, active skills, the Design Brief
//    Contract, steps (thought → tool → observation), usage
//    telemetry (turns/tools/time) and compaction notices
//  · CLIENT BRIEF VALIDATION (Phase 5 partner) — validate_brief
//    and the done-gate call back into the panel, which computes
//    the result against the LIVE document and answers on the bridge
//  · PER-CALL APPROVALS — destructive calls ask once per callId
//    batch (not per tool name); a session-approved tool name still
//    auto-applies within the SAME run only
//  · VISION CRITIQUE (Phase 7) — after a create/improve run the
//    panel captures the canvas (the export pipeline's captureStage)
//    and asks the vision slot for grounded findings; when no vision
//    model is configured it says so plainly (never pretends)
//  · Stop mid-run (completed work kept) + "Undo agent work"
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, Loader2, Send, Sparkles, User, Square, Undo2, ShieldAlert, ListChecks, Eye, Gauge, Scissors, CheckCircle2 } from 'lucide-react'
import type { AnyElement, TextElement } from '@/lib/types'
import { useEditorStore } from '@/store/editor-store'
import { AppHeader, type AppPanelProps } from './registry'
import { cn } from '@/lib/utils'
import { applyDesignAction, describeAction, type DesignAction } from '@/lib/design-actions'
import { useAICapabilities } from '@/hooks/use-ai-capabilities'
import type { AgentEvent, AgentMode } from '@/lib/agent/protocol'
import { validateBrief, type DesignBrief } from '@/lib/agent/brief'
import { heuristicMode, MODE_TOOL_RISK } from '@/lib/agent/router'
import { contrastBetween } from '@/lib/agent/audit'

// ── types ────────────────────────────────────────────────────

interface RunStep {
  index: number
  thought: string
  tool: string
  observation?: string
}

interface Finding {
  severity: 'P0' | 'P1' | 'P2' | 'P3'
  issue: string
  fix?: string
}

interface Turn {
  role: 'user' | 'assistant'
  content: string
  steps?: RunStep[]
  appliedActions?: number
  baseline?: number
  mode?: AgentMode
  plan?: string[]
  findings?: Finding[]
  verification?: string
  usage?: { turns: number; toolCalls: number; elapsedMs: number; modelCalls: number }
}

const SUGGESTIONS = [
  'Design a bold Instagram post for a coffee launch',
  'Make this design more professional',
  'What is wrong with this design?',
  'Add a CTA button',
  'Build a 3-slide pitch deck for a startup idea',
  'Explain what fonts this design uses',
]

const MODE_CHIPS: { id: AgentMode | 'auto'; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'create', label: 'Create' },
  { id: 'edit', label: 'Edit' },
  { id: 'review', label: 'Review' },
  { id: 'improve', label: 'Improve' },
  { id: 'explain', label: 'Explain' },
  { id: 'plan', label: 'Plan' },
]

const READ_ONLY_MODES: AgentMode[] = ['review', 'explain', 'plan', 'discuss']

/** Flatten elements (groups included). */
function flatElements(els: AnyElement[], out: AnyElement[] = []): AnyElement[] {
  for (const el of els) {
    out.push(el)
    if (el.type === 'group') flatElements(el.children, out)
  }
  return out
}

/** The tiered design context (selection full → page summary → spatial). */
function buildDesignContext() {
  const s = useEditorStore.getState()
  const page = s.pages[s.currentPage]
  // v0.29.3: real text metrics — the same canvas measureText the
  // renderer and the measure_text tool use. The audit's overflow
  // check consumes measuredWidth instead of a glyph-average guess.
  let measureCtx: CanvasRenderingContext2D | null = null
  const measureText = (t: TextElement): number | undefined => {
    try {
      if (!measureCtx) {
        const c = document.createElement('canvas')
        measureCtx = c.getContext('2d')
      }
      if (!measureCtx) return undefined
      measureCtx.font = `${t.bold ? 'bold ' : ''}${Math.max(6, Math.round(t.fontSize))}px ${t.fontFamily || 'Poppins'}`
      const single = t.text.split('\n')[0] ?? ''
      if (!single) return undefined
      return Math.round(measureCtx.measureText(single).width)
    } catch {
      return undefined
    }
  }
  const elements = (page?.elements ?? []).slice(0, 80).map((el) => {
    const base: Record<string, unknown> = {
      id: el.id,
      type: el.type,
      x: Math.round(el.x),
      y: Math.round(el.y),
      width: Math.round(el.width),
      height: Math.round(el.height),
      locked: el.locked,
    }
    if (el.type === 'text') {
      const t = el as TextElement
      base.text = t.text.slice(0, 80)
      base.fill = t.fill
      base.fontSize = Math.round(t.fontSize)
      base.bold = t.bold
      base.fontFamily = t.fontFamily
      const w = measureText(t)
      if (w !== undefined) base.measuredWidth = w
    } else if ('fill' in el) {
      base.fill = (el as { fill: string }).fill
    }
    if ('stroke' in el && typeof (el as { stroke?: unknown }).stroke === 'string') {
      const stroke = (el as { stroke: string }).stroke
      if (stroke.trim()) base.stroke = stroke
    }
    if (el.name) base.name = el.name.slice(0, 30)
    return base
  })
  const texts = flatElements(page?.elements ?? []).filter((e) => e.type === 'text') as TextElement[]

  // spatial analysis (v0.26 logic, client-computed for the agent context)
  // v0.29.3: text-on-card layering is INTENTIONAL — a pair is only an
  // overlap problem when the text is NOT readable on the shape: not
  // contained, or the contrast against the shape fill is too low.
  const boxes = (page?.elements ?? [])
    .filter((e) => (e.width ?? 0) > 0 && (e.height ?? 0) > 0)
    .map((e) => ({ id: e.id, type: e.type, x: e.x, y: e.y, w: e.width, h: e.height, fill: 'fill' in e ? String((e as { fill?: unknown }).fill ?? '') : '' }))
  const overlaps: string[] = []
  for (let i = 0; i < boxes.length && overlaps.length < 12; i++) {
    for (let j = i + 1; j < boxes.length && overlaps.length < 12; j++) {
      const a = boxes[i]
      const b = boxes[j]
      const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
      const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
      const inter = ix * iy
      const minArea = Math.min(a.w * a.h, b.w * b.h)
      if (minArea > 0 && inter / minArea > 0.08) {
        const smaller = a.w * a.h <= b.w * b.h ? a : b
        const bigger = smaller === a ? b : a
        if (smaller.type === 'text') {
          // text vs its card: contained + readable = fine layering
          const contained = inter / minArea > 0.7
          if (contained) {
            const readable = contrastBetween(smaller.fill, bigger.fill) >= 3
            if (readable || isSemiTransparent(bigger.fill)) continue
          }
        }
        overlaps.push(`${a.type}#${a.id} × ${b.type}#${b.id} (${Math.round((inter / minArea) * 100)}%)`)
      }
    }
  }
  const offCanvas = boxes
    .filter((b) => b.x < -8 || b.y < -8 || b.x + b.w > s.width + 8 || b.y + b.h > s.height + 8)
    .slice(0, 8)
    .map((b) => `${b.type}#${b.id} @(${Math.round(b.x)},${Math.round(b.y)}) ${Math.round(b.w)}x${Math.round(b.h)} outside the page`)

  // brand kit (if set) — the agent respects it before inventing
  const brand =
    s.brand && (s.brand.colors?.length || s.brand.headingFont)
      ? { colors: s.brand.colors, headingFont: s.brand.headingFont, bodyFont: s.brand.bodyFont }
      : null

  // v0.29.3: the REAL page background — the audit's contrast math and
  // strip detection read this field; it is never guessed server-side.
  const bg = page?.background
  let backgroundHex: string | undefined
  if (bg?.type === 'solid' && /^#?[0-9a-f]{6}$/i.test(bg.color)) {
    backgroundHex = bg.color.startsWith('#') ? bg.color.toLowerCase() : `#${bg.color}`.toLowerCase()
  } else if (bg?.type === 'gradient' && /^#?[0-9a-f]{6}$/i.test(bg.from)) {
    // gradient: report the top-of-list stop; per-text backdrops still
    // handle cards, and the audit treats it as the page base
    backgroundHex = bg.from.startsWith('#') ? bg.from.toLowerCase() : `#${bg.from}`.toLowerCase()
  }

  return {
    name: s.designName,
    // v0.32.1: the design id lets the route read the AUTHORITATIVE
    // stored brief from the database — the posted aiBrief copy is
    // only a fallback
    designId: s.designId,
    width: s.width,
    height: s.height,
    templateType: (s as unknown as { templateType?: string }).templateType,
    pageCount: s.pages.length,
    currentPageIndex: s.currentPage,
    selectedIds: s.selectedIds.slice(0, 20),
    elements,
    // v0.32 (Unified Canvix AI): the design's STORED brief contract —
    // an applied autonomous generation's verified requirements. The
    // route merges it into the run's brief so refinement of the SAME
    // design cannot silently drop a required text or color.
    aiBrief: s.aiBrief ?? null,
    colorsInUse: [
      ...new Set(
        texts
          .map((t) => t.fill)
          .concat((page?.elements ?? []).filter((e) => 'fill' in e).map((e) => (e as { fill: string }).fill)),
      ),
    ].slice(0, 12),
    fontsInUse: [...new Set(texts.map((t) => t.fontFamily))].slice(0, 8),
    brand,
    overlaps,
    offCanvas,
    ...(backgroundHex ? { background: backgroundHex } : {}),
    otherPages: s.pages
      .filter((_, i) => i !== s.currentPage)
      .slice(0, 8)
      .map((p, i) => `p${i}: ${(p.elements ?? []).length} elements`),
  }
}

/** rgba/semi-transparent fill → the element is a glass layer, not a
 *  solid occluder (text on it is intentional layering). */
function isSemiTransparent(fill: string): boolean {
  const m = /^rgba?\(\s*\d{1,3}[\s,]+\d{1,3}[\s,]+\d{1,3}(?:[\s,/]+([\d.]+%?))?\s*\)/i.exec(String(fill).trim())
  if (!m) return false
  if (m[1] === undefined) return false
  const a = m[1].endsWith('%') ? Number(m[1].slice(0, -1)) / 100 : Number(m[1])
  return Number.isFinite(a) && a <= 0.85
}

/** Client-side brief validation against the LIVE document (Phase 5).
 *  Pure — reads the store, returns the validation shape the loop
 *  expects on the bridge.
 *  v0.29.3: flattened elements ride along so composite deliverables
 *  (editor mockup, feature cards, glassmorphism) validate structurally. */
function computeBriefValidation(brief: DesignBrief): { satisfied: boolean; unmet: string[] } {
  const s = useEditorStore.getState()
  const page = s.pages[s.currentPage]
  const els = flatElements(page?.elements ?? [])
  const texts = els.filter((e) => e.type === 'text').map((e) => (e as TextElement).text)
  const colors = new Set<string>()
  for (const el of els) {
    if ('fill' in el && typeof (el as { fill?: unknown }).fill === 'string') {
      colors.add(((el as { fill: string }).fill).toLowerCase())
    }
    if ('stroke' in el && typeof (el as { stroke?: unknown }).stroke === 'string') {
      colors.add(((el as { stroke: string }).stroke).toLowerCase())
    }
  }
  if (page?.background?.type === 'solid') colors.add(page.background.color.toLowerCase())
  if (page?.background?.type === 'gradient') {
    colors.add(page.background.from.toLowerCase())
    colors.add(page.background.to.toLowerCase())
  }
  const elements = els.slice(0, 120).map((e) => ({
    type: e.type,
    x: Math.round(e.x),
    y: Math.round(e.y),
    width: Math.round(e.width),
    height: Math.round(e.height),
    ...( 'fill' in e && typeof (e as { fill?: unknown }).fill === 'string' ? { fill: (e as { fill: string }).fill } : {}),
    ...('stroke' in e && typeof (e as { stroke?: unknown }).stroke === 'string' ? { stroke: (e as { stroke: string }).stroke } : {}),
    ...(e.type === 'text' ? { text: (e as TextElement).text } : {}),
  }))
  const result = validateBrief(brief, {
    texts,
    colors: [...colors],
    width: s.width,
    height: s.height,
    elements,
  })
  return { satisfied: result.satisfied, unmet: result.unmet }
}

// ── the component ────────────────────────────────────────────

export function AssistantApp({ onClose }: AppPanelProps) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  /** live steps of the in-flight run */
  const [liveSteps, setLiveSteps] = useState<RunStep[]>([])
  /** live mode + skills + brief of the in-flight run */
  const [liveMode, setLiveMode] = useState<AgentMode | null>(null)
  const [liveSkills, setLiveSkills] = useState<string[]>([])
  const [liveBrief, setLiveBrief] = useState<DesignBrief | null>(null)
  const [liveUsage, setLiveUsage] = useState<{ turns: number; toolCalls: number; elapsedMs: number; modelCalls: number } | null>(null)
  /** the pinned mode chip ('auto' = classify per message) */
  const [pinnedMode, setPinnedMode] = useState<AgentMode | 'auto'>('auto')
  /** pending destructive confirmation */
  const [pendingConfirm, setPendingConfirm] = useState<{ tool: string; actions: DesignAction[]; callId: string } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const runIdRef = useRef<string | null>(null)
  const confirmedRef = useRef<Set<string>>(new Set())
  const briefRef = useRef<DesignBrief | null>(null)
  const { configured: aiConfigured, loaded: aiLoaded } = useAICapabilities()
  const canUndo = useEditorStore((s) => s.past.length > 0)

  // auto-scroll the thread
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, liveSteps, pendingConfirm])

  const applyActions = useCallback(async (actions: DesignAction[]): Promise<{ ok: boolean; message?: string }> => {
    let lastMsg = ''
    for (const a of actions) {
      try {
        // the __validateBrief pseudo-action is answered separately
        if (a.type === '__validateBrief') {
          lastMsg = 'validated'
          continue
        }
        lastMsg = await applyDesignAction(a)
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : 'Action failed' }
      }
    }
    return { ok: true, message: lastMsg }
  }, [])

  /** side-channel POST to the run's bridge */
  const bridgePost = useCallback(async (payload: Record<string, unknown>) => {
    const runId = runIdRef.current
    if (!runId) return
    try {
      await fetch(`/api/ai/agent?bridge=${encodeURIComponent(runId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch {
      /* the run will time the ack out safely */
    }
  }, [])

  /** Phase 7: visual critique of the current canvas (honest about
   *  availability). Appends findings to the finished turn. */
  const visionCritique = useCallback(async (brief: DesignBrief | null): Promise<{ findings: Finding[]; note: string } | null> => {
    let dataUrl = ''
    try {
      const { captureStage } = await import('@/components/editor/canvas/canvas-bridge')
      // downscale for the payload: capture at a modest scale, jpeg
      dataUrl = await captureStage({ pixelScale: 0.5, mimeType: 'image/jpeg', quality: 0.7 })
    } catch {
      return null
    }
    try {
      const res = await fetch('/api/ai/agent/vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: dataUrl,
          brief: brief
            ? { requiredTexts: brief.requiredTexts, requiredColors: brief.requiredColors }
            : undefined,
          stateSummary: JSON.stringify(buildDesignContext()).slice(0, 6000),
        }),
      })
      if (res.status === 503) {
        return { findings: [], note: 'Visual critique unavailable (no vision model configured) — verified via geometry checks only.' }
      }
      const data = (await res.json().catch(() => ({}))) as { findings?: Finding[]; error?: string }
      if (!res.ok) return { findings: [], note: data.error ?? 'Visual critique failed.' }
      return { findings: data.findings ?? [], note: 'Visual critique completed against the rendered canvas.' }
    } catch {
      return null
    }
  }, [])

  const send = async (message: string) => {
    const text = message.trim()
    if (!text || busy) return
    setInput('')
    const history = turns.slice(-8).map((t) => ({ role: t.role, content: t.content }))
    const baseline = useEditorStore.getState().past.length
    setTurns((ts) => [...ts, { role: 'user', content: text }])
    setBusy(true)
    setLiveSteps([])
    setLiveSkills([])
    setLiveBrief(null)
    setLiveUsage(null)
    confirmedRef.current = new Set()

    // the heuristic pre-classification shows a mode hint even before
    // the server answers (the pinned chip wins when set)
    const expectedMode = pinnedMode === 'auto' ? heuristicMode(text).mode : pinnedMode
    setLiveMode(expectedMode)

    const controller = new AbortController()
    abortRef.current = controller
    const collectedSteps: RunStep[] = []
    let appliedCount = 0
    let summary = ''
    let mode = expectedMode
    let plan: string[] | undefined
    let findings: Finding[] | undefined
    let verification: string | undefined
    let runBrief: DesignBrief | null = null

    try {
      const res = await fetch('/api/ai/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          message: text,
          history,
          design: buildDesignContext(),
          ...(pinnedMode !== 'auto' ? { mode: pinnedMode } : {}),
          confirmed: [...confirmedRef.current],
        }),
      })
      if (!res.ok || !res.body) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(errBody.error ?? `The agent could not start (${res.status}).`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      const handleEvent = async (event: AgentEvent) => {
        switch (event.type) {
          case 'start':
            if (event.runId) {
              runIdRef.current = event.runId
            } else {
              // v1-style start: runId arrives via the observation below
            }
            break
          case 'mode':
            mode = event.mode
            setLiveMode(event.mode)
            break
          case 'skill':
            setLiveSkills((s) => [...s, event.name])
            break
          case 'brief':
            runBrief = event.brief as unknown as DesignBrief
            briefRef.current = runBrief
            setLiveBrief(runBrief)
            break
          case 'plan':
            plan = event.steps
            break
          case 'step': {
            collectedSteps.push({ index: event.index, thought: event.thought, tool: event.tool })
            setLiveSteps([...collectedSteps])
            break
          }
          case 'observation': {
            // the runId rides the first observation (protocol detail)
            if (event.message.startsWith('__runId:')) {
              runIdRef.current = event.message.slice('__runId:'.length)
              return
            }
            const last = collectedSteps[collectedSteps.length - 1]
            if (last) last.observation = event.message
            setLiveSteps([...collectedSteps])
            break
          }
          case 'usage':
            setLiveUsage({ turns: event.turns, toolCalls: event.toolCalls, elapsedMs: event.elapsedMs, modelCalls: event.modelCalls })
            break
          case 'capture': {
            // v0.29.3: the loop asks for the REAL rendered canvas
            // BEFORE completion — same capture pipeline the export and
            // the post-run critique use. Answer on the bridge; a
            // failure answers null (the loop discloses honestly).
            try {
              const { captureStage } = await import('@/components/editor/canvas/canvas-bridge')
              const dataUrl = await captureStage({ pixelScale: 0.5, mimeType: 'image/jpeg', quality: 0.7 })
              await bridgePost({ capture: { image: dataUrl } })
            } catch {
              await bridgePost({ capture: null })
            }
            break
          }
          case 'compact':
            collectedSteps.push({
              index: collectedSteps.length,
              thought: 'Context trimmed',
              tool: 'compact',
              observation: `Older steps summarized (${event.fromMessages} → ${event.toMessages} messages) — the run continues.`,
            })
            setLiveSteps([...collectedSteps])
            break
          case 'action': {
            const actions = event.actions as DesignAction[]
            // the brief-validation pseudo-action never touches the doc
            if (event.tool === 'validate_brief') {
              const brief = briefRef.current
              const result = brief
                ? computeBriefValidation(brief)
                : { satisfied: true, unmet: [] }
              await applyActions(actions) // no-op for the pseudo action
              await bridgePost({ briefResult: result })
              return
            }
            if (event.risk === 'destructive') {
              if (confirmedRef.current.has(event.tool)) {
                // user already approved this tool this run
                const ack = await applyActions(actions)
                if (ack.ok) appliedCount += actions.length
                await bridgePost({ ack: { ok: ack.ok, message: ack.message, design: buildDesignContext() } })
              } else {
                // pause for the user — the route's awaitConfirm waits
                setPendingConfirm({ tool: event.tool, actions, callId: event.callId })
              }
            } else {
              // apply immediately; ack the run with refreshed state
              const ack = await applyActions(actions)
              if (ack.ok) appliedCount += actions.length
              await bridgePost({ ack: { ok: ack.ok, message: ack.message, design: buildDesignContext() } })
            }
            break
          }
          case 'done':
            summary = event.summary
            if (event.verification) verification = event.verification
            break
          case 'error':
            summary = event.message
            break
          case 'aborted':
            summary = event.reason
            break
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const data = line.startsWith('data: ') ? line.slice(6) : ''
          if (!data.trim()) continue
          try {
            await handleEvent(JSON.parse(data) as AgentEvent)
          } catch {
            /* skip a malformed line */
          }
        }
      }

      // Phase 7: after create/improve runs, one visual critique pass
      let critiqueNote: string | undefined
      if ((mode === 'create' || mode === 'improve') && summary && !controller.signal.aborted) {
        const critique = await visionCritique(runBrief ?? briefRef.current)
        if (critique) {
          critiqueNote = critique.note
          if (critique.findings.length) {
            findings = [...(findings ?? []), ...critique.findings]
          }
        }
      }

      setTurns((ts) => [
        ...ts,
        {
          role: 'assistant',
          content: summary || 'Done.',
          steps: collectedSteps,
          appliedActions: appliedCount,
          baseline,
          mode,
          plan,
          findings,
          verification: verification ?? critiqueNote,
          usage: liveUsage ?? undefined,
        },
      ])
    } catch (err) {
      const msg = err instanceof Error && err.name === 'AbortError' ? 'Stopped — applied work is kept.' : err instanceof Error ? err.message : 'The agent failed.'
      setTurns((ts) => [...ts, { role: 'assistant', content: msg, steps: collectedSteps, appliedActions: appliedCount, baseline, mode }])
    } finally {
      setBusy(false)
      setLiveSteps([])
      setLiveMode(null)
      setLiveSkills([])
      setLiveBrief(null)
      setLiveUsage(null)
      setPendingConfirm(null)
      abortRef.current = null
      runIdRef.current = null
    }
  }

  /** destructive-tool gate */
  const resolveConfirm = async (ok: boolean) => {
    const pending = pendingConfirm
    if (!pending) return
    setPendingConfirm(null)
    if (!ok) {
      await bridgePost({ confirm: { tool: pending.tool, ok: false } })
      return
    }
    // apply immediately so the user sees the result, then ack the run.
    // The approval only persists on SUCCESS (per-run scope).
    const ack = await applyActions(pending.actions)
    if (ack.ok) confirmedRef.current.add(pending.tool)
    await bridgePost({ confirm: { tool: pending.tool, ok: true } })
    await bridgePost({ ack: { ok: ack.ok, message: ack.message, design: buildDesignContext() } })
  }

  /** rewind to the run baseline — every agent action was one undo step */
  const undoAgentWork = () => {
    const last = [...turns].reverse().find((t) => t.role === 'assistant' && t.baseline !== undefined)
    if (!last?.baseline) return
    const store = useEditorStore.getState()
    const target = last.baseline
    while (useEditorStore.getState().past.length > target && useEditorStore.getState().past.length > 0) {
      store.undo()
    }
  }

  const stop = () => abortRef.current?.abort()

  return (
    <div className="flex flex-col h-full">
      <AppHeader icon={Sparkles} title="Canvix agent" onClose={onClose} />

      {aiLoaded && !aiConfigured && (
        <div data-testid="agent-no-provider" className="mx-3 mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[12px] text-amber-200">
          No AI provider configured yet — add a key in Admin → AI &amp; models (or your profile) to use the agent.
        </div>
      )}

      {/* mode chips */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-white/5 overflow-x-auto" data-testid="agent-modes">
        {MODE_CHIPS.map((chip) => {
          const active = pinnedMode === chip.id
          const readOnly = chip.id !== 'auto' && READ_ONLY_MODES.includes(chip.id as AgentMode)
          return (
            <button
              key={chip.id}
              onClick={() => setPinnedMode(chip.id)}
              className={cn(
                'shrink-0 px-2.5 h-7 rounded-full text-[11px] font-semibold transition-colors',
                active ? 'bg-[#7630D7] text-white' : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white',
              )}
              title={readOnly ? 'Read-only: the agent cannot modify the design' : chip.id === 'auto' ? 'Classify each message automatically' : undefined}
            >
              {readOnly && <Eye size={10} className="inline mr-1 -mt-0.5" />}
              {chip.label}
            </button>
          )
        })}
      </div>

      {/* thread */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 space-y-3 pr-0.5 px-3 py-3" data-testid="agent-thread">
        {turns.length === 0 && !busy && (
          <div className="pt-6 text-center">
            <div className="mx-auto mb-3 w-11 h-11 rounded-2xl bg-[#7630D7]/15 flex items-center justify-center">
              <Bot size={20} className="text-[#a78bfa]" />
            </div>
            <p className="text-[13px] font-bold text-white/90">Your design agent</p>
            <p className="text-[11px] text-white/40 mt-1 max-w-[240px] mx-auto">
              Describe what to build or change. The agent plans, edits real elements, validates against your brief, and can critique the result visually.
            </p>
            <div className="flex flex-wrap gap-1.5 justify-center mt-4">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="px-2.5 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-[11px] text-white/70 transition-colors">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, i) =>
          turn.role === 'user' ? (
            <div key={i} className="flex gap-2 justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[#7630D7] px-3 py-2 text-[12.5px] text-white leading-relaxed">
                {turn.content}
              </div>
              <div className="w-6 h-6 shrink-0 rounded-full bg-white/10 flex items-center justify-center">
                <User size={12} className="text-white/70" />
              </div>
            </div>
          ) : (
            <div key={i} className="flex gap-2">
              <div className="w-6 h-6 shrink-0 rounded-full bg-[#7630D7]/20 flex items-center justify-center">
                <Bot size={12} className="text-[#a78bfa]" />
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                {turn.mode && (
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-white/40">
                    <Scissors size={10} /> {turn.mode} mode
                    {READ_ONLY_MODES.includes(turn.mode) && <span className="text-[#02C0CC]">· read-only</span>}
                  </div>
                )}
                {turn.steps && turn.steps.length > 0 && (
                  <details className="rounded-xl border border-white/8 bg-white/[0.03] overflow-hidden">
                    <summary className="px-3 py-2 text-[11px] font-semibold text-white/60 cursor-pointer flex items-center gap-1.5">
                      <ListChecks size={12} /> {turn.steps.length} steps · {turn.appliedActions ?? 0} actions
                    </summary>
                    <ol className="px-3 pb-2 space-y-1.5">
                      {turn.steps.map((s, j) => (
                        <li key={j} className="text-[11px] text-white/50 leading-relaxed">
                          <span className="text-white/80 font-mono">{s.tool}</span>
                          {s.thought && <span> — {s.thought}</span>}
                          {s.observation && <div className="text-white/40">{s.observation}</div>}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
                {turn.plan && turn.plan.length > 0 && (
                  <div className="rounded-xl border border-[#02C0CC]/25 bg-[#02C0CC]/8 px-3 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[#02C0CC] mb-1">Proposed plan</p>
                    <ol className="space-y-0.5">
                      {turn.plan.map((p, j) => (
                        <li key={j} className="text-[11.5px] text-white/75">{j + 1}. {p}</li>
                      ))}
                    </ol>
                  </div>
                )}
                {turn.findings && turn.findings.length > 0 && (
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 space-y-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-white/50">Findings</p>
                    {turn.findings.slice(0, 8).map((f, j) => (
                      <div key={j} className="text-[11.5px] leading-relaxed">
                        <span
                          className={cn(
                            'inline-block px-1.5 rounded text-[10px] font-bold mr-1.5',
                            f.severity === 'P0' && 'bg-red-500/20 text-red-300',
                            f.severity === 'P1' && 'bg-amber-500/20 text-amber-300',
                            f.severity === 'P2' && 'bg-blue-500/20 text-blue-300',
                            f.severity === 'P3' && 'bg-white/10 text-white/50',
                          )}
                        >
                          {f.severity}
                        </span>
                        <span className="text-white/80">{f.issue}</span>
                        {f.fix && <span className="text-white/45"> → {f.fix}</span>}
                      </div>
                    ))}
                  </div>
                )}
                <div className="text-[12.5px] text-white/85 leading-relaxed whitespace-pre-wrap">{turn.content}</div>
                {turn.verification && (
                  <div className="flex items-start gap-1.5 text-[11px] text-emerald-300/80">
                    <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
                    <span>{turn.verification}</span>
                  </div>
                )}
                {turn.usage && (
                  <div className="flex items-center gap-2 text-[10px] text-white/35">
                    <Gauge size={10} />
                    <span>
                      {turn.usage.turns} turns · {turn.usage.toolCalls} tools · {Math.round(turn.usage.elapsedMs / 1000)}s · {turn.usage.modelCalls} model calls
                    </span>
                  </div>
                )}
                {turn.appliedActions ? (
                  turn.baseline !== undefined && (
                    <button onClick={undoAgentWork} className="flex items-center gap-1 text-[11px] font-semibold text-white/50 hover:text-white transition-colors">
                      <Undo2 size={11} /> Undo agent work
                    </button>
                  )
                ) : null}
              </div>
            </div>
          ),
        )}

        {/* the live run */}
        {busy && (
          <div className="flex gap-2">
            <div className="w-6 h-6 shrink-0 rounded-full bg-[#7630D7]/20 flex items-center justify-center animate-pulse">
              <Bot size={12} className="text-[#a78bfa]" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              {liveMode && (
                <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-white/40">
                  <span>{liveMode} mode</span>
                  {liveSkills.map((s) => (
                    <span key={s} className="px-1.5 rounded bg-[#02C0CC]/10 text-[#02C0CC] normal-case">{s}</span>
                  ))}
                </div>
              )}
              {liveBrief && (liveBrief.requiredTexts.length > 0 || liveBrief.requiredColors.length > 0) && (
                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-white/50 mb-1">Brief contract (exact)</p>
                  <div className="flex flex-wrap gap-1.5">
                    {liveBrief.requiredTexts.map((t, i) => (
                      <span key={i} className="px-1.5 py-0.5 rounded bg-white/8 text-[10.5px] text-white/80 font-medium">&ldquo;{t.text}&rdquo;</span>
                    ))}
                    {liveBrief.requiredColors.map((c, i) => (
                      <span key={i} className="px-1.5 py-0.5 rounded bg-white/8 text-[10.5px] text-white/80 font-mono flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: c.hex }} />
                        {c.hex.toUpperCase()}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {liveSteps.map((s, i) => (
                <div key={i} className="rounded-lg border border-white/8 bg-white/[0.02] px-2.5 py-1.5">
                  <div className="text-[11px] font-mono text-white/75">{s.tool}</div>
                  {s.thought && <div className="text-[10.5px] text-white/45">{s.thought}</div>}
                  {s.observation && <div className="text-[10.5px] text-emerald-300/70 mt-0.5">{s.observation}</div>}
                </div>
              ))}
              <div className="flex items-center gap-2 text-[11px] text-white/40">
                <Loader2 size={12} className="animate-spin" />
                {pendingConfirm ? 'Waiting for your approval…' : 'Working…'}
                {liveUsage && (
                  <span className="text-white/30">
                    · {liveUsage.toolCalls} tools · {Math.round(liveUsage.elapsedMs / 1000)}s
                  </span>
                )}
                <button onClick={stop} className="ml-auto flex items-center gap-1 px-2 h-6 rounded-full bg-red-500/15 text-red-300 text-[10.5px] font-semibold hover:bg-red-500/25 transition-colors">
                  <Square size={9} /> Stop
                </button>
              </div>
            </div>
          </div>
        )}

        {/* destructive confirmation */}
        {pendingConfirm && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5" data-testid="agent-confirm">
            <div className="flex items-center gap-1.5 text-[12px] font-bold text-amber-200 mb-1">
              <ShieldAlert size={13} /> Approve {pendingConfirm.tool.replace(/_/g, ' ')}?
            </div>
            <ul className="mb-2 space-y-0.5">
              {pendingConfirm.actions.map((a, i) => (
                <li key={i} className="text-[11px] text-amber-100/70">· {describeAction(a)}</li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button onClick={() => resolveConfirm(true)} className="px-3 h-7 rounded-lg bg-amber-500 text-black text-[11.5px] font-bold hover:bg-amber-400 transition-colors">
                Approve once
              </button>
              <button onClick={() => resolveConfirm(false)} className="px-3 h-7 rounded-lg bg-white/10 text-white/80 text-[11.5px] font-semibold hover:bg-white/15 transition-colors">
                Decline
              </button>
            </div>
          </div>
        )}
      </div>

      {/* composer */}
      <div className="p-3 border-t border-white/5">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send(input)
              }
            }}
            rows={1}
            placeholder={pinnedMode !== 'auto' && READ_ONLY_MODES.includes(pinnedMode) ? `Ask for ${pinnedMode} (the design won't be modified)…` : 'Describe what to design or change…'}
            className="flex-1 resize-none max-h-28 rounded-xl bg-white/[0.05] border border-white/10 px-3 py-2 text-[12.5px] text-white placeholder:text-white/30 outline-none focus:border-[#7630D7]"
            data-testid="agent-input"
          />
          <button
            onClick={() => send(input)}
            disabled={busy || !input.trim()}
            className="w-9 h-9 shrink-0 rounded-xl bg-[#7630D7] flex items-center justify-center text-white disabled:opacity-30 transition-opacity"
            aria-label="Send"
            data-testid="agent-send"
          >
            <Send size={15} />
          </button>
        </div>
        <div className="flex items-center justify-between mt-1.5 text-[10px] text-white/30">
          <span>
            {pinnedMode === 'auto' ? 'Auto mode' : `${pinnedMode}${READ_ONLY_MODES.includes(pinnedMode as AgentMode) ? ' · read-only' : ''}`} · full editor access
          </span>
          {canUndo && <span>Undo available in the toolbar</span>}
        </div>
      </div>
    </div>
  )
}
