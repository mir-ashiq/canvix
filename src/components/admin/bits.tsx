import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** One big number on the overview grid. */
export function StatCard({
  label,
  value,
  sub,
  className,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('rounded-xl border bg-card p-4', className)}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-card-foreground">{value}</p>
      {sub !== undefined && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

/** The console's section card. */
export function Card({
  title,
  right,
  children,
  className,
}: {
  title?: ReactNode
  right?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('rounded-xl border bg-card p-5', className)}>
      {(title || right) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-card-foreground">{title}</h2>
          {right}
        </header>
      )}
      {children}
    </section>
  )
}

/** Accessible switch, zero new dependencies. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full transition-colors',
        checked ? 'bg-[var(--cv-teal)]' : 'bg-muted-foreground/30',
        disabled && 'cursor-not-allowed opacity-50'
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
          checked ? 'left-[22px]' : 'left-0.5'
        )}
      />
    </button>
  )
}

/** Where admin rights come from — shown next to usernames. */
export function RoleBadge({ admin, source }: { admin: boolean; source: string | null }) {
  if (!admin) return <span className="text-xs text-muted-foreground">user</span>
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--cv-teal)]/15 px-2 py-0.5 text-xs font-medium text-[var(--cv-teal)]">
      admin{source === 'env' ? ' · env' : source === 'both' ? ' · env+db' : ''}
    </span>
  )
}

/** Small pill for provider status etc. */
export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'bad' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        tone === 'good' && 'bg-emerald-500/15 text-emerald-600',
        tone === 'bad' && 'bg-destructive/10 text-destructive',
        tone === 'neutral' && 'bg-muted text-muted-foreground'
      )}
    >
      {children}
    </span>
  )
}
