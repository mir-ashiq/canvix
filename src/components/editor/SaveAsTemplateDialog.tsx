'use client'

import { useState } from 'react'
import { BookMarked, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useEditorStore } from '@/store/editor-store'
import { toast } from '@/hooks/use-toast'
import { TEMPLATE_CATEGORIES } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * v0.17 (Wave 2): "Save as template" — persist the open document as a
 * reusable template (server-side, attributed like designs: account or
 * anon cookie). Appears in the editor File menu.
 *
 * The form is a separate inner component: Radix unmounts DialogContent
 * on close, so every open mounts fresh and prefills from the store at
 * initialisation (no effect-setState cascade).
 */
export function SaveAsTemplateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <SaveAsTemplateForm onOpenChange={onOpenChange} /> : null}
    </Dialog>
  )
}

function SaveAsTemplateForm({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const state0 = useEditorStore.getState()
  const [name, setName] = useState(state0.designName || 'My template')
  const [category, setCategory] = useState('social')
  const [saving, setSaving] = useState(false)
  const sizeLabel = `${state0.width} × ${state0.height} px · ${state0.pages.length} page${state0.pages.length > 1 ? 's' : ''}`
  // derive an accent from the first strong fill on the current page
  const strongFill = state0.pages[state0.currentPage]?.elements.find(
    (e) => typeof (e as { fill?: string }).fill === 'string' && !['#FFFFFF', '#ffffff', '#00000000', 'transparent'].includes((e as { fill: string }).fill)
  ) as { fill?: string } | undefined
  const [accent, setAccent] = useState(/^#[0-9a-fA-F]{6}$/.test(strongFill?.fill ?? '') ? (strongFill?.fill as string) : '#7630D7')

  const save = async () => {
    const state = useEditorStore.getState()
    if (!state.pages.some((p) => p.elements.length)) {
      toast({ title: 'Nothing to save — the design is empty', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/templates/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || 'My template',
          category,
          accent,
          width: state.width,
          height: state.height,
          pages: state.pages,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? 'Save failed')
      }
      toast({ title: `Saved “${name.trim() || 'My template'}” as a template`, description: 'Find it under Templates → Your templates.' })
      onOpenChange(false)
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Save failed', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
      <DialogContent className="rounded-[28px] sm:max-w-sm bg-[#16181D] border-white/10 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookMarked size={16} className="text-[#02C0CC]" /> Save as template
          </DialogTitle>
          <DialogDescription className="text-white/55">
            Your design becomes a private starter template — reuse it anytime from the Templates panel.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium" htmlFor="tpl-name">Template name</label>
            <Input
              id="tpl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              className="mt-1 bg-white/[0.06] border-white/10 text-white [color-scheme:dark]"
              placeholder="My template"
            />
          </div>
          <div>
            <span className="text-sm font-medium">Category</span>
            <div className="flex gap-1.5 flex-wrap mt-1.5">
              {TEMPLATE_CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCategory(c.id)}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-medium border transition-colors',
                    category === c.id ? 'bg-[#7630D7] text-white border-transparent' : 'border-white/12 text-white/60 hover:text-white'
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Card colour</span>
            <input
              type="color"
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              className="h-8 w-12 rounded-lg border border-white/15 cursor-pointer bg-transparent"
              aria-label="Template card colour"
            />
            <span className="text-xs text-white/40">{sizeLabel}</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="border-white/15 bg-transparent text-white hover:bg-white/10 hover:text-white" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="btn-cv" onClick={() => void save()} disabled={saving || !name.trim()}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <BookMarked size={14} />} Save template
          </Button>
        </DialogFooter>
    </DialogContent>
  )
}
