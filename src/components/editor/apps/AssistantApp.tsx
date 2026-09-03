'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Loader2, Plus, Send, Sparkles, User, Palette, Languages, Type, ImageIcon } from 'lucide-react'
import { createImageElement, createTextElement, type AnyElement, type TextElement } from '@/lib/types'
import { useEditorStore } from '@/store/editor-store'
import { AppHeader, type AppPanelProps } from './registry'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

type AssistantAction =
  | { type: 'addText'; text: string; fontSize?: number; bold?: boolean }
  | { type: 'generateImage'; prompt: string }
  | { type: 'suggestPalette'; colors: string[] }
  | { type: 'translate'; language: string }

interface Turn {
  role: 'user' | 'assistant'
  content: string
  actions?: AssistantAction[]
  done?: { action: string; msg: string }
}

const SUGGESTIONS = [
  'Write a bold headline for a coffee shop sale',
  'Suggest a colour palette for a beach party poster',
  'Give me 3 tagline ideas for a fitness app',
  'What visual should I generate for a tech launch?',
]

/** Collect text contents for design context (flattens groups). */
function collectTexts(els: AnyElement[], out: TextElement[] = []): TextElement[] {
  for (const el of els) {
    if (el.type === 'text') out.push(el)
    else if (el.type === 'group') collectTexts(el.children, out)
  }
  return out
}

const ACTION_META: Record<AssistantAction['type'], { icon: typeof Plus; label: (a: never) => string }> = {
  addText: { icon: Type, label: (a: AssistantAction & { type: 'addText' }) => `Add text: "${a.text.slice(0, 42)}${a.text.length > 42 ? '…' : ''}"` },
  generateImage: { icon: ImageIcon, label: (a: AssistantAction & { type: 'generateImage' }) => `Generate image: ${a.prompt.slice(0, 48)}${a.prompt.length > 48 ? '…' : ''}` },
  suggestPalette: { icon: Palette, label: (a: AssistantAction & { type: 'suggestPalette' }) => `Use these colours` },
  translate: { icon: Languages, label: (a: AssistantAction & { type: 'translate' }) => `Translate design to ${a.language}` },
}

export function AssistantApp({ onClose }: AppPanelProps) {
  const store = useEditorStore()
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

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
      const texts = collectTexts(store.pages.flatMap((p) => p.elements))
      const res = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history,
          design: {
            name: store.designName,
            width: store.width,
            height: store.height,
            pageCount: store.pages.length,
            currentPageElements: store.pages[store.currentPage]?.elements.length ?? 0,
            textContents: texts.map((t) => t.text).slice(0, 40),
          },
        }),
      })
      const data = (await res.json()) as { reply?: string; actions?: AssistantAction[]; error?: string }
      if (!res.ok || !data.reply) throw new Error(data.error ?? 'The assistant could not answer.')
      setTurns((ts) => [...ts, { role: 'assistant', content: data.reply!, actions: data.actions ?? [] }])
    } catch (e) {
      setTurns((ts) => [...ts, { role: 'assistant', content: e instanceof Error ? e.message : 'Something went wrong.' }])
    } finally {
      setBusy(false)
    }
  }

  /** run an attached action; mark it done on its turn */
  const runAction = async (turnIndex: number, action: AssistantAction) => {
    const { pages, designName, designId, width, height } = store
    let msg = ''
    if (action.type === 'addText') {
      const el = createTextElement({
        text: action.text,
        fontSize: action.fontSize ?? (action.bold ? 72 : 42),
        bold: action.bold ?? false,
        x: width * 0.1,
        y: height * 0.4,
        width: width * 0.8,
        align: 'center',
      })
      store.addElement(el)
      msg = 'Text added to the canvas'
    } else if (action.type === 'generateImage') {
      msg = 'Image generated and added'
      try {
        const res = await fetch('/api/ai/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: action.prompt }),
        })
        const data = (await res.json()) as { dataUrl?: string; width?: number; height?: number; error?: string }
        if (!res.ok || !data.dataUrl) throw new Error(data.error ?? 'Generation failed')
        const iw = data.width ?? 1024
        const ih = data.height ?? 1024
        const scale = Math.min((width * 0.7) / iw, (height * 0.7) / ih, 1)
        store.addElement(
          createImageElement(data.dataUrl, iw, ih, {
            x: (width - iw * scale) / 2,
            y: (height - ih * scale) / 2,
            width: Math.round(iw * scale),
            height: Math.round(ih * scale),
          })
        )
      } catch (e) {
        msg = e instanceof Error ? e.message : 'Image generation failed'
      }
    } else if (action.type === 'suggestPalette') {
      // apply as the page's Brand Kit palette + toast
      const brand = { ...store.brand, palettes: [action.colors, ...(store.brand.palettes ?? [])].slice(0, 4) }
      store.setBrand(brand)
      msg = 'Palette saved to your Brand Kit'
    } else if (action.type === 'translate') {
      const texts = collectTexts(pages.flatMap((p) => p.elements))
      if (!texts.length) {
        msg = 'No text to translate'
      } else {
        msg = `Translated ${texts.length} text${texts.length === 1 ? '' : 's'} to ${action.language}`
        try {
          const res = await fetch('/api/ai/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ language: action.language, texts: texts.map((t) => t.text) }),
          })
          const data = (await res.json()) as { translations?: string[]; error?: string }
          if (!res.ok || !Array.isArray(data.translations) || data.translations.length !== texts.length) {
            throw new Error(data.error ?? 'Translation failed')
          }
          store.translateTexts(texts.map((t, i) => ({ id: t.id, text: data.translations![i] })))
        } catch (e) {
          msg = e instanceof Error ? e.message : 'Translation failed'
        }
      }
    }
    toast({ title: 'Canvix AI', description: msg })
    setTurns((ts) => ts.map((t, i) => (i === turnIndex ? { ...t, done: { action: action.type, msg } } : t)))
  }

  const empty = turns.length === 0 && !busy

  return (
    <div className="flex flex-col">
      <AppHeader icon={Bot} title="Canvix AI assistant" onClose={onClose} />

      {/* chat log */}
      <div ref={scrollRef} className="h-[340px] overflow-y-auto cv-scroll rounded-xl border border-white/10 bg-white/[0.03] p-2.5 space-y-2.5 mb-2.5">
        {empty && (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#7630D7] to-[#02C0CC] flex items-center justify-center shadow-lg">
              <Sparkles size={20} className="text-white" />
            </div>
            <p className="text-[13px] font-bold text-white">Your creative copilot</p>
            <p className="text-[11px] text-white/50 leading-snug">
              Ask for headline ideas, colour palettes, taglines — or let it generate images and
              translate the whole design. It sees your current design.
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
                    const meta = ACTION_META[a.type]
                    const done = t.done?.action === a.type
                    const Icon = meta.icon
                    return (
                      <button
                        key={j}
                        disabled={done}
                        onClick={() => void runAction(i, a)}
                        className={cn(
                          'w-full flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-[11px] font-semibold transition-colors',
                          done
                            ? 'border-[#02C0CC]/30 bg-[#02C0CC]/10 text-[#7BE8EC]'
                            : 'border-[#7630D7]/40 bg-[#7630D7]/15 text-white hover:bg-[#7630D7]/30'
                        )}
                      >
                        <Icon size={13} className="shrink-0" />
                        <span className="min-w-0 truncate">{done ? t.done?.msg : meta.label(a as never)}</span>
                        {!done && <Plus size={11} className="ml-auto shrink-0" />}
                      </button>
                    )
                  })}
                  {a_chipSwatches(t)}
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
              className="block w-full text-left text-[11px] text-white/55 hover:text-white rounded-lg border border-white/[0.07] hover:border-white/20 px-2.5 py-1.5 transition-colors"
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
function a_chipSwatches(turn: Turn) {
  const palette = turn.actions?.find((a) => a.type === 'suggestPalette') as { colors: string[] } | undefined
  if (!palette) return null
  const done = turn.done?.action === 'suggestPalette'
  return (
    <div className="flex gap-1 pt-0.5" aria-hidden={done}>
      {palette.colors.map((c) => (
        <span key={c} className="flex-1 h-4 rounded-md border border-white/15" style={{ background: c }} title={c} />
      ))}
    </div>
  )
}
