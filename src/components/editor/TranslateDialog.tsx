'use client'

import { useMemo, useState } from 'react'
import { Languages, Loader2, Globe, ArrowRight } from 'lucide-react'
import { useEditorStore } from '@/store/editor-store'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import type { AnyElement, TextElement } from '@/lib/types'

const LANGUAGES: { name: string; native: string; code: string }[] = [
  { name: 'Spanish', native: 'Español', code: 'es' },
  { name: 'French', native: 'Français', code: 'fr' },
  { name: 'German', native: 'Deutsch', code: 'de' },
  { name: 'Portuguese', native: 'Português', code: 'pt' },
  { name: 'Italian', native: 'Italiano', code: 'it' },
  { name: 'Dutch', native: 'Nederlands', code: 'nl' },
  { name: 'Polish', native: 'Polski', code: 'pl' },
  { name: 'Swedish', native: 'Svenska', code: 'sv' },
  { name: 'Turkish', native: 'Türkçe', code: 'tr' },
  { name: 'Russian', native: 'Русский', code: 'ru' },
  { name: 'Ukrainian', native: 'Українська', code: 'uk' },
  { name: 'Arabic', native: 'العربية', code: 'ar' },
  { name: 'Hebrew', native: 'עברית', code: 'he' },
  { name: 'Hindi', native: 'हिन्दी', code: 'hi' },
  { name: 'Bengali', native: 'বাংলা', code: 'bn' },
  { name: 'Tamil', native: 'தமிழ்', code: 'ta' },
  { name: 'Thai', native: 'ไทย', code: 'th' },
  { name: 'Vietnamese', native: 'Tiếng Việt', code: 'vi' },
  { name: 'Indonesian', native: 'Bahasa Indonesia', code: 'id' },
  { name: 'Chinese (Simplified)', native: '简体中文', code: 'zh' },
  { name: 'Chinese (Traditional)', native: '繁體中文', code: 'zh-TW' },
  { name: 'Japanese', native: '日本語', code: 'ja' },
  { name: 'Korean', native: '한국어', code: 'ko' },
  { name: 'Greek', native: 'Ελληνικά', code: 'el' },
]

/** Collect every text element in the design (top-level + inside groups). */
function collectTexts(els: AnyElement[], out: TextElement[] = []): TextElement[] {
  for (const el of els) {
    if (el.type === 'text') out.push(el)
    else if (el.type === 'group') collectTexts(el.children, out)
  }
  return out
}

/** Canva "Translate" — AI-translate every text element in the design. */
export function TranslateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const pages = useEditorStore((s) => s.pages)
  const translateTexts = useEditorStore((s) => s.translateTexts)
  const [lang, setLang] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const texts = useMemo(() => collectTexts(pages.flatMap((p) => p.elements)), [pages])
  const picked = LANGUAGES.find((l) => l.code === lang) ?? null

  const run = async () => {
    if (!picked || !texts.length || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/ai/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: `${picked.name} (${picked.native})`,
          texts: texts.map((t) => t.text),
        }),
      })
      const data = (await res.json()) as { translations?: string[]; error?: string }
      if (!res.ok || !Array.isArray(data.translations) || data.translations.length !== texts.length) {
        toast({ title: 'Translate failed', description: data.error ?? 'Please try again.', variant: 'destructive' })
        return
      }
      translateTexts(texts.map((t, i) => ({ id: t.id, text: data.translations![i] })))
      toast({ title: `Translated to ${picked.native}`, description: `${texts.length} text${texts.length === 1 ? '' : 's'} updated. Ctrl+Z to undo.` })
      onOpenChange(false)
    } catch {
      toast({ title: 'Translate is unavailable right now.', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[28px] bg-[#16181D] border-white/10 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold flex items-center gap-2">
            <Languages size={17} className="text-[#02C0CC]" /> Translate design
          </DialogTitle>
          <DialogDescription className="text-white/60">
            {texts.length
              ? `Translate all ${texts.length} text${texts.length === 1 ? '' : 's'} across ${pages.length} page${pages.length === 1 ? '' : 's'} with AI. Your layout stays intact.`
              : 'This design has no text to translate yet.'}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[46vh] overflow-y-auto cv-scroll pr-1">
          <div className="grid grid-cols-2 gap-1.5">
            {LANGUAGES.map((l) => {
              const active = lang === l.code
              return (
                <button
                  key={l.code}
                  onClick={() => setLang(active ? null : l.code)}
                  aria-pressed={active}
                  className={cn(
                    'flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 border text-left transition-colors',
                    active
                      ? 'bg-[#7630D7] border-transparent'
                      : 'bg-white/5 border-white/10 hover:bg-white/10'
                  )}
                >
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold truncate">{l.native}</span>
                    <span className={cn('block text-[10.5px] truncate', active ? 'text-white/80' : 'text-white/45')}>{l.name}</span>
                  </span>
                  {active && <ArrowRight size={13} className="shrink-0 text-white/90" />}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <span className="text-[11px] text-white/45 flex items-center gap-1.5 min-w-0">
            <Globe size={12} className="shrink-0" />
            {picked ? `Target: ${picked.native}` : 'Pick a language'}
          </span>
          <Button
            className="btn-cv h-11 rounded-xl ml-auto px-5"
            disabled={!picked || !texts.length || busy}
            onClick={() => void run()}
          >
            {busy ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : <Languages size={15} className="mr-1.5" />}
            {busy ? 'Translating…' : 'Translate'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
