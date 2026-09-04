'use client'

import { useState } from 'react'
import { Sparkles, X, Zap, Play, RotateCcw, ArrowLeft, ArrowRight, ArrowUp, ArrowDown } from 'lucide-react'
import { useEditorStore } from '@/store/editor-store'
import { ANIMATION_KINDS, TRANSITION_KINDS } from '@/lib/animations'
import type { AnimationDirection, AnimationEasing, AnimationKind, AnimationSpeed, ElementAnimation, PageTransition } from '@/lib/types'
import { SPEED_PRESETS } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

const EASINGS: { id: AnimationEasing; label: string }[] = [
  { id: 'linear', label: 'Linear' },
  { id: 'easeIn', label: 'Ease in' },
  { id: 'easeOut', label: 'Ease out' },
  { id: 'easeInOut', label: 'Ease in-out' },
  { id: 'spring', label: 'Spring' },
]

const DIRECTIONS: { id: AnimationDirection; label: string; icon: typeof ArrowLeft }[] = [
  { id: 'left', label: 'From left', icon: ArrowLeft },
  { id: 'right', label: 'From right', icon: ArrowRight },
  { id: 'up', label: 'From bottom', icon: ArrowUp },
  { id: 'down', label: 'From top', icon: ArrowDown },
]

/**
 * Animate panel (canva-style side panel) — tabs: Page / Element.
 * Element tab animates the current selection; Page tab sets the page
 * transition + Magic Animate for the whole page.
 */
export function AnimatePanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'page' | 'element'>('page')
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const setElementAnimation = useEditorStore((s) => s.setElementAnimation)
  const setPageTransition = useEditorStore((s) => s.setPageTransition)
  const magicAnimateCurrentPage = useEditorStore((s) => s.magicAnimateCurrentPage)
  const clearPageAnimations = useEditorStore((s) => s.clearPageAnimations)
  const setPreviewOpen = useEditorStore((s) => s.setPreviewOpen)
  const pages = useEditorStore((s) => s.pages)
  const currentPage = useEditorStore((s) => s.currentPage)
  const [speed, setSpeed] = useState<AnimationSpeed>('medium')
  const [showSpeed, setShowSpeed] = useState(false)

  const page = pages[currentPage]
  const selection = selectedIds.length > 0
  const selectedAnim = selection
    ? page.elements.find((e) => e.id === selectedIds[0])?.animation
    : undefined
  const pageTransition = page?.transition

  const applyKind = (kind: AnimationKind) => {
    if (!selection) return
    if (kind === 'none') {
      setElementAnimation(selectedIds, null)
      return
    }
    const base: ElementAnimation = {
      kind,
      duration: SPEED_PRESETS[speed],
      delay: 0,
      easing: kind === 'pop' ? 'spring' : 'easeOut',
      direction: kind === 'rise' ? 'up' : kind === 'pan' || kind === 'wipe' ? 'left' : undefined,
    }
    setElementAnimation(selectedIds, base)
  }

  const patchAnim = (patch: Partial<ElementAnimation>) => {
    if (!selection || !selectedAnim) return
    setElementAnimation(selectedIds, { ...selectedAnim, ...patch })
  }

  const applyTransition = (kind: PageTransition['kind']) => {
    if (kind === 'none') {
      setPageTransition(null)
      return
    }
    setPageTransition({
      kind,
      duration: pageTransition?.kind === kind ? pageTransition.duration : 0.7,
      direction: pageTransition?.direction ?? 'left',
    })
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 pt-4 pb-3 shrink-0">
        <h2 className="font-bold text-sm text-white flex items-center gap-2">
          <Zap size={15} className="text-[#02C0CC]" /> Animate
        </h2>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full text-white/70 hover:bg-white/10 hover:text-white h-7 w-7"
          onClick={onClose}
          aria-label="Close animate panel"
        >
          <X size={14} />
        </Button>
      </div>

      {/* tabs — canva: Page / Element / Text (we fold text into element) */}
      <div className="px-4 pb-3 shrink-0">
        <div className="flex gap-1 rounded-lg bg-white/[0.05] p-0.5">
          {(['page', 'element'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'flex-1 rounded-md px-2 py-1.5 text-[11px] font-semibold capitalize transition-colors cursor-pointer',
                tab === t ? 'bg-white/[0.12] text-white' : 'text-white/50 hover:text-white/80'
              )}
            >
              {t === 'page' ? 'Page' : 'Element'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
        {/* ── Page tab ─────────────────────────────── */}
        {tab === 'page' && (
          <div className="space-y-4">
            {/* Magic Animate */}
            <button
              className="w-full rounded-xl bg-gradient-to-r from-[#00C4CC] to-[#7630D7] p-[1px] cursor-pointer group"
              onClick={() => {
                magicAnimateCurrentPage(speed)
                toast({ title: 'Magic Animate applied', description: 'Every element got a fitting animation. Preview to see it play.' })
              }}
            >
              <div className="rounded-[11px] bg-[#16181D] px-3 py-3 flex items-center gap-2.5 group-hover:bg-transparent transition-colors">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#00C4CC] to-[#7630D7] flex items-center justify-center shrink-0">
                  <Sparkles size={16} className="text-white" />
                </div>
                <div className="text-left">
                  <div className="text-[13px] font-bold text-white">Magic Animate</div>
                  <div className="text-[11px] text-white/55">One click — animate everything on this page</div>
                </div>
              </div>
            </button>

            {/* speed */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-semibold text-white/60">Animation speed</span>
                <button
                  className="text-[10px] text-[#02C0CC] font-semibold cursor-pointer"
                  onClick={() => setShowSpeed((v) => !v)}
                >
                  {showSpeed ? 'hide presets' : 'show presets'}
                </button>
              </div>
              {showSpeed && (
                <div className="grid grid-cols-3 gap-1.5 mb-2">
                  {(Object.keys(SPEED_PRESETS) as AnimationSpeed[]).map((s) => (
                    <button
                      key={s}
                      onClick={() => setSpeed(s)}
                      className={cn(
                        'rounded-lg border px-2 py-1.5 text-[11px] font-semibold capitalize cursor-pointer transition-colors',
                        speed === s ? 'border-[#02C0CC] bg-[#02C0CC]/10 text-white' : 'border-white/10 text-white/60 hover:border-white/25'
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* page transition */}
            <div>
              <span className="text-[11px] font-semibold text-white/60 block mb-1.5">Page transition</span>
              <p className="text-[10px] text-white/35 mb-2">Plays when this page appears after another.</p>
              <div className="grid grid-cols-2 gap-1.5">
                {TRANSITION_KINDS.map((t) => (
                  <button
                    key={t.kind}
                    onClick={() => applyTransition(t.kind)}
                    className={cn(
                      'rounded-lg border px-2.5 py-2 text-left cursor-pointer transition-colors',
                      pageTransition?.kind === t.kind
                        ? 'border-[#02C0CC] bg-[#02C0CC]/10'
                        : 'border-white/10 hover:border-white/25'
                    )}
                  >
                    <div className="text-[12px] font-semibold text-white/90">{t.label}</div>
                    <div className="text-[10px] text-white/40">{t.hint}</div>
                  </button>
                ))}
              </div>

              {pageTransition && pageTransition.kind !== 'none' && (
                <div className="mt-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-semibold text-white/50">Duration</span>
                    <span className="text-[10px] text-white/60">{pageTransition.duration.toFixed(1)}s</span>
                  </div>
                  <input
                    type="range"
                    min={0.1}
                    max={2.5}
                    step={0.1}
                    value={pageTransition.duration}
                    onChange={(e) =>
                      setPageTransition({ ...pageTransition, duration: Number(e.target.value) })
                    }
                    className="w-full accent-[#02C0CC]"
                    aria-label="Transition duration"
                  />
                  {(pageTransition.kind === 'slide') && (
                    <div className="flex gap-1 mt-2">
                      {DIRECTIONS.map((d) => (
                        <button
                          key={d.id}
                          title={d.label}
                          onClick={() => setPageTransition({ ...pageTransition, direction: d.id })}
                          className={cn(
                            'flex-1 rounded-md border py-1.5 flex items-center justify-center cursor-pointer',
                            (pageTransition.direction ?? 'left') === d.id
                              ? 'border-[#02C0CC] bg-[#02C0CC]/10 text-white'
                              : 'border-white/10 text-white/50 hover:border-white/25'
                          )}
                        >
                          <d.icon size={12} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* actions */}
            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1 btn-brand-gradient gap-1.5"
                onClick={() => setPreviewOpen(true)}
              >
                <Play size={12} /> Preview animations
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-white/70 hover:bg-white/10 hover:text-white gap-1.5"
                onClick={() => clearPageAnimations()}
                title="Remove all animations from this page"
              >
                <RotateCcw size={12} /> Clear
              </Button>
            </div>
          </div>
        )}

        {/* ── Element tab ──────────────────────────── */}
        {tab === 'element' && (
          <div className="space-y-4">
            {!selection ? (
              <div className="text-center py-10 px-2">
                <Zap size={26} className="mx-auto text-white/20 mb-2" />
                <div className="text-[13px] font-semibold text-white/60">Select an element</div>
                <p className="text-[11px] text-white/40 mt-1">
                  Pick one or more elements on the canvas, then choose an animation.
                </p>
              </div>
            ) : (
              <>
                <p className="text-[11px] text-white/50">
                  Animating {selectedIds.length} element{selectedIds.length > 1 ? 's' : ''}
                </p>

                <div className="grid grid-cols-3 gap-1.5">
                  {ANIMATION_KINDS.map((k) => (
                    <button
                      key={k.kind}
                      onClick={() => applyKind(k.kind)}
                      title={k.hint}
                      className={cn(
                        'rounded-lg border px-2 py-2 text-center cursor-pointer transition-colors',
                        (selectedAnim?.kind ?? 'none') === k.kind
                          ? 'border-[#02C0CC] bg-[#02C0CC]/10'
                          : 'border-white/10 hover:border-white/25'
                      )}
                    >
                      <AnimationGlyph kind={k.kind} />
                      <div className="text-[11px] font-semibold text-white/85 mt-1">{k.label}</div>
                    </button>
                  ))}
                </div>

                {/* timing controls */}
                {selectedAnim && selectedAnim.kind !== 'none' && (
                  <div className="space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-semibold text-white/50">Duration</span>
                        <span className="text-[10px] text-white/60">{selectedAnim.duration.toFixed(1)}s</span>
                      </div>
                      <input
                        type="range"
                        min={0.1}
                        max={4}
                        step={0.1}
                        value={selectedAnim.duration}
                        onChange={(e) => patchAnim({ duration: Number(e.target.value) })}
                        className="w-full accent-[#02C0CC]"
                        aria-label="Animation duration"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-semibold text-white/50">Delay</span>
                        <span className="text-[10px] text-white/60">{selectedAnim.delay.toFixed(1)}s</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={5}
                        step={0.1}
                        value={selectedAnim.delay}
                        onChange={(e) => patchAnim({ delay: Number(e.target.value) })}
                        className="w-full accent-[#02C0CC]"
                        aria-label="Animation delay"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] font-semibold text-white/50 block mb-1.5">Easing</span>
                      <div className="grid grid-cols-3 gap-1">
                        {EASINGS.map((e) => (
                          <button
                            key={e.id}
                            onClick={() => patchAnim({ easing: e.id })}
                            className={cn(
                              'rounded-md border py-1 text-[10px] font-semibold cursor-pointer',
                              (selectedAnim.easing ?? 'easeOut') === e.id
                                ? 'border-[#02C0CC] bg-[#02C0CC]/10 text-white'
                                : 'border-white/10 text-white/50 hover:border-white/25'
                            )}
                          >
                            {e.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {['pan', 'rise', 'wipe', 'rotate'].includes(selectedAnim.kind) && (
                      <div>
                        <span className="text-[10px] font-semibold text-white/50 block mb-1.5">Direction</span>
                        <div className="flex gap-1">
                          {DIRECTIONS.map((d) => (
                            <button
                              key={d.id}
                              title={d.label}
                              onClick={() => patchAnim({ direction: d.id })}
                              className={cn(
                                'flex-1 rounded-md border py-1.5 flex items-center justify-center cursor-pointer',
                                (selectedAnim.direction ?? 'up') === d.id
                                  ? 'border-[#02C0CC] bg-[#02C0CC]/10 text-white'
                                  : 'border-white/10 text-white/50 hover:border-white/25'
                              )}
                            >
                              <d.icon size={12} />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function AnimationGlyph({ kind }: { kind: AnimationKind }) {
  const cls = 'mx-auto w-7 h-7 rounded-md bg-white/[0.06] flex items-center justify-center text-[#02C0CC]'
  switch (kind) {
    case 'none':
      return <div className={cls}><RotateCcw size={12} /></div>
    case 'fade':
      return <div className={cls}><span className="text-[10px] font-bold">Fa</span></div>
    case 'rise':
      return <div className={cls}><ArrowUp size={12} /></div>
    case 'pan':
      return <div className={cls}><ArrowRight size={12} /></div>
    case 'pop':
      return <div className={cls}><span className="text-[10px] font-bold">Po</span></div>
    case 'wipe':
      return <div className={cls}><span className="text-[10px] font-bold">Wi</span></div>
    case 'zoom':
      return <div className={cls}><span className="text-[10px] font-bold">Zo</span></div>
    case 'rotate':
      return <div className={cls}><RotateCcw size={12} className="rotate-[135deg]" /></div>
    case 'breathe':
      return <div className={cls}><span className="text-[10px] font-bold">Br</span></div>
    default:
      return <div className={cls}>?</div>
  }
}
