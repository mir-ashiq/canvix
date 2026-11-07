import { AdminLogs } from '@/components/admin/logs'

// /admin/logs (v0.16.3 A3) — AI request log + slot status. The layout
// already gated this path to admins server-side; the API re-checks.
export const dynamic = 'force-dynamic'

export default function AdminLogsPage() {
  return <AdminLogs />
}
