'use client'

import { useState, type ReactNode } from 'react'
import { Search, Sparkles, Mic, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PanelShellProps {
  title: string
  subtitle?: string
  /** canva-style AI prompt + Generate/Search row */
  searchPlaceholder?: string
  onSearch?: (q: string) => void
  children: ReactNode
  /** extra row under the search bar (e.g. filter chips) */
  belowSearch?: ReactNode
  onClose?: () => void
}

/** Dark side-panel shell matching canva.com 2026: header, AI prompt row, purple Search button. */
export function PanelShell({ title, subtitle, searchPlaceholder, onSearch, children, belowSearch, onClose }: PanelShellProps) {
  const [q, setQ] = useState('')
  const submit = () => onSearch?.(q.trim())

  return (
    <div className="flex flex-col h-full bg-[#16181D] text-[#EDEEF2]">
      <div className="px-4 pt-4 pb-3 border-b border-white/[0.07] shrink-0">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm">{title}</h3>
          {onClose && (
            <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 md:hidden" aria-label="Close panel">
              <X size={15} />
            </button>
          )}
        </div>
        {subtitle && <p className="text-xs text-white/50 mt-0.5">{subtitle}</p>}
      </div>

      {searchPlaceholder && (
        <div className="px-4 pt-3 pb-2 shrink-0">
          <div className="flex rounded-xl border border-white/10 bg-white/[0.05] focus-within:border-[#7630D7] transition-colors h-10 items-center px-3 gap-2">
            <Search size={15} className="text-white/40 shrink-0" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder={searchPlaceholder}
              className="flex-1 min-w-0 bg-transparent outline-none text-[13px] placeholder:text-white/35"
              aria-label={`${title} search`}
            />
            <button className="w-6 h-6 rounded-full flex items-center justify-center text-white/40 hover:text-white shrink-0" aria-label="Describe with AI" title="Describe with AI">
              <Mic size={13} />
            </button>
          </div>

          {/* canva AI row: Generate (split-radius) + purple Search */}
          <div className="flex gap-2 mt-2">
            <button
              className="flex-1 h-10 rounded-l-xl rounded-r-none border border-white/12 bg-white/[0.05] hover:bg-white/10 text-[13px] font-semibold flex items-center justify-center gap-1.5 transition-colors"
              onClick={submit}
              aria-label="Generate with AI"
              title="Generate with AI (open-source roadmap)"
            >
              <Sparkles size={14} className="text-[#02C0CC]" /> Generate
            </button>
            <button className="w-[104px] h-10 rounded-r-xl rounded-l-none bg-[#7630D7] hover:bg-[#8B5CF6] text-white text-[13px] font-semibold transition-colors" onClick={submit} aria-label="Search">
              Search
            </button>
          </div>
          {belowSearch}
        </div>
      )}

      <div className={cn('flex-1 overflow-y-auto cv-scroll-dark', searchPlaceholder ? 'px-4 pb-4 pt-1' : 'p-4')}>{children}</div>
    </div>
  )
}
