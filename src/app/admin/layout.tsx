import { cookies } from 'next/headers'
import { getSessionUserFromToken, SESSION_COOKIE } from '@/lib/auth/session'
import { isAdminUser } from '@/lib/admin/guard'
import { AdminShell } from '@/components/admin/AdminShell'
import { AdminDenied } from '@/components/admin/AdminDenied'
import type { Metadata } from 'next'

// v0.23.3 (SEO): the admin console is operator machinery — keep it out of
// every index. (Defence in depth: the route also sits behind this auth gate.)
export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false, nocache: true },
}

// The server-side gate (v0.16 A1). Every /admin page renders inside
// this layout, so the check runs before any child fetch; the API
// routes re-check independently (defense in depth — the layout is
// convenience, the API is the boundary).
export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const user = await getSessionUserFromToken(token)
  if (!user) return <AdminDenied signedIn={false} />
  if (!isAdminUser(user)) return <AdminDenied signedIn username={user.username} />
  return <AdminShell username={user.username}>{children}</AdminShell>
}
