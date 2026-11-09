'use client'

import { useState } from 'react'
import { Loader2, NotebookPen, Sparkles } from 'lucide-react'
import { useEditorStore } from '@/store/editor-store'
import { extractOutlines } from '@/lib/notes-outline'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'

/**
 * v0.19 (Wave 4) — AI speaker-notes generation with a review gate.
 *
 * The page OUTLINE (titles + bullets, extracted by lib/notes-outline —
 * the model sees content, not geometry) goes to /api/ai/notes; the
 * reply renders as one EDITABLE textarea per page; Apply writes each
 * page's notes via setPageNotes. Nothing lands unreviewed.
 */
export function NotesAIGenerator() {
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<{ page: number; text: string }[]>([])

  const generate = async () => {
    if (busy) return
    const s = useEditorStore.getState()
    const outline = extractOutlines(s.pages)
    if (!outline.length) {
      toast({ title: 'No pages to write notes about.' })
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/ai/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outline, tone: 'confident' }),
      })
      const data = (await res.json()) as { notes?: { page: number; text: string }[]; error?: string }
      if (!res.ok || !data.notes?.length) throw new Error(data.error ?? 'Generation failed')
      setDraft(data.notes)
      setOpen(true)
    } catch (e) {
      toast({
        title: 'Notes generation',
        description: e instanceof Error ? e.message : 'Failed. Try again.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  const apply = () => {
    const s = useEditorStore.getState()
    let written = 0
    for (const n of draft) {
      const page = s.pages[n.page - 1]
      if (page?.id) {
        s.setPageNotes(page.id, n.text)
        written++
      }
    }
    toast({ title: `Notes written for ${written} page${written === 1 ? '' : 's'}`, description: 'Edit them any time — they never appear on the canvas or in exports.' })
    setOpen(false)
  }

  const pages = useEditorStore((s) => s.pages)

  return (
    <>
      <button
        className="flex items-center gap-1 text-[11px] text-[#02C0CC] hover:text-[#4de0e8] px-1.5 h-7 rounded-md hover:bg-[#02C0CC]/10 font-semibold"
        onClick={() => void generate()}
        disabled={busy}
        title="Generate speaker notes for every page with AI"
        aria-label="Generate speaker notes with AI"
        data-testid="notes-ai-generate"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
        Generate with AI
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[560px] max-h-[80vh] overflow-y-auto rounded-2xl bg-[#14161B] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5 text-[15px]">
              <NotebookPen size={15} className="text-[#02C0CC]" /> Speaker notes — review & edit
            </DialogTitle>
          </DialogHeader>
          <p className="text-[12px] text-white/55 -mt-1 mb-2 leading-snug">
            AI drafts for {draft.length} page{draft.length === 1 ? '' : 's'}. Edit anything — Apply writes each
            page&apos;s notes (existing notes are replaced).
          </p>
          <div className="space-y-2.5">
            {draft.map((n, i) => (
              <div key={n.page}>
                <div className="text-[11px] font-semibold text-white/60 mb-1 flex items-baseline gap-2">
                  Page {n.page}
                  <span className="text-white/35 font-normal truncate">
                    {pages[n.page - 1]
                      ? (pages[n.page - 1].elements ?? [])
                          .filter((e) => e.type === 'text')
                          .sort((a, b) => b.fontSize - a.fontSize)[0]?.text?.slice(0, 46) ?? '—'
                      : '—'}
                  </span>
                </div>
                <textarea
                  value={n.text}
                  onChange={(e) =>
                    setDraft((d) => d.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
                  }
                  className="w-full h-20 resize-none rounded-lg bg-black/30 border border-white/10 px-2.5 py-2 text-[12.5px] text-white/85 focus:outline-none focus:border-[#02C0CC]"
                  aria-label={`Notes for page ${n.page}`}
                  maxLength={600}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 mt-1">
            <Button variant="ghost" className="h-9 text-[12px] text-white/70 hover:text-white" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button className="btn-cv h-9 px-4 text-[12px]" onClick={apply}>
              Apply to pages
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
