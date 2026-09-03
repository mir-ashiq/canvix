'use client'

import { Link2, Check, Copy, Globe, Lock, QrCode } from 'lucide-react'
import { useState } from 'react'
import { useEditorStore } from '@/store/editor-store'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

type Access = 'private' | 'link' | 'public'

const ACCESS_OPTS: { id: Access; label: string; desc: string; icon: typeof Lock }[] = [
  { id: 'private', label: 'Only me', desc: 'Private to you', icon: Lock },
  { id: 'link', label: 'Anyone with the link', desc: 'Can view or edit', icon: Link2 },
  { id: 'public', label: 'Public', desc: 'Listed in the community gallery', icon: Globe },
]

function readSavedAccess(designId: string | null): Access {
  if (typeof window === 'undefined' || !designId) return 'link'
  const saved = localStorage.getItem(`canvix:share:${designId}`)
  return saved === 'private' || saved === 'public' ? saved : 'link'
}

/** Canva-style Share dialog — copy link + access levels (local-first). */
export function ShareDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const designId = useEditorStore((s) => s.designId)
  const designName = useEditorStore((s) => s.designName)
  const [copied, setCopied] = useState(false)

  const link = designId ? `${typeof window !== 'undefined' ? window.location.origin : ''}/?design=${designId}` : ''

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      toast({ title: 'Share link copied to clipboard' })
      setTimeout(() => setCopied(false), 1800)
    } catch {
      toast({ title: 'Could not copy — select and copy manually', description: link })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#16181D] border-white/10 text-white sm:max-w-md">
        {open && <ShareBody designId={designId} designName={designName} link={link} copied={copied} onCopy={() => void copy()} />}
      </DialogContent>
    </Dialog>
  )
}

function ShareBody({ designId, designName, link, copied, onCopy }: {
  designId: string | null
  designName: string
  link: string
  copied: boolean
  onCopy: () => void
}) {
  const [access, setAccess] = useState<Access>(() => readSavedAccess(designId))

  const setAccessAndPersist = (a: Access) => {
    setAccess(a)
    if (designId) localStorage.setItem(`canvix:share:${designId}`, a)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-lg font-bold flex items-center gap-2">
          Share “{designName || 'Untitled design'}”
        </DialogTitle>
        <DialogDescription className="text-white/60">
          Canvix is local-first: the link points back to your Canvix instance.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 pl-3 pr-1.5 py-1.5 h-12">
          <Link2 size={16} className="text-white/50 shrink-0" />
          <input
            readOnly
            value={link}
            className="flex-1 min-w-0 bg-transparent outline-none text-[13px] text-white/80 truncate"
            aria-label="Share link"
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button className="btn-cv h-9 px-4 shrink-0 gap-1.5" onClick={onCopy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy link'}
          </Button>
        </div>

        <div className="rounded-xl border border-white/10 overflow-hidden divide-y divide-white/10">
          {ACCESS_OPTS.map((o) => (
            <button
              key={o.id}
              onClick={() => setAccessAndPersist(o.id)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-3 text-left transition-colors',
                access === o.id ? 'bg-[#7630D7]/25' : 'hover:bg-white/5'
              )}
              aria-pressed={access === o.id}
            >
              <o.icon size={17} className={access === o.id ? 'text-[#a78bfa]' : 'text-white/60'} />
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] font-semibold">{o.label}</span>
                <span className="block text-[11px] text-white/50">{o.desc}</span>
              </span>
              {access === o.id && <Check size={15} className="text-[#a78bfa] shrink-0" />}
            </button>
          ))}
        </div>

        <p className="text-[11px] text-white/40 flex items-center gap-1.5">
          <QrCode size={13} /> In the open-source spirit — access control lives in your deployment, not our cloud.
        </p>
      </div>
    </>
  )
}
