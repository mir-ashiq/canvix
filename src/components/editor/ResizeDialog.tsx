'use client'

import { useState } from 'react'
import { Wand2, Copy, Loader2, Square } from 'lucide-react'
import { useEditorStore } from '@/store/editor-store'
import { createDesign } from '@/components/dashboard/hooks'
import { magicRelayoutPages, RESIZE_PRESETS, type ResizePreset } from '@/lib/magic'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { useAppStore } from '@/store/app-store'

const GROUP_LABELS: Record<ResizePreset['group'], string> = {
  story: 'Story & vertical video',
  post: 'Social posts',
  doc: 'Docs & decks',
  print: 'Print',
}

/** Canva Magic Resize dialog — re-layout the current design for any channel,
 *  in place or as copies (Magic Switch "Copy & resize"). */
export function ResizeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const width = useEditorStore((s) => s.width)
  const height = useEditorStore((s) => s.height)
  const pages = useEditorStore((s) => s.pages)
  const designName = useEditorStore((s) => s.designName)
  const designId = useEditorStore((s) => s.designId)
  const resizeDesign = useEditorStore((s) => s.resizeDesign)
  const [custom, setCustom] = useState({ w: '', h: '' })
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const goDashboard = useAppStore((s) => s.goDashboard)

  const groups = (['story', 'post', 'doc', 'print'] as const).map((g) => ({
    label: GROUP_LABELS[g],
    sizes: RESIZE_PRESETS.filter((p) => p.group === g),
  }))
  const selected = RESIZE_PRESETS.filter((p) => checked[p.name])

  const toggle = (name: string) => setChecked((c) => ({ ...c, [name]: !c[name] }))

  const applyInPlace = (w: number, h: number) => {
    resizeDesign(w, h)
    toast({ title: `Magic-resized to ${w}×${h}`, description: 'Elements re-laid-out to fit the new canvas.' })
    onOpenChange(false)
  }

  const applyCustom = () => {
    const w = parseInt(custom.w, 10)
    const h = parseInt(custom.h, 10)
    if (!w || !h || w < 50 || h < 50 || w > 8000 || h > 8000) {
      toast({ title: 'Enter a size between 50 and 8000 px', variant: 'destructive' })
      return
    }
    applyInPlace(w, h)
  }

  /** Magic Switch: create a resized COPY for every checked channel. */
  const copyAndResize = async () => {
    if (!selected.length || !designId) return
    setBusy(true)
    let made = 0
    try {
      for (const preset of selected) {
        const relaid = magicRelayoutPages(pages, width, height, preset.w, preset.h)
        try {
          await createDesign({
            name: `${designName} (${preset.short})`,
            width: preset.w,
            height: preset.h,
            pages: relaid,
            source: `resize:${designId}`,
          })
          made += 1
        } catch {
          // keep going — partial success is better than aborting
        }
      }
      toast({
        title: made ? `Created ${made} resized cop${made === 1 ? 'y' : 'ies'}` : 'Could not create copies',
        description: made ? 'Find them in your recent designs.' : 'Please try again.',
      })
      if (made) goDashboard()
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[28px] bg-[#16181D] border-white/10 text-white sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold flex items-center gap-2">
            <Wand2 size={17} className="text-[#02C0CC]" /> Magic Resize
          </DialogTitle>
          <DialogDescription className="text-white/60">
            Resize this design for every channel. Pick sizes, then copy & resize — your elements are
            re-laid-out automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[52vh] overflow-y-auto cv-scroll pr-1">
          {groups.map((g) => (
            <div key={g.label}>
              <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wide mb-2">{g.label}</h3>
              <div className="grid grid-cols-2 gap-2">
                {g.sizes.map((s) => {
                  const active = checked[s.name]
                  const isCurrent = s.w === width && s.h === height
                  return (
                    <button
                      key={s.name}
                      onClick={() => toggle(s.name)}
                      aria-pressed={active}
                      className={cn(
                        'flex items-center gap-2.5 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-left transition-colors group',
                        active ? 'bg-[#7630D7] border-transparent' : 'hover:bg-white/10'
                      )}
                    >
                      <span
                        className={cn(
                          'w-4 h-4 rounded-[5px] border flex items-center justify-center shrink-0',
                          active ? 'border-white bg-white/90' : 'border-white/30'
                        )}
                      >
                        {active && (
                          <svg viewBox="0 0 12 12" className="w-3 h-3">
                            <path d="M2 6l2.5 2.5L10 3" fill="none" stroke="#7630D7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold truncate">{s.name}</span>
                        <span className={cn('block text-[11px]', active ? 'text-white/85' : 'text-white/50')}>
                          {s.w} × {s.h}{isCurrent ? ' · current' : ''}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          <div>
            <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wide mb-2">Custom size</h3>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                placeholder="Width"
                value={custom.w}
                onChange={(e) => setCustom((c) => ({ ...c, w: e.target.value }))}
                className="bg-white/5 border-white/10 text-white h-10 [color-scheme:dark]"
                aria-label="Custom width"
              />
              <span className="text-white/40">×</span>
              <Input
                type="number"
                placeholder="Height"
                value={custom.h}
                onChange={(e) => setCustom((c) => ({ ...c, h: e.target.value }))}
                className="bg-white/5 border-white/10 text-white h-10 [color-scheme:dark]"
                aria-label="Custom height"
              />
              <Button className="btn-cv h-10 px-4 shrink-0" onClick={applyCustom}>
                Resize
              </Button>
            </div>
          </div>
        </div>

        {/* footer actions */}
        <div className="flex items-center gap-2 pt-1">
          <Button
            variant="outline"
            className="h-11 flex-1 rounded-xl border-white/15 bg-white/5 hover:bg-white/10 hover:text-white"
            disabled={selected.length !== 1}
            onClick={() => applyInPlace(selected[0].w, selected[0].h)}
            title={selected.length === 1 ? `Resize this design to ${selected[0].w}×${selected[0].h}` : 'Check exactly one size to resize in place'}
          >
            <Square size={15} className="mr-1.5" /> Resize in place
          </Button>
          <Button
            className="btn-cv h-11 flex-1 rounded-xl"
            disabled={!selected.length || busy}
            onClick={() => void copyAndResize()}
          >
            {busy ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : <Copy size={15} className="mr-1.5" />}
            Copy & resize {selected.length > 1 ? `(${selected.length})` : ''}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
