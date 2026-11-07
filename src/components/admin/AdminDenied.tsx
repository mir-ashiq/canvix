import Link from 'next/link'
import { LogIn, ShieldAlert } from 'lucide-react'

/**
 * Rendered by the admin layout when the visitor is not an admin
 * (v0.16 A1). No detail about WHO is admin leaks — just the two states:
 * not signed in, or signed in without access.
 */
export function AdminDenied({ signedIn, username }: { signedIn: boolean; username?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-md rounded-xl border bg-card p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          {signedIn ? <ShieldAlert size={22} className="text-muted-foreground" /> : <LogIn size={22} className="text-muted-foreground" />}
        </div>
        <h1 className="text-lg font-semibold">
          {signedIn ? 'No administrator access' : 'Sign in required'}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {signedIn ? (
            <>
              The account <span className="font-medium text-foreground">{username}</span> does not have admin rights on
              this instance.
            </>
          ) : (
            'The admin console needs a signed-in administrator account.'
          )}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Administrators are granted via the <code className="rounded bg-muted px-1">CANVIX_ADMIN_USERS</code> environment
          variable or by another administrator.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
        >
          Back to Canvix
        </Link>
      </div>
    </div>
  )
}
