import { cn } from '@/lib/utils'

/** Canvix gradient logo mark — stacked design layers */
export function LogoMark({ className, size = 36 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="canvix-grad" x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#00C4CC" />
          <stop offset="0.55" stopColor="#7D2AE8" />
          <stop offset="1" stopColor="#FF5C8A" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill="url(#canvix-grad)" />
      {/* stacked design layers */}
      <rect x="12" y="10" width="24" height="8" rx="3" fill="#FFFFFF" fillOpacity="0.45" />
      <rect x="12" y="21" width="24" height="8" rx="3" fill="#FFFFFF" fillOpacity="0.7" />
      <rect x="12" y="32" width="16" height="6" rx="3" fill="#FFFFFF" />
      <circle cx="36.5" cy="35" r="2.5" fill="#FFFFFF" fillOpacity="0.9" />
    </svg>
  )
}

/** Full wordmark lockup */
export function Logo({ className, size = 32 }: { className?: string; size?: number }) {
  return (
    <span className={cn('inline-flex items-center gap-2 select-none', className)}>
      <LogoMark size={size} />
      <span
        className="font-extrabold tracking-tight leading-none"
        style={{
          fontSize: size * 0.62,
          background: 'linear-gradient(120deg, #00C4CC 0%, #7D2AE8 55%, #FF5C8A 100%)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
        }}
      >
        canvix
      </span>
    </span>
  )
}
