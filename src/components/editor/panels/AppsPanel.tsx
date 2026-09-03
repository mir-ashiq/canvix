'use client'

import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { PanelShell } from './panel-shell'
import { CANVIX_APPS, type CanvixApp } from '../apps/registry'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

/** Canva Apps panel — a registry-driven app ecosystem. Open an app to get its
 *  full panel UI; new apps are added by registering in apps/registry.tsx. */
export function AppsPanel() {
  const [open, setOpen] = useState<CanvixApp | null>(null)

  return (
    <PanelShell title="Apps" subtitle={open ? open.desc : 'Superpowers for your design'}>
      {open ? (
        <open.content onClose={() => setOpen(null)} />
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          {CANVIX_APPS.map((app) => (
            <AppCard key={app.id} app={app} onOpen={() => setOpen(app)} />
          ))}
          <div className="col-span-2 mt-1 rounded-xl border border-dashed border-white/12 p-3 text-center">
            <p className="text-[11px] text-white/40 leading-relaxed">
              Canvix apps are open —{' '}
              <a
                href="https://github.com/mir-ashiq/canvix"
                target="_blank"
                rel="noreferrer"
                className="text-[#02C0CC] hover:underline"
              >
                build your own
              </a>{' '}
              by registering a component in <code className="text-white/60">apps/registry.tsx</code>.
            </p>
          </div>
        </div>
      )}
    </PanelShell>
  )
}

function AppCard({ app, onOpen }: { app: CanvixApp; onOpen: () => void }) {
  const Icon = app.icon
  const soon = !app.content
  const handleClick = () => {
    if (soon) {
      toast({ title: `${app.name} is on the open-source roadmap` })
      return
    }
    onOpen()
  }
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ${app.name} app`}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleClick()
        }
      }}
      className="rounded-xl border border-white/10 bg-white/[0.03] p-3 hover:border-[#7630D7] transition-colors flex flex-col cursor-pointer focus:outline-none focus-visible:border-[#7630D7]"
    >
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${app.color}22` }}>
        <Icon size={20} style={{ color: app.color }} />
      </div>
      <div className="mt-2 text-[13px] font-semibold">{app.name}</div>
      <div className="text-[11px] text-white/45 leading-tight flex-1">{app.desc}</div>
      <button
        className={cn('mt-2.5 h-8 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors', soon ? 'bg-white/5 text-white/40' : 'bg-[#7630D7] hover:bg-[#8B5CF6] text-white')}
        onClick={(e) => {
          e.stopPropagation()
          handleClick()
        }}
      >
        {soon ? 'Soon' : 'Open'} {!soon && <ArrowRight size={11} />}
      </button>
    </div>
  )
}
