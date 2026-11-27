import { cn } from '@/lib/utils'

/** MIDAD gradient emblem — a drop of ink and a flowing stroke */
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
        <linearGradient id="midad-grad" x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#00C4CC" />
          <stop offset="0.55" stopColor="#7D2AE8" />
          <stop offset="1" stopColor="#FF5C8A" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill="url(#midad-grad)" />
      <path d="M24 7.5C19.2 15 11 24.3 11 31.8C11 39.1 16.8 44.5 24 44.5C31.2 44.5 37 39.1 37 31.8C37 24.3 28.8 15 24 7.5Z" fill="#FFFFFF" fillOpacity="0.96" />
      <path d="M16.5 33.8C19 29.8 21.5 28.3 24 28.3C26.5 28.3 29 29.8 31.5 33.8" stroke="#7D2AE8" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="24" cy="20.5" r="2" fill="#00AEBB" />
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
          fontSize: size * 0.78,
          fontFamily: 'var(--font-noto-sans-arabic), sans-serif',
          letterSpacing: 'normal',
          background: 'linear-gradient(120deg, #00C4CC 0%, #7D2AE8 55%, #FF5C8A 100%)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
        }}
      >
        مداد
      </span>
    </span>
  )
}
