'use client'

import { useState } from 'react'
import { Bot, Loader2, Check, Eye, EyeOff, Sparkles } from 'lucide-react'
import { useEditorStore } from '@/store/editor-store'
import { planToPages, type DesignPlan, type PlanPageSpec } from '@/lib/design-plan'
import { AppHeader, type AppPanelProps } from './registry'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

const IDEAS = [
  'A 4-page launch deck for a specialty coffee subscription — warm, cozy, earthy',
  'Instagram post + story for a fitness studio opening — bold, high energy',
  '3-page pitch outline for an eco packaging startup — clean, green, minimal',
]

/**
 * v0.19 (Wave 4) — Agentic design planning with an EDITABLE REVIEW GATE.
 *
 * Step 1: the user describes the design; /api/ai/plan returns a
 * structured multi-page plan (nothing is applied yet).
 * Step 2: the gate — every page and element can be toggled, every text
 * rewritten, colors seen — before anything lands.
 * Step 3: Apply → planToPages() → store.appendPages() as fully editable
 * native elements. Ctrl+Z undoes the whole apply.
 */
export function AIPlanApp({ onClose }: AppPanelProps) {
  const [prompt, setPrompt] = useState('')
  const [pageCount, setPageCount] = useState(2)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [plan, setPlan] = useState<DesignPlan | null>(null)

  const width = useEditorStore((s) => s.width)
  const height = useEditorStore((s) => s.height)

  const generate = async () => {
    if (!prompt.trim() || busy) return
    setBusy(true)
    setError(null)
    setPlan(null)
    try {
      const res = await fetch('/api/ai/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), width, height, pageCount }),
      })
      const data = (await res.json()) as { plan?: DesignPlan; error?: string }
      if (!res.ok || !data.plan) throw new Error(data.error ?? 'Planning failed')
      setPlan(data.plan)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Planning failed')
    } finally {
      setBusy(false)
    }
  }

  const togglePage = (id: string) => {
    setPlan((p) =>
      p ? { ...p, pages: p.pages.map((pg) => (pg.id === id ? { ...pg, enabled: !pg.enabled } : pg)) } : p,
    )
  }
  const toggleElement = (pageId: string, elId: string) => {
    setPlan((p) =>
      p
        ? {
            ...p,
            pages: p.pages.map((pg) =>
              pg.id !== pageId
                ? pg
                : { ...pg, elements: pg.elements.map((el) => (el.id === elId ? { ...el, enabled: !el.enabled } : el)) },
            ),
          }
        : p,
    )
  }
  const editText = (pageId: string, elId: string, text: string) => {
    setPlan((p) =>
      p
        ? {
            ...p,
            pages: p.pages.map((pg) =>
              pg.id !== pageId
                ? pg
                : { ...pg, elements: pg.elements.map((el) => (el.id === elId ? { ...el, text } : el)) },
            ),
          }
        : p,
    )
  }

  const apply = () => {
    if (!plan) return
    const pages = planToPages(plan)
    if (!pages.length) {
      toast({ title: 'Nothing to apply', description: 'Enable at least one page with elements.' })
      return
    }
    useEditorStore.getState().appendPages(pages)
    toast({
      title: `${pages.length} page${pages.length > 1 ? 's' : ''} added`,
      description: 'Fully editable elements. Ctrl+Z removes them all.',
    })
    onClose()
  }

  const enabledPages = plan?.pages.filter((p) => p.enabled).length ?? 0
  const enabledElements =
    plan?.pages.filter((p) => p.enabled).reduce((n, p) => n + p.elements.filter((e) => e.enabled).length, 0) ?? 0

  return (
    <div>
      <AppHeader icon={Bot} title="AI design plan" onClose={onClose} />
      <p className="text-[11.5px] text-white/50 leading-snug mb-3">
        Describe the design — the agent drafts a full multi-page plan you REVIEW and EDIT before a single
        element lands on the canvas.
      </p>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="e.g. A 3-page menu for an Italian trattoria — rustic, warm, handwritten accents"
        className="w-full h-24 rounded-xl bg-white/[0.05] border border-white/10 text-white text-[12.5px] p-3 resize-none focus:outline-none focus:border-[#02C0CC]"
        maxLength={2000}
        aria-label="Design brief"
      />

      <div className="flex items-center gap-2 mt-2.5">
        <span className="text-[11px] text-white/50">Pages</span>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 6].map((n) => (
            <button
              key={n}
              onClick={() => setPageCount(n)}
              className={cn(
                'w-8 h-8 rounded-lg text-[11px] font-bold transition-colors',
                pageCount === n ? 'bg-[#7630D7] text-white' : 'bg-white/[0.05] text-white/60 hover:bg-white/10',
              )}
              aria-pressed={pageCount === n}
            >
              {n}
            </button>
          ))}
        </div>
        <button
          className="btn-cv h-9 px-4 ml-auto text-[12px] flex items-center gap-1.5 disabled:opacity-60"
          onClick={() => void generate()}
          disabled={busy || !prompt.trim()}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {busy ? 'Planning…' : 'Plan my design'}
        </button>
      </div>

      {!plan && !busy && (
        <div className="mt-3 space-y-1.5">
          {IDEAS.map((idea) => (
            <button
              key={idea}
              onClick={() => setPrompt(idea)}
              className="block w-full text-left text-[11px] text-white/45 hover:text-white/80 px-2.5 py-2 rounded-lg hover:bg-white/[0.04] transition-colors"
            >
              “{idea}”
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2 text-[11.5px] text-red-200">
          {error}
        </p>
      )}

      {plan && (
        <div className="mt-4 border-t border-white/10 pt-3">
          <div className="flex items-start gap-2 mb-3">
            <div className="min-w-0">
              <p className="text-[12.5px] font-bold text-white truncate">{plan.name}</p>
              {plan.summary && <p className="text-[11px] text-white/50 leading-snug mt-0.5">{plan.summary}</p>}
            </div>
            <div className="ml-auto flex gap-2 shrink-0">
              <button
                className="text-[11px] text-white/55 hover:text-white px-2.5 h-8 rounded-lg hover:bg-white/10"
                onClick={() => setPlan(null)}
              >
                Redraft
              </button>
              <button className="btn-cv h-8 px-3.5 text-[11.5px] flex items-center gap-1.5" onClick={apply}>
                <Check size={12} /> Apply {enabledPages > 0 ? `(${enabledPages}p · ${enabledElements}el)` : ''}
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {plan.pages.map((pg) => (
              <PageCard
                key={pg.id}
                page={pg}
                planWidth={plan.width}
                planHeight={plan.height}
                onTogglePage={togglePage}
                onToggleElement={toggleElement}
                onEditText={editText}
              />
            ))}
          </div>

          <p className="mt-3 text-[10.5px] text-white/35 leading-snug">
            Uncheck anything you don&apos;t want; edit any copy inline. Apply adds the checked pages to this design
            as native editable elements — one Ctrl+Z removes them all.
          </p>
        </div>
      )}
    </div>
  )
}

/** One reviewable page: mini preview + element checklist with inline copy editing. */
function PageCard({
  page,
  planWidth,
  planHeight,
  onTogglePage,
  onToggleElement,
  onEditText,
}: {
  page: PlanPageSpec
  planWidth: number
  planHeight: number
  onTogglePage: (id: string) => void
  onToggleElement: (pageId: string, elId: string) => void
  onEditText: (pageId: string, elId: string, text: string) => void
}) {
  return (
    <div
      className={cn(
        'rounded-xl border p-2.5 transition-colors',
        page.enabled ? 'border-white/12 bg-white/[0.04]' : 'border-white/8 bg-white/[0.015] opacity-60',
      )}
    >
      <div className="flex items-center gap-2">
        <button
          onClick={() => onTogglePage(page.id)}
          className={cn(
            'w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors',
            page.enabled ? 'bg-[#02C0CC] border-[#02C0CC] text-black' : 'border-white/25 text-transparent',
          )}
          aria-label={page.enabled ? `Disable page ${page.title}` : `Enable page ${page.title}`}
          aria-pressed={page.enabled}
        >
          <Check size={12} strokeWidth={3.5} />
        </button>
        <span className="text-[12px] font-semibold text-white/90 truncate">{page.title}</span>
        <span className="ml-auto text-[10px] text-white/40">{page.elements.filter((e) => e.enabled).length}/{page.elements.length}</span>
      </div>

      <div className="flex gap-2.5 mt-2">
        {/* scaled geometry preview — the honest wireframe of the plan */}
        <div
          className="relative shrink-0 rounded-lg overflow-hidden border border-white/10"
          style={{
            width: 96,
            height: Math.max(48, Math.round((96 * planHeight) / Math.max(1, planWidth))),
            background:
              page.background.type === 'gradient'
                ? `linear-gradient(${page.background.angle}deg, ${page.background.from}, ${page.background.to})`
                : page.background.color,
          }}
          aria-hidden
        >
          {page.elements.map((el) => (
            <div
              key={el.id}
              className="absolute rounded-[2px]"
              style={{
                left: `${(el.x / planWidth) * 100}%`,
                top: `${(el.y / planHeight) * 100}%`,
                width: `${(el.width / planWidth) * 100}%`,
                height: `${((el.height ?? Math.round(planHeight * 0.06)) / planHeight) * 100}%`,
                background: el.type === 'text' ? 'rgba(255,255,255,0.75)' : (el.fill ?? '#02C0CC'),
                opacity: el.enabled ? 0.9 : 0.25,
                minHeight: 3,
              }}
            />
          ))}
        </div>

        <div className="flex-1 min-w-0 space-y-1 max-h-44 overflow-y-auto pr-0.5">
          {page.elements.map((el) => (
            <div key={el.id} className="flex items-center gap-1.5">
              <button
                onClick={() => onToggleElement(page.id, el.id)}
                className={cn(
                  'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors',
                  el.enabled ? 'bg-[#02C0CC] border-[#02C0CC] text-black' : 'border-white/25 text-transparent',
                )}
                aria-label={
                  el.enabled
                    ? `Disable ${el.type}: ${(el.text ?? '').slice(0, 30) || el.type}`
                    : `Enable ${el.type}: ${(el.text ?? '').slice(0, 30) || el.type}`
                }
                aria-pressed={el.enabled}
              >
                <Check size={9} strokeWidth={4} />
              </button>
              {el.type === 'text' ? (
                <input
                  value={el.text ?? ''}
                  onChange={(e) => onEditText(page.id, el.id, e.target.value)}
                  className="flex-1 min-w-0 h-7 rounded-md bg-white/[0.05] border border-white/10 text-[11px] text-white px-2 focus:outline-none focus:border-[#02C0CC]"
                  aria-label="Element text"
                  maxLength={400}
                />
              ) : (
                <span className="flex items-center gap-1.5 text-[11px] text-white/55 truncate">
                  {el.enabled ? <Eye size={11} className="shrink-0" /> : <EyeOff size={11} className="shrink-0" />}
                  {el.type} — {el.width}×{el.height ?? 'auto'}
                  <span className="w-2.5 h-2.5 rounded-sm border border-white/20 shrink-0" style={{ background: el.fill ?? '#02C0CC' }} />
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
