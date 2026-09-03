'use client'

import dynamic from 'next/dynamic'
import { useAppStore } from '@/store/app-store'
import { Landing } from '@/components/landing/Landing'
import { Dashboard } from '@/components/dashboard/Dashboard'

const Editor = dynamic(() => import('@/components/editor/Editor'), {
  ssr: false,
  loading: () => (
    <div className="h-screen w-full flex items-center justify bg-[#E9EAF0]">
      <div className="flex flex-col items-center gap-4">
        <div className="h-10 w-10 rounded-full border-4 border-[#00C4CC] border-t-transparent animate-spin" />
        <p className="text-sm text-muted-foreground font-medium">Loading editor…</p>
      </div>
    </div>
  ),
})

export default function Page() {
  const view = useAppStore((s) => s.view)

  if (view === 'editor') {
    return <Editor />
  }
  if (view === 'dashboard') {
    return <Dashboard />
  }
  return <Landing />
}
