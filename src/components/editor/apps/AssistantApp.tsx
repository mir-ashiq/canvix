'use client'

// ─────────────────────────────────────────────────────────────
// AssistantApp (v0.27) — the Canvix design agent panel.
//
// Rebuilt from the single-shot chat on the research synthesis
// (docs/AGENT-ARCHITECTURE.md):
//  · streaming SSE run view — thought → tool → observation, live
//  · auto-apply (kept from v0.26) with a confirm gate for
//    destructive tools
//  · Stop button mid-run (completed work is kept)
//  · "Undo agent work" — rewinds the editor history to the run's
//    baseline (every agent action was one undo step)
//  · session memory — the conversation persists in the panel; the
//    goal of the current run stays in context for scoped refinements
//  · ask/act/plan routing happens server-side (src/lib/agent/router)
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, Loader2, Send, Sparkles, User, Wand2, Zap, Square, Undo2, ShieldAlert, ListChecks } from 'lucide-react'
import type { AnyElement, TextElement } from '@/lib/types'
import { useEditorStore } from '@/store/editor-store'
import { AppHeader, type AppPanelProps } from './registry'
import { cn } from '@/lib/utils'
import { applyDesignAction, describeAction, type DesignAction } from '@/lib/design-actions'
import { useAICapabilities } from '@/hooks/use-ai-capabilities'
import type { AgentEvent } from '@/lib/agent/protocol'

// ── types ────────────────────────────────────────────────────

interface RunStep {
  index: number
  thought: string
  tool: string
  observation?: string
}

interface Turn {
  role: 'user' | 'assistant'
  content: string
  /** streamed steps of the run that produced this turn */
  steps?: RunStep[]
  /** actions this turn executed (auto or approved) */
  appliedActions?: number
  /** the run's baseline undo length — powers "Undo agent work" */
  baseline?: number
}

const SUGGESTIONS = [
  'Design a bold Instagram post for a coffee launch',
  'Fix anything that overlaps',
  'Make this design more modern',
  'Add a CTA button text',
  'Balance the layout',
  'What do you think of this design?',
]

const AUTO_APPLY_KEY = 'canvix-assistant-auto-apply'
function readAutoApply(): boolean {
  try {
    const v = localStorage.getItem(AUTO_APPLY_KEY)
    return v === null ? true : v === '1'
  } catch {
    return true
  }
}

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
    } else if ('fill' in el) {
      base.fill = (el as { fill: string }).fill
    }
    if (el.name) base.name = el.name.slice(0, 30)
    return base
  })
  const texts = flatElements(page?.elements ?? []).filter((e) => e.type === 'text') as TextElement[]

  // spatial analysis (v0.26 logic, client-computed for the agent context)
  const boxes = (page?.elements ?? [])
    .filter((e) => (e.width ?? 0) > 0 && (e.height ?? 0) > 0)
    .map((e) => ({ id: e.id, type: e.type, x: e.x, y: e.y, w: e.width, h: e.height }))
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
        if (inter / minArea > 0.55 && smaller.type === 'text') continue // text-on-card
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

  return {
    name: s.designName,
    width: s.width,
    height: s.height,
    templateType: (s as unknown as { templateType?: string }).templateType,
    pageCount: s.pages.length,
    currentPageIndex: s.currentPage,
    selectedIds: s.selectedIds.slice(0, 20),
    elements,
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
    otherPages: s.pages
      .filter((_, i) => i !== s.currentPage)
      .slice(0, 8)
      .map((p, i) => `p${i}: ${(p.elements ?? []).length} elements`),
  }
}

// ── the component ────────────────────────────────────────────

export function AssistantApp({ onClose }: AppPanelProps) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  /** live steps of the in-flight run */
  const [liveSteps, setLiveSteps] = useState<RunStep[]>([])
  /** pending destructive confirmation */
  const [pendingConfirm, setPendingConfirm] = useState<{ tool: string; actions: DesignAction[]; callId: string } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const runIdRef = useRef<string | null>(null)
  const confirmedRef = useRef<Set<string>>(new Set())
  const { configured: aiConfigured, loaded: aiLoaded } = useAICapabilities()
  const canUndo = useEditorStore((s) => s.past.length > 0)

  const [autoApply, setAutoApply] = useState(() => readAutoApply())
  const toggleAutoApply = () => {
    const next = !autoApply
    setAutoApply(next)
    try {
      localStorage.setItem(AUTO_APPLY_KEY, next ? '1' : '0')
    } catch {
      /* storage unavailable */
    }
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, liveSteps, busy, pendingConfirm])

  /** side-channel POST to the run's bridge (acks + confirmations) */
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
      /* the run notices the timeout and self-heals */
    }
  }, [])

  const applyActions = useCallback(async (actions: DesignAction[]): Promise<{ ok: boolean; message?: string }> => {
    let lastMsg = ''
    for (const a of actions) {
      try {
        lastMsg = await applyDesignAction(a)
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : 'Action failed' }
      }
    }
    return { ok: true, message: lastMsg }
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
    confirmedRef.current = new Set()

    const controller = new AbortController()
    abortRef.current = controller
    const collectedSteps: RunStep[] = []
    let appliedCount = 0
    let summary = ''

    try {
      const res = await fetch('/api/ai/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          message: text,
          history,
          design: buildDesignContext(),
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
          case 'action': {
            const actions = event.actions as DesignAction[]
            if (event.risk === 'destructive') {
              if (confirmedRef.current.has(event.tool)) {
                // user already approved this tool this run (or
                // auto-apply is on and they approved earlier)
                const ack = await applyActions(actions)
                if (ack.ok) appliedCount += actions.length
                await bridgePost({ ack: { ok: ack.ok, message: ack.message, design: buildDesignContext() } })
              } else {
                // pause for the user — the route's awaitConfirm waits
                setPendingConfirm({ tool: event.tool, actions, callId: event.callId })
              }
            } else {
              // apply immediately (auto and manual modes alike — manual
              // reviewers get per-run Undo + the destructive gate)
              const ack = await applyActions(actions)
              if (ack.ok) appliedCount += actions.length
              await bridgePost({ ack: { ok: ack.ok, message: ack.message, design: buildDesignContext() } })
            }
            break
          }
          case 'done':
            summary = event.summary
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

      setTurns((ts) => [
        ...ts,
        {
          role: 'assistant',
          content: summary || 'Done.',
          steps: collectedSteps,
          appliedActions: appliedCount,
          baseline,
        },
      ])
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setTurns((ts) => [
          ...ts,
          {
            role: 'assistant',
            content: 'Stopped — everything applied so far is kept. Undo it with the button below if needed.',
            steps: collectedSteps,
            appliedActions: appliedCount,
            baseline,
          },
        ])
      } else {
        const msg = e instanceof Error ? e.message : 'Something went wrong.'
        setTurns((ts) => [
          ...ts,
          {
            role: 'assistant',
            content: `${msg}\n\nTip: add your own AI key in Profile & AI keys (account menu) — your key is used before this instance's providers.`,
          },
        ])
      }
    } finally {
      setBusy(false)
      setLiveSteps([])
      setPendingConfirm(null)
      runIdRef.current = null
      abortRef.current = null
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
    // apply immediately so the user sees the result, then ack the run
    // (the loop now also waits for this ack on approved destructive
    // calls — a failed apply must be reported, not counted as done).
    // The approval only persists on SUCCESS — a failed apply must
    // re-ask, not silently auto-apply the retry (v0.27.3 audit fix).
    const ack = await applyActions(pending.actions)
    if (ack.ok) confirmedRef.current.add(pending.tool)
    await bridgePost({ confirm: { tool: pending.tool, ok: true } })
    await bridgePost({ ack: { ok: ack.ok, message: ack.message, design: buildDesignContext() } })
  }

  const stop = () => {
    abortRef.current?.abort()
  }

  /** rewind to the run baseline — every agent action was one undo step */
  const undoAgentWork = (baseline: number) => {
    const s = useEditorStore.getState()
    const steps = s.past.length - baseline
    if (steps <= 0) return
    for (let i = 0; i < steps; i++) s.undo()
  }

  const empty = turns.length === 0 && !busy

  return (
    <div className="flex flex-col">
      <AppHeader icon={Bot} title="Canvix AI" onClose={onClose}>
        <button
          onClick={toggleAutoApply}
          className={cn(
            'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-bold transition-colors',
            autoApply
              ? 'border-[#02C0CC]/40 bg-[#02C0CC]/15 text-[#7BE8EC]'
              : 'border-white/12 bg-white/[0.04] text-white/55 hover:text-white/80'
          )}
          title={
            autoApply
              ? 'Auto-apply ON — actions run automatically; destructive tools still ask first.'
              : 'Auto-apply OFF — destructive tools ask first; other actions run and are undoable.'
          }
          aria-pressed={autoApply}
          data-testid="assistant-auto-apply"
        >
          <Zap size={11} /> Auto {autoApply ? 'on' : 'off'}
        </button>
      </AppHeader>

      {/* provider hint */}
      {aiLoaded && !aiConfigured && !busy && (
        <div
          className="mb-2.5 rounded-xl border border-[#FFD166]/25 bg-[#FFD166]/10 px-3 py-2 text-[11px] text-[#FFE9A8] leading-relaxed"
          data-testid="agent-no-provider"
        >
          No AI provider on this instance. Add your own key in <span className="font-semibold">Profile &amp; AI keys</span> (account
          menu) — your key is used first.
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 space-y-3 pr-0.5" data-testid="agent-thread">
        {/* empty state */}
        {empty && (
          <div className="py-6 text-center">
            <div className="mx-auto h-12 w-12 rounded-2xl bg-brand-gradient flex items-center justify-center text-white mb-3">
              <Sparkles size={22} />
            </div>
            <p className="text-[13px] font-bold text-white/90">Your design agent</p>
            <p className="mt-1 text-[11.5px] text-white/45 leading-relaxed max-w-[240px] mx-auto">
              Describe a change or a whole design — I&apos;ll plan, act on the canvas step by step, and verify the result. Every step
              is undoable.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => void send(s)}
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-[11.5px] font-medium text-white/75 hover:border-[#7630D7]/50 hover:bg-[#7630D7]/10 hover:text-white transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* conversation */}
        {turns.map((t, i) => (
          <div key={i} className={cn('flex gap-2', t.role === 'user' ? 'justify-end' : 'justify-start')}>
            {t.role === 'assistant' && (
              <div className="h-6 w-6 rounded-lg bg-brand-gradient flex items-center justify-center text-white shrink-0 mt-0.5">
                <Bot size={13} />
              </div>
            )}
            <div
              className={cn(
                'max-w-[85%] rounded-2xl px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap',
                t.role === 'user' ? 'bg-[#7630D7] text-white rounded-br-sm' : 'bg-white/[0.05] text-white/90 rounded-tl-sm'
              )}
            >
              {t.content}
              {/* the run's steps, kept after completion */}
              {t.steps && t.steps.length > 0 && (
                <div className="mt-2 border-t border-white/10 pt-2 space-y-1">
                  <div className="text-[9.5px] font-semibold text-white/35 uppercase tracking-wide flex items-center gap-1">
                    <ListChecks size={10} /> {t.steps.length} step{t.steps.length > 1 ? 's' : ''}
                    {t.appliedActions ? ` · ${t.appliedActions} change${t.appliedActions > 1 ? 's' : ''} applied` : ''}
                  </div>
                  {t.steps.map((s) => (
                    <div key={s.index} className="text-[10.5px] text-white/50 leading-snug">
                      <span className="text-[#02C0CC] font-semibold">{s.tool}</span>
                      {s.thought ? ` — ${s.thought}` : ''}
                      {s.observation ? <span className="block text-white/35">↳ {s.observation}</span> : null}
                    </div>
                  ))}
                  {t.appliedActions ? (
                    <UndoAgentWorkButton baseline={t.baseline} onUndo={undoAgentWork} />
                  ) : null}
                </div>
              )}
            </div>
            {t.role === 'user' && (
              <div className="h-6 w-6 rounded-lg bg-white/10 flex items-center justify-center text-white/60 shrink-0 mt-0.5">
                <User size={13} />
              </div>
            )}
          </div>
        ))}

        {/* live run */}
        {busy && (
          <div className="flex gap-2">
            <div className="h-6 w-6 rounded-lg bg-brand-gradient flex items-center justify-center text-white shrink-0 mt-0.5 animate-pulse">
              <Bot size={13} />
            </div>
            <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white/[0.05] px-3 py-2">
              {liveSteps.length === 0 && (
                <div className="flex items-center gap-2 text-[12px] text-white/60">
                  <Loader2 size={13} className="animate-spin" /> Thinking…
                </div>
              )}
              <div className="space-y-1">
                {liveSteps.map((s) => (
                  <div key={s.index} className="text-[11px] leading-snug" data-testid="agent-live-step">
                    <span className={cn('font-semibold', s.observation ? 'text-[#7BE8EC]' : 'text-[#02C0CC]')}>
                      {s.observation ? '✓' : '…'} {s.tool}
                    </span>
                    {s.thought ? <span className="text-white/50"> — {s.thought}</span> : null}
                    {s.observation ? <span className="block text-white/40">{s.observation}</span> : null}
                  </div>
                ))}
              </div>
              <button
                onClick={stop}
                className="mt-2 inline-flex items-center gap-1 rounded-full border border-white/12 px-2.5 py-1 text-[10px] font-semibold text-white/60 hover:text-white hover:border-white/30 transition-colors"
                data-testid="agent-stop"
              >
                <Square size={9} /> Stop (keeps applied work)
              </button>
            </div>
          </div>
        )}

        {/* destructive confirmation */}
        {pendingConfirm && (
          <div className="rounded-2xl border border-[#FF8A8A]/30 bg-[#FF8A8A]/10 px-3 py-2.5" data-testid="agent-confirm">
            <div className="flex items-center gap-1.5 text-[11.5px] font-bold text-[#FFB4B4]">
              <ShieldAlert size={13} /> {pendingConfirm.tool.replace('_', ' ')} — needs your OK
            </div>
            <div className="mt-1.5 space-y-1">
              {pendingConfirm.actions.slice(0, 3).map((a, j) => (
                <div key={j} className="text-[11px] text-white/70 flex items-center gap-1.5">
                  <Wand2 size={10} className="text-[#FF8A8A] shrink-0" /> {describeAction(a)}
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => void resolveConfirm(true)}
                className="rounded-full bg-[#FF5C5C] hover:bg-[#ff7676] px-3 py-1 text-[11px] font-bold text-white transition-colors"
              >
                Yes, do it
              </button>
              <button
                onClick={() => void resolveConfirm(false)}
                className="rounded-full border border-white/15 px-3 py-1 text-[11px] font-bold text-white/70 hover:text-white hover:border-white/35 transition-colors"
              >
                Skip this
              </button>
            </div>
          </div>
        )}
      </div>

      {/* input */}
      <form
        className="mt-2.5 flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          void send(input)
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={busy ? 'Agent is working…' : 'Describe a change or a whole design…'}
          disabled={busy || !!pendingConfirm}
          className="flex-1 h-9 rounded-xl bg-white/[0.06] border border-white/12 px-3 text-[12px] text-white placeholder:text-white/30 outline-none focus:border-[#7630D7] transition-colors disabled:opacity-50"
          aria-label="Message the design agent"
          maxLength={2000}
        />
        <button
          type="submit"
          disabled={busy || !input.trim() || !!pendingConfirm}
          className="h-9 w-9 rounded-xl btn-brand-gradient flex items-center justify-center text-white disabled:opacity-40 transition-opacity"
          aria-label="Send"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
      </form>
      {canUndo && !busy && (
        <button
          onClick={() => useEditorStore.getState().undo()}
          className="mt-1.5 self-start inline-flex items-center gap-1 text-[10px] font-semibold text-white/35 hover:text-white/70 transition-colors"
        >
          <Undo2 size={10} /> Undo last change (Ctrl+Z)
        </button>
      )}
    </div>
  )
}

/** the per-run Undo button — renders only while the run still has
 *  rewinds left (avoids reading the store during render for stale turns) */
function UndoAgentWorkButton({ baseline, onUndo }: { baseline: number | undefined; onUndo: (b: number) => void }) {
  const pastLen = useEditorStore((s) => s.past.length)
  if (baseline === undefined || pastLen <= baseline) return null
  return (
    <button
      onClick={() => onUndo(baseline)}
      className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-white/40 hover:text-white/80 underline underline-offset-2"
    >
      <Undo2 size={10} /> Undo agent work
    </button>
  )
}
