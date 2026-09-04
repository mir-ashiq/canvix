'use client'

import { useState } from 'react'
import { Wifi, WifiOff, Loader2, Pencil } from 'lucide-react'
import { useEditorStore } from '@/store/editor-store'
import { getIdentity, setDisplayName } from '@/lib/collab/identity'
import { cn } from '@/lib/utils'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Input } from '@/components/ui/input'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

/** Stacked collaborator avatars + connection status (canva-style, topbar right). */
export function PresenceAvatars() {
  const collaborators = useEditorStore((s) => s.collaborators)
  const status = useEditorStore((s) => s.collabStatus)
  const [open, setOpen] = useState(false)

  const me = getIdentity()

  return (
    <div className="flex items-center gap-2 mr-1">
      {/* connection status */}
      {status === 'live' ? (
        <span className="hidden xl:flex items-center gap-1 text-[11px] font-semibold text-emerald-300/90" title={`Live — ${collaborators.length + 1} editing`}>
          <Wifi size={12} /> Live
        </span>
      ) : status === 'connecting' ? (
        <span className="hidden xl:flex items-center gap-1 text-[11px] font-semibold text-amber-300/90" title="Reconnecting…">
          <Loader2 size={12} className="animate-spin" /> Syncing
        </span>
      ) : (
        <span className="hidden xl:flex items-center gap-1 text-[11px] font-semibold text-white/40" title="Offline — edits save locally">
          <WifiOff size={12} /> Offline
        </span>
      )}

      {/* stacked avatars */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className="flex items-center -space-x-1.5 pr-1.5 cursor-pointer group"
            aria-label={`Collaborators (${collaborators.length + 1})`}
          >
            {/* local identity first */}
            <AvatarChip name={initials(me.name)} color={me.color} title={`${me.name} (you)`} />
            {collaborators.slice(0, 3).map((c) => (
              <AvatarChip key={c.id} name={initials(c.name)} color={c.color} title={c.name} />
            ))}
            {collaborators.length > 3 && (
              <span className="w-6 h-6 rounded-full bg-white/20 border-2 border-[#4B2E93] text-[9px] font-bold text-white flex items-center justify-center">
                +{collaborators.length - 3}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 rounded-2xl bg-[#16181D] border-white/10 text-white p-3">
          <div className="text-xs font-semibold text-white/60 mb-2">In this design</div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5 rounded-lg bg-white/[0.06] p-2">
              <AvatarChip name={initials(me.name)} color={me.color} title={me.name} size={30} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold truncate">{me.name} (you)</div>
                <div className="text-[11px] text-white/45">Editing</div>
              </div>
            </div>
            {collaborators.map((c) => (
              <div key={c.id} className="flex items-center gap-2.5 rounded-lg p-2 hover:bg-white/[0.05]">
                <AvatarChip name={initials(c.name)} color={c.color} title={c.name} size={30} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold truncate">{c.name}</div>
                  <div className="text-[11px] text-white/45">
                    {c.cursor ? `Page ${c.cursor.page + 1}${c.cursor.selection?.length ? ' · selecting' : ''}` : 'Viewing'}
                  </div>
                </div>
              </div>
            ))}
            {collaborators.length === 0 && (
              <div className="text-[12px] text-white/40 px-2 pb-1">
                Share the design link to edit together in real time.
              </div>
            )}
          </div>
          <NameEditor current={me.name} />
        </PopoverContent>
      </Popover>
    </div>
  )
}

function NameEditor({ current }: { current: string }) {
  const [name, setName] = useState(current)
  return (
    <div className="mt-3 pt-3 border-t border-white/10 flex items-center gap-2">
      <Pencil size={12} className="text-white/40 shrink-0" />
      <Input
        value={name}
        maxLength={40}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => setDisplayName(name)}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        placeholder="Your display name"
        className="h-8 text-[12px] bg-white/[0.06] border-white/10 text-white placeholder:text-white/30"
        aria-label="Your display name"
      />
    </div>
  )
}

function AvatarChip({ name, color, title, size = 24 }: { name: string; color: string; title: string; size?: number }) {
  return (
    <span
      className={cn('rounded-full flex items-center justify-center text-[9px] font-bold text-white border-2 border-[#4B2E93] shrink-0')}
      style={{ width: size, height: size, background: color, fontSize: size >= 30 ? '11px' : '9px' }}
      title={title}
    >
      {name}
    </span>
  )
}
