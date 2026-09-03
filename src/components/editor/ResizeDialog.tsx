'use client'

import { useState } from 'react'
import { Presentation, Instagram, Youtube, FileText, Square, RectangleHorizontal, RectangleVertical, Smartphone } from 'lucide-react'
import { useEditorStore } from '@/store/editor-store'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

const SIZE_GROUPS: { label: string; sizes: { name: string; w: number; h: number; icon: typeof Square }[] }[] = [
  {
    label: 'Story & Reels',
    sizes: [
      { name: 'Instagram Story', w: 1080, h: 1920, icon: Smartphone },
      { name: 'YouTube Short', w: 1080, h: 1920, icon: Youtube },
    ],
  },
  {
    label: 'Posts',
    sizes: [
      { name: 'Instagram Post', w: 1080, h: 1080, icon: Square },
      { name: 'Landscape Post', w: 1920, h: 1080, icon: RectangleHorizontal },
      { name: 'Portrait Post', w: 1080, h: 1350, icon: RectangleVertical },
    ],
  },
  {
    label: 'Docs & Decks',
    sizes: [
      { name: 'Presentation 16:9', w: 1920, h: 1080, icon: Presentation },
      { name: 'Document A4', w: 1240, h: 1754, icon: FileText },
    ],
  },
]

/** Canva-style Resize dialog — change canvas size; elements stay centered. */
export function ResizeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const width = useEditorStore((s) => s.width)
  const height = useEditorStore((s) => s.height)
  const resizeDesign = useEditorStore((s) => s.resizeDesign)
  const [custom, setCustom] = useState({ w: '', h: '' })

  const apply = (w: number, h: number) => {
    resizeDesign(w, h)
    toast({ title: `Design resized to ${w}×${h}` })
    onOpenChange(false)
  }

  const applyCustom = () => {
    const w = parseInt(custom.w, 10)
    const h = parseInt(custom.h, 10)
    if (!w || !h || w < 50 || h < 50 || w > 8000 || h > 8000) {
      toast({ title: 'Enter a size between 50 and 8000 px', variant: 'destructive' })
      return
    }
    apply(w, h)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[28px] bg-[#16181D] border-white/10 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Resize design</DialogTitle>
          <DialogDescription className="text-white/60">
            Current size: {width} × {height} px. Your elements stay centered on the new canvas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[55vh] overflow-y-auto cv-scroll pr-1">
          {SIZE_GROUPS.map((g) => (
            <div key={g.label}>
              <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wide mb-2">{g.label}</h3>
              <div className="grid grid-cols-2 gap-2">
                {g.sizes.map((s) => (
                  <button
                    key={s.name}
                    onClick={() => apply(s.w, s.h)}
                    className="flex items-center gap-2.5 rounded-xl bg-white/5 hover:bg-[#7630D7] border border-white/10 hover:border-transparent px-3 py-2.5 text-left transition-colors group"
                  >
                    <s.icon size={18} className="text-white/70 group-hover:text-white shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold truncate">{s.name}</span>
                      <span className="block text-[11px] text-white/50 group-hover:text-white/80">
                        {s.w} × {s.h}
                      </span>
                    </span>
                  </button>
                ))}
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
                Apply
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

void Instagram
