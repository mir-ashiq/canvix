'use client'

// ─────────────────────────────────────────────────────────────
// AuthDialog (v0.9) — sign in / create an account.
// Username + password only: no email verification, no OAuth.
// ─────────────────────────────────────────────────────────────

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Logo } from '@/components/logo'
import { cn } from '@/lib/utils'
import { setDisplayName } from '@/lib/collab/identity'

export interface AuthDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAuthed: (username: string) => void
  initialMode?: 'login' | 'register'
}

export function AuthDialog({ open, onOpenChange, onAuthed, initialMode = 'login' }: AuthDialogProps) {
  // Keep form state inside DialogContent so it resets when the dialog closes.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px] bg-[#16181D] border-white/10 text-white p-0 overflow-hidden">
        <AuthDialogForm onOpenChange={onOpenChange} onAuthed={onAuthed} initialMode={initialMode} />
      </DialogContent>
    </Dialog>
  )
}

function AuthDialogForm({ onOpenChange, onAuthed, initialMode }: Omit<AuthDialogProps, 'open'>) {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode ?? 'login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register'
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const data = (await res.json().catch(() => ({}))) as { user?: { username: string }; error?: string }
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'حدث خطأ ما. حاول مرة أخرى.')
        return
      }
      if (data.user?.username) setDisplayName(data.user.username)
      onAuthed(data.user?.username ?? username.trim())
      onOpenChange(false)
    } catch {
      setError('تعذر الاتصال بالخادم. حاول مرة أخرى.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="cv-topbar-gradient h-1.5 w-full" />
      <div className="p-6" dir="rtl">
        <DialogHeader className="items-start space-y-2">
          <div className="flex items-center gap-2.5">
            <Logo size={24} />
            <DialogTitle className="text-lg font-semibold">
              {mode === 'login' ? 'مرحباً بعودتك' : 'أنشئ حسابك المجاني'}
            </DialogTitle>
          </div>
          <DialogDescription className="text-white/50 text-[13px] leading-relaxed text-right">
            {mode === 'login'
              ? 'سجّل الدخول للاحتفاظ بتصاميمك بأمان في حسابك.'
              : 'حساب مجاني لحفظ أعمالك والوصول إليها في أي وقت.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="mt-5 space-y-3.5">
          <div className="space-y-1.5">
            <label htmlFor="cv-auth-username" className="text-[12px] font-medium text-white/70">
              اسم المستخدم
            </label>
            <Input
              id="cv-auth-username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="مثال: tea_g3"
              className="h-10 bg-white/[0.06] border-white/10 text-white placeholder:text-white/30 focus-visible:ring-[#7630D7]/50"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="cv-auth-password" className="text-[12px] font-medium text-white/70">
              كلمة المرور
            </label>
            <div className="relative">
              <Input
                id="cv-auth-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'login' ? 'أدخل كلمة المرور' : '8 أحرف على الأقل'}
                className="h-10 pr-10 bg-white/[0.06] border-white/10 text-white placeholder:text-white/30 focus-visible:ring-[#7630D7]/50"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
                aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-[12.5px] text-[#FF6B81] bg-[#FF6B81]/10 border border-[#FF6B81]/20 rounded-lg px-3 py-2" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" disabled={busy || !username.trim() || !password} className="btn-cv w-full h-10 rounded-full font-semibold">
            {busy ? (mode === 'login' ? 'جارٍ تسجيل الدخول…' : 'جارٍ إنشاء الحساب…') : mode === 'login' ? 'تسجيل الدخول' : 'إنشاء حساب'}
          </Button>
        </form>

        <p className="mt-4 text-center text-[12.5px] text-white/45">
          {mode === 'login' ? 'ليس لديك حساب؟ ' : 'لديك حساب بالفعل؟ '}
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login')
              setError(null)
            }}
            className={cn('font-semibold text-[#00C4CC] hover:text-[#00C4CC]/80 underline-offset-2 hover:underline')}
          >
            {mode === 'login' ? 'أنشئ حساباً مجاناً' : 'تسجيل الدخول'}
          </button>
        </p>
      </div>
    </>
  )
}
