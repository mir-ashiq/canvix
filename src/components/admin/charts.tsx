// Zero-dependency chart primitives for the admin console (v0.16 A1).
// Hand-rolled SVG — the same "no new dependency" discipline the GIF
// muxer and WebM writer follow. Accessible: every bar/point carries a
// <title> tooltip; axes are decorative text, values live in the DOM
// tables next to the charts.

import { cn } from '@/lib/utils'

export interface Bar {
  label: string
  value: number
  /** stacked secondary segment (e.g. failed AI calls) */
  alt?: number
}

/** 1.2k / 3.4M compact formatting for stat cards and axes. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(Math.round(n))
}

export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} kB`
  return `${Math.round(n)} B`
}

/** Vertical bars, optional stacked second color, ~4 x labels. */
export function BarChart({
  bars,
  height = 150,
  color = 'var(--cv-teal)',
  altColor = 'var(--destructive)',
  className,
}: {
  bars: Bar[]
  height?: number
  color?: string
  altColor?: string
  className?: string
}) {
  const W = Math.max(bars.length * 26, 120)
  const H = height
  const padBottom = 18
  const max = Math.max(1, ...bars.map((b) => b.value + (b.alt ?? 0)))
  const slot = W / Math.max(bars.length, 1)
  const barW = Math.min(16, slot * 0.6)
  const labelIdx = new Set(
    bars.length <= 5
      ? bars.map((_, i) => i)
      : [0, Math.floor((bars.length - 1) / 3), Math.floor(((bars.length - 1) * 2) / 3), bars.length - 1]
  )
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={cn('w-full', className)}
      style={{ height }}
      role="img"
      aria-label={`bar chart, ${bars.length} days`}
    >
      {bars.map((b, i) => {
        const total = b.value + (b.alt ?? 0)
        const h = (total / max) * (H - padBottom)
        const x = i * slot + (slot - barW) / 2
        const altH = b.alt ? (b.alt / max) * (H - padBottom) : 0
        const mainH = h - altH
        return (
          <g key={b.label}>
            <title>{`${b.label}: ${b.value}${b.alt ? ` (+${b.alt} failed)` : ''}`}</title>
            <rect x={x} y={H - padBottom - mainH} width={barW} height={Math.max(mainH, 0)} rx={2} fill={color} opacity={0.9} />
            {altH > 0.5 && (
              <rect x={x} y={H - padBottom - h} width={barW} height={altH} rx={2} fill={altColor} opacity={0.55} />
            )}
            {labelIdx.has(i) && (
              <text x={i * slot + slot / 2} y={H - 5} textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.55">
                {b.label.slice(5)}
              </text>
            )}
          </g>
        )
      })}
      {bars.every((b) => b.value === 0 && !b.alt) && (
        <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="11" fill="currentColor" opacity="0.4">
          no data yet
        </text>
      )}
    </svg>
  )
}

/** Smooth-ish line + soft area fill. */
export function LineChart({
  points,
  height = 150,
  color = 'var(--cv-violet)',
  className,
}: {
  points: { label: string; value: number }[]
  height?: number
  color?: string
  className?: string
}) {
  const W = Math.max(points.length * 26, 120)
  const H = height
  const padBottom = 18
  const max = Math.max(1, ...points.map((p) => p.value))
  const step = W / Math.max(points.length - 1, 1)
  const xy = points.map((p, i) => [i * step, H - padBottom - (p.value / max) * (H - padBottom - 6)] as const)
  const line = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${line} L${W},${H - padBottom} L0,${H - padBottom} Z`
  const labelIdx = new Set(
    points.length <= 5
      ? points.map((_, i) => i)
      : [0, Math.floor((points.length - 1) / 2), points.length - 1]
  )
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={cn('w-full', className)}
      style={{ height }}
      role="img"
      aria-label={`line chart, ${points.length} days`}
    >
      <defs>
        <linearGradient id="cv-admin-line-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#cv-admin-line-fill)" />
      <path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      {points.map((p, i) => (
        <g key={p.label}>
          <title>{`${p.label}: ${p.value}`}</title>
          <rect x={i * step - step / 2} y={0} width={Math.max(step, 8)} height={H - padBottom} fill="transparent" />
        </g>
      ))}
      {[...labelIdx].map((i) => (
        <text key={i} x={i * step} y={H - 5} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} fontSize="9" fill="currentColor" opacity="0.55">
          {points[i].label.slice(5)}
        </text>
      ))}
      {points.every((p) => p.value === 0) && (
        <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="11" fill="currentColor" opacity="0.4">
          no data yet
        </text>
      )}
    </svg>
  )
}

/** Horizontal labelled bars — plain divs, crisp text, no measuring. */
export function HBars({
  rows,
  color = 'var(--cv-teal)',
}: {
  rows: { label: string; value: number; hint?: string }[]
  color?: string
}) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="space-y-2">
      {rows.length === 0 && <p className="text-sm text-muted-foreground">no data yet</p>}
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3" title={r.hint}>
          <span className="w-28 shrink-0 truncate text-xs text-muted-foreground" title={r.label}>
            {r.label}
          </span>
          <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full"
              style={{ width: `${Math.max((r.value / max) * 100, r.value > 0 ? 2 : 0)}%`, background: color }}
            />
          </span>
          <span className="w-12 shrink-0 text-right text-xs tabular-nums text-foreground">{fmt(r.value)}</span>
        </div>
      ))}
    </div>
  )
}
