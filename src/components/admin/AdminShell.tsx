'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { LayoutDashboard, Users, Sparkles, Settings, ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Logo } from '@/components/logo'

const NAV = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/admin/users', label: 'Users', icon: Users, exact: false },
  { href: '/admin/ai', label: 'AI & models', icon: Sparkles, exact: false },
  { href: '/admin/settings', label: 'Settings', icon: Settings, exact: false },
] as const

/**
 * The console chrome (v0.16 A1): brand bar + section nav + back link.
 * Server-side gating already happened in the layout — this component
 * never renders for non-admins, and every API it calls re-checks anyway
 * (defense in depth).
 */
export function AdminShell({
  username,
  children,
}: {
  username: string
  children: ReactNode
}) {
  const pathname = usePathname()
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="cv-topbar-gradient h-1.5 w-full" />
      <div className="mx-auto flex max-w-6xl flex-col gap-0 px-4 pb-16 md:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3 py-5">
          <div className="flex items-center gap-3">
            <Logo size={30} />
            <div>
              <h1 className="text-lg font-bold leading-tight">Admin console</h1>
              <p className="text-xs text-muted-foreground">
                signed in as <span className="font-medium text-foreground">{username}</span>
              </p>
            </div>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-sm font-medium text-card-foreground transition-colors hover:bg-muted"
          >
            <ArrowLeft size={15} /> Back to Canvix
          </Link>
        </header>

        <nav className="mb-6 flex gap-1 overflow-x-auto rounded-xl border bg-card p-1" aria-label="Admin sections">
          {NAV.map((item) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors',
                  active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <item.icon size={16} />
                {item.label}
              </Link>
            )
          })}
        </nav>

        <main className="flex flex-col gap-5">{children}</main>
      </div>
    </div>
  )
}
