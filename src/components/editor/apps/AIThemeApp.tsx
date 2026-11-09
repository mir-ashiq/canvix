'use client'

import { useState } from 'react'
import { SwatchBook, Loader2, Check, Sparkles } from 'lucide-react'
import { useEditorStore } from '@/store/editor-store'
import { applyTheme, type Theme } from '@/lib/theme'
import { AppHeader, type AppPanelProps } from './registry'
import { toast } from '@/hooks/use-toast'

const MOODS = [
  'warm bakery, cozy, earthy',
  'nordic calm, cool editorial',
  'bold tech launch, electric',
  'soft pastel kids brand',
  'luxury dark, gold accents',
]

const ROLE_LABELS: Record<string, string> = {
  background: 'Background',
  surface: 'Surface',
  ink: 'Text',
  inkSoft: 'Text (soft)',
  accent: 'Accent',
  accentSoft: 'Accent 2',
}

/**
 * v0.19 (Wave 4) — AI theme generation. The model proposes a
 * role-tagged palette + font pairing (contrast-checked server-side);
 * this panel previews it and applies it design-wide with applyTheme()
 * — backgrounds, text ink, shape accents, all as one undoable step.
 */
export function AIThemeApp({ onClose }: AppPanelProps) {
  const [mood, setMood] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [theme, setTheme] = useState<Theme | null>(null)

  const generate = async () => {
    if (!mood.trim() || busy) return
    setBusy(true)
    setError(null)
    setTheme(null)
    try {
      const res = await fetch('/api/ai/theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: mood.trim() }),
      })
      const data = (await res.json()) as { theme?: Theme; error?: string }
      if (!res.ok || !data.theme) throw new Error(data.error ?? 'Generation failed')
      setTheme(data.theme)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setBusy(false)
    }
  }

  const apply = () => {
    if (!theme) return
    const s = useEditorStore.getState()
    // applyTheme is pure — build the next pages, then one history push
    const next = applyTheme(s.pages, theme)
    s.pushHistory()
    useEditorStore.setState({ pages: next, dirty: true })
    toast({
      title: 'Theme applied',
      description: `${theme.name} — recolored backgrounds, text and shapes. Ctrl+Z to revert.`,
    })
    onClose()
  }

  return (
    <div>
      <AppHeader icon={SwatchBook} title="AI theme" onClose={onClose} />
      <p className="text-[11.5px] text-white/50 leading-snug mb-3">
        Describe a mood — get a palette + font pairing, preview it, then recolor the whole design in one
        undoable step. Text contrast is guarded automatically.
      </p>

      <div className="flex gap-1.5">
        <input
          value={mood}
          onChange={(e) => setMood(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && void generate()}
          placeholder="e.g. moody jazz club, deep blues"
          className="flex-1 h-9 rounded-xl bg-white/[0.05] border border-white/10 text-white text-[12px] px-3 focus:outline-none focus:border-[#02C0CC]"
          aria-label="Theme mood"
          maxLength={400}
        />
        <button
          className="btn-cv h-9 px-3.5 text-[12px] flex items-center gap-1.5 shrink-0 disabled:opacity-60"
          onClick={() => void generate()}
          disabled={busy || !mood.trim()}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          Generate
        </button>
      </div>

      {!theme && !busy && (
        <div className="mt-3 space-y-1.5">
          {MOODS.map((m) => (
            <button
              key={m}
              onClick={() => setMood(m)}
              className="block w-full text-left text-[11px] text-white/45 hover:text-white/80 px-2.5 py-2 rounded-lg hover:bg-white/[0.04] transition-colors"
            >
              “{m}”
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2 text-[11.5px] text-red-200">
          {error}
        </p>
      )}

      {theme && (
        <div className="mt-4 border-t border-white/10 pt-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0">
              <p className="text-[12.5px] font-bold text-white truncate">{theme.name}</p>
              {theme.mood && <p className="text-[11px] text-white/50 leading-snug mt-0.5">{theme.mood}</p>}
              <p className="text-[11px] text-white/45 mt-1">
                {theme.fonts.heading} + {theme.fonts.body}
              </p>
            </div>
            <div className="ml-auto flex gap-2 shrink-0">
              <button
                className="text-[11px] text-white/55 hover:text-white px-2.5 h-8 rounded-lg hover:bg-white/10"
                onClick={() => setTheme(null)}
              >
                Redraft
              </button>
              <button className="btn-cv h-8 px-3.5 text-[11.5px] flex items-center gap-1.5" onClick={apply}>
                <Check size={12} /> Apply theme
              </button>
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-white/10 overflow-hidden">
            {theme.palette.map((c) => (
              <div key={c.role} className="flex items-center gap-2.5 px-2.5 h-10 border-b border-white/[0.06] last:border-b-0" style={{ background: `${c.hex}14` }}>
                <span className="w-6 h-6 rounded-md border border-white/15 shrink-0" style={{ background: c.hex }} />
                <span className="text-[11.5px] text-white/80">{ROLE_LABELS[c.role] ?? c.role}</span>
                <span className="ml-auto font-mono text-[10.5px] text-white/45">{c.hex}</span>
              </div>
            ))}
          </div>

          <p className="mt-3 text-[10.5px] text-white/35 leading-snug">
            Applying recolors page backgrounds, text, shapes and lines across every page. Images, charts and
            stickers stay untouched; one Ctrl+Z reverts everything.
          </p>
        </div>
      )}
    </div>
  )
}
