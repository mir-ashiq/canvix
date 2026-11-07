import { cookies } from 'next/headers'
import { getSessionUserFromToken, SESSION_COOKIE } from '@/lib/auth/session'
import { isAdminUser } from '@/lib/admin/guard'
import { AdminShell } from '@/components/admin/AdminShell'
import { AdminDenied } from '@/components/admin/AdminDenied'

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
