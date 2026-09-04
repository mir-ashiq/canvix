'use client'

import { useEffect, useRef, useState } from 'react'
import { Bot, Loader2, Plus, Send, Sparkles, User, Wand2 } from 'lucide-react'
import type { AnyElement, TextElement } from '@/lib/types'
import { useEditorStore } from '@/store/editor-store'
import { AppHeader, type AppPanelProps } from './registry'
import { cn } from '@/lib/utils'
import { applyDesignAction, describeAction, type DesignAction } from '@/lib/design-actions'
import { useAICapabilities } from '@/hooks/use-ai-capabilities'

interface Turn {
  role: 'user' | 'assistant'
  content: string
  actions?: DesignAction[]
  done?: { index: number; msg: string }
}

const SUGGESTIONS = [
  'Make this design more modern',
  'Move the title to the top',
  'Change all heading colors to purple',
  'Make the layout more balanced',
  'Add a CTA button text',
  'Magic animate this page',
]

/** Flatten elements (groups included). */
function flatElements(els: AnyElement[], out: AnyElement[] = []): AnyElement[] {
  for (const el of els) {
    out.push(el)
    if (el.type === 'group') flatElements(el.children, out)
  }
  return out
}

/** Build the compact design context the assistant sees. */
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
  const colorsInUse = [...new Set(texts.map((t) => t.fill).concat((page?.elements ?? []).filter((e) => 'fill' in e).map((e) => (e as { fill: string }).fill)))].slice(0, 12)
  const fontsInUse = [...new Set(texts.map((t) => t.fontFamily))].slice(0, 8)
  return {
    name: s.designName,
    width: s.width,
    height: s.height,
    pageCount: s.pages.length,
    currentPageIndex: s.currentPage,
    selectedIds: s.selectedIds.slice(0, 20),
    elements,
    colorsInUse,
    fontsInUse,
  }
}

export function AssistantApp({ onClose }: AppPanelProps) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { configured: aiConfigured, loaded: aiLoaded } = useAICapabilities()
  const canUndo = useEditorStore((s) => s.past.length > 0)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, busy])

  const send = async (message: string) => {
    const text = message.trim()
    if (!text || busy) return
    setInput('')
    const history = turns.slice(-8).map((t) => ({ role: t.role, content: t.content }))
    setTurns((ts) => [...ts, { role: 'user', content: text }])
    setBusy(true)
    try {
      const res = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history, design: buildDesignContext() }),
      })
      const data = (await res.json()) as { reply?: string; actions?: DesignAction[]; error?: string; code?: string }
      if (!res.ok || !data.reply) throw new Error(data.error ?? 'The assistant could not answer.')
      setTurns((ts) => [...ts, { role: 'assistant', content: data.reply!, actions: data.actions ?? [] }])
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Something went wrong.'
      setTurns((ts) => [...ts, { role: 'assistant', content: message }])
    } finally {
      setBusy(false)
    }
  }

  /** Execute one attached action (undoable via Ctrl+Z). */
  const runAction = async (turnIndex: number, actionIndex: number, action: DesignAction) => {
    let msg: string
    try {
      msg = await applyDesignAction(action)
    } catch (e) {
      msg = e instanceof Error ? e.message : 'Action failed'
    }
    setTurns((ts) => ts.map((t, i) => (i === turnIndex ? { ...t, done: { index: actionIndex, msg } } : t)))
  }

  const empty = turns.length === 0 && !busy

  return (
    <div className="flex flex-col">
      <AppHeader icon={Bot} title="Canvix AI assistant" onClose={onClose} />

      {/* AI provider missing — honest notice */}
      {aiLoaded && !aiConfigured && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-2.5 text-[11px] text-amber-200/80 mb-2.5">
          <strong>AI provider not configured.</strong> Design actions, Magic Write and image generation need a server
          AI provider. Layout balancing and palettes still work locally.
        </div>
      )}

      {/* chat log */}
      <div ref={scrollRef} className="h-[340px] overflow-y-auto cv-scroll rounded-xl border border-white/10 bg-white/[0.03] p-2.5 space-y-2.5 mb-2.5">
        {empty && (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#7630D7] to-[#02C0CC] flex items-center justify-center shadow-lg">
              <Sparkles size={20} className="text-white" />
            </div>
            <p className="text-[13px] font-bold text-white">Your design-aware copilot</p>
            <p className="text-[11px] text-white/50 leading-snug">
              It sees your page — elements, colors, fonts and layout. Ask it to restyle, move, recolor or animate
              anything. Every change is undoable (Ctrl+Z).
            </p>
          </div>
        )}

        {turns.map((t, i) => (
          <div key={i} className={cn('flex gap-2', t.role === 'user' && 'flex-row-reverse')}>
            <div
              className={cn(
                'w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5',
                t.role === 'user' ? 'bg-white/12 text-white/80' : 'bg-gradient-to-br from-[#7630D7] to-[#9B6BFF] text-white'
              )}
              aria-hidden
            >
              {t.role === 'user' ? <User size={12} /> : <Bot size={12} />}
            </div>
            <div className="min-w-0 max-w-[85%]">
              <div
                className={cn(
                  'rounded-2xl px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap',
                  t.role === 'user' ? 'bg-[#7630D7] text-white rounded-tr-sm' : 'bg-white/[0.07] text-white/90 rounded-tl-sm border border-white/[0.06]'
                )}
              >
                {t.content}
              </div>

              {/* action chips */}
              {t.actions && t.actions.length > 0 && (
                <div className="mt-1.5 space-y-1">
                  {t.actions.map((a, j) => {
                    const done = t.done?.index === j
                    return (
                      <div key={j} className="flex gap-1.5">
                        <button
                          disabled={done}
                          onClick={() => void runAction(i, j, a)}
                          className={cn(
                            'flex-1 flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-[11px] font-semibold transition-colors',
                            done
                              ? 'border-[#02C0CC]/30 bg-[#02C0CC]/10 text-[#7BE8EC]'
                              : 'border-[#7630D7]/40 bg-[#7630D7]/15 text-white hover:bg-[#7630D7]/30 cursor-pointer'
                          )}
                        >
                          <Wand2 size={12} className="shrink-0" />
                          <span className="min-w-0 truncate">{done ? t.done?.msg : describeAction(a)}</span>
                          {!done && <Plus size={11} className="ml-auto shrink-0" />}
                        </button>
                      </div>
                    )
                  })}
                  {t.done && canUndo && (
                    <button
                      onClick={() => useEditorStore.getState().undo()}
                      className="text-[10px] font-semibold text-white/40 hover:text-white/80 underline underline-offset-2 cursor-pointer"
                    >
                      Undo last change (Ctrl+Z)
                    </button>
                  )}
                  <PaletteSwatches turn={t} />
                </div>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex gap-2">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-[#7630D7] to-[#9B6BFF] flex items-center justify-center shrink-0 mt-0.5">
              <Bot size={12} className="text-white" />
            </div>
            <div className="rounded-2xl rounded-tl-sm bg-white/[0.07] border border-white/[0.06] px-3 py-2.5 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-white/60 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-white/60 animate-bounce" style={{ animationDelay: '120ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-white/60 animate-bounce" style={{ animationDelay: '240ms' }} />
            </div>
          </div>
        )}
      </div>

      {/* suggestions */}
      {empty && (
        <div className="space-y-1 mb-2.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => void send(s)}
              className="block w-full text-left text-[11px] text-white/55 hover:text-white rounded-lg border border-white/[0.07] hover:border-white/20 px-2.5 py-1.5 transition-colors cursor-pointer"
            >
              “{s}”
            </button>
          ))}
        </div>
      )}

      {/* input */}
      <div className="flex gap-1.5">
        <div className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] focus-within:border-[#7630D7] transition-colors px-3 flex items-center">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void send(input)}
            placeholder="Ask your copilot…"
            maxLength={800}
            className="w-full bg-transparent outline-none text-[12.5px] text-white placeholder:text-white/35 h-10"
            aria-label="Message the Canvix AI assistant"
          />
        </div>
        <button
          onClick={() => void send(input)}
          disabled={busy || !input.trim()}
          className="w-10 h-10 rounded-xl bg-gradient-to-r from-[#7630D7] to-[#9B6BFF] text-white flex items-center justify-center disabled:opacity-40 hover:brightness-110 transition-all shrink-0"
          aria-label="Send message"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
      </div>
    </div>
  )
}

/** inline palette preview for suggestPalette actions */
function PaletteSwatches({ turn }: { turn: Turn }) {
  const palette = turn.actions?.find((a) => a.type === 'suggestPalette') as { colors?: string[] } | undefined
  if (!palette?.colors?.length) return null
  return (
    <div className="flex gap-1 pt-0.5">
      {palette.colors.map((c) => (
        <span key={c} className="flex-1 h-4 rounded-md border border-white/15" style={{ background: c }} title={c} />
      ))}
    </div>
  )
}
