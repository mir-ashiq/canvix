'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bot, Copy, Check, Plug, KeyRound, Info, User, Server, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * v0.25 — "AI agents (MCP)" dashboard card, BYO-MCP edition.
 *
 * Two ways to connect an agent now:
 *   • Personal token (any signed-in user — works on canvix.app where
 *     no operator token exists): one click creates an API key with the
 *     'mcp' scope; the client config is prefilled with it. Tools are
 *     scoped to YOUR designs and AI generation uses your BYOK
 *     providers first — exactly like the AI panel.
 *   • Operator token (self-hosters): set CANVIX_MCP_TOKEN — unscoped,
 *     the historical behaviour.
 */
export function McpCard() {
  const [status, setStatus] = useState<'checking' | 'enabled' | 'user-tokens' | 'disabled'>('checking')
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [copied, setCopied] = useState<'url' | 'config' | 'token' | null>(null)
  // personal-token flow state
  const [token, setToken] = useState<string | null>(null) // shown exactly once
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/mcp', { method: 'OPTIONS' })
      .then((r) => r.json())
      .then((d: { mcp?: string }) => {
        if (!cancelled) setStatus(d.mcp === 'enabled' ? 'enabled' : d.mcp === 'user-tokens' ? 'user-tokens' : 'disabled')
      })
      .catch(() => {
        if (!cancelled) setStatus('disabled')
      })
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { user?: unknown }) => {
        if (!cancelled) setSignedIn(Boolean(d.user))
      })
      .catch(() => {
        if (!cancelled) setSignedIn(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://your-canvix.example.com'
  const endpoint = `${origin}/api/mcp`

  const clientConfig = JSON.stringify(
    {
      mcpServers: {
        canvix: {
          url: endpoint,
          headers: { Authorization: `Bearer ${token ?? '<YOUR_TOKEN>'}` },
        },
      },
    },
    null,
    2
  )

  const copy = useCallback(async (what: 'url' | 'config' | 'token', text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      setTimeout(() => setCopied(null), 1800)
    } catch {
      /* clipboard unavailable */
    }
  }, [])

  /** Create a personal MCP token: POST /api/keys with the 'mcp' scope. */
  const createToken = useCallback(async () => {
    if (creating || token) return
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: `MCP agent ${new Date().toLocaleDateString()}`, scopes: ['mcp'] }),
      })
      const data = (await res.json()) as { key?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not create the token.')
      setToken(data.key ?? null)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Could not create the token.')
    } finally {
      setCreating(false)
    }
  }, [creating, token])

  const statusLabel =
    status === 'enabled'
      ? 'Enabled'
      : status === 'user-tokens'
        ? 'Personal tokens'
        : status === 'disabled'
          ? 'Off'
          : 'Checking…'

  return (
    <section id="cv-agents" className="pt-12 scroll-mt-20">
      <h2 className="text-xl font-bold">AI agents (MCP)</h2>
      <div className="mt-4 rounded-2xl border border-white/10 bg-[#16171D] p-5 flex flex-col sm:flex-row items-center gap-6">
        <div className="h-12 w-12 rounded-2xl bg-brand-gradient-soft flex items-center justify-center text-[#A78BFA] shrink-0">
          <Bot size={24} />
        </div>
        <div className="flex-1 text-center sm:text-left">
          <div className="text-sm font-semibold flex items-center justify-center sm:justify-start gap-2 flex-wrap">
            Let AI assistants design with Canvix
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                status === 'enabled'
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : status === 'user-tokens'
                    ? 'bg-sky-500/15 text-sky-300'
                    : status === 'disabled'
                      ? 'bg-amber-500/15 text-amber-300'
                      : 'bg-white/10 text-white/50'
              )}
              data-testid="mcp-status"
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  status === 'enabled' ? 'bg-emerald-400' : status === 'user-tokens' ? 'bg-sky-400' : status === 'disabled' ? 'bg-amber-400' : 'bg-white/40'
                )}
              />
              {statusLabel}
            </span>
          </div>
          <div className="text-xs text-white/40 mt-1">
            Claude, Cursor, ChatGPT &amp; any MCP client can create and edit real designs — connect with a personal token (your designs only) or the server token.
          </div>
        </div>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" className="rounded-xl border-white/15 bg-transparent text-white hover:bg-white/10 hover:text-white shrink-0">
              <Plug size={14} className="mr-1.5" /> Connect an agent
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg bg-[#16171D] border-white/10 text-white">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Bot size={16} className="text-[#A78BFA]" /> Connect an AI agent to Canvix
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 text-sm">
              {/* ── personal token rail (BYO-MCP) ── */}
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center gap-2 text-[13px] font-medium">
                  <User size={14} className="text-[#00C4CC]" /> Personal token{' '}
                  <span className="text-[10px] font-bold uppercase tracking-wide rounded-full bg-sky-500/15 text-sky-300 px-2 py-0.5">Recommended</span>
                </div>
                <p className="text-[12px] text-white/50 mt-1">
                  Works for any signed-in account — no server setup. The agent sees <span className="text-white/70">your designs only</span>, and AI generation
                  uses <span className="text-white/70">your saved AI providers</span> first (bring your own key).
                </p>

                {!token ? (
                  <div className="mt-2.5">
                    <Button
                      size="sm"
                      className="btn-cv h-8 gap-1.5"
                      disabled={creating || signedIn === false}
                      onClick={() => void createToken()}
                      data-testid="mcp-create-token"
                    >
                      {creating ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />}
                      {creating ? 'Creating…' : 'Create my MCP token'}
                    </Button>
                    {signedIn === false && (
                      <p className="text-[11px] text-amber-300/80 mt-1.5">Sign in first — personal tokens need an account.</p>
                    )}
                    {createError && <p className="text-[11px] text-red-300 mt-1.5">{createError}</p>}
                  </div>
                ) : (
                  <div className="mt-2.5 space-y-2" data-testid="mcp-token-ready">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-medium text-white/60 uppercase tracking-wide">Your token (shown once)</span>
                        <button
                          className="flex items-center gap-1 text-[11px] text-white/50 hover:text-white"
                          onClick={() => void copy('token', token)}
                          aria-label="Copy token"
                        >
                          {copied === 'token' ? <Check size={12} /> : <Copy size={12} />} Copy
                        </button>
                      </div>
                      <code className="block rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-[12px] text-[#02C0CC] break-all" data-testid="mcp-token">
                        {token}
                      </code>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[12px] font-medium text-white">Client config (Claude Desktop, Cursor, …)</span>
                        <button
                          className="flex items-center gap-1 text-[11px] text-white/50 hover:text-white"
                          onClick={() => void copy('config', clientConfig)}
                          aria-label="Copy client config"
                        >
                          {copied === 'config' ? <Check size={12} /> : <Copy size={12} />} Copy JSON
                        </button>
                      </div>
                      <pre className="rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-[11.5px] leading-relaxed text-white/80 overflow-x-auto cv-scroll-dark">
                        {clientConfig}
                      </pre>
                    </div>
                    <p className="text-[11px] text-white/40">
                      Manage or revoke this token anytime in <span className="text-white/70">Settings → API keys</span>.
                    </p>
                  </div>
                )}
              </div>

              {/* ── operator rail (unchanged) ── */}
              <div className="rounded-lg border border-white/10 p-3">
                <div className="flex items-center gap-2 text-[13px] font-medium">
                  <Server size={14} className="text-[#A78BFA]" /> Server token (self-hosters)
                </div>
                <p className="text-[12px] text-white/50 mt-1">
                  Set{' '}
                  <code className="rounded bg-white/10 px-1 py-0.5 text-[11px]">CANVIX_MCP_TOKEN=&lt;secret&gt;</code> in the server environment and restart. This
                  token is unscoped — the agent can access every design on the instance. Endpoint:
                </p>
                <div className="flex items-center justify-between mt-1.5">
                  <code className="rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-[12px] text-[#02C0CC] break-all flex-1" data-testid="mcp-endpoint">
                    {endpoint}
                  </code>
                  <button
                    className="flex items-center gap-1 text-[11px] text-white/50 hover:text-white ml-2 shrink-0"
                    onClick={() => void copy('url', endpoint)}
                    aria-label="Copy endpoint URL"
                  >
                    {copied === 'url' ? <Check size={12} /> : <Copy size={12} />} Copy
                  </button>
                </div>
              </div>

              <div className="flex items-start gap-2 text-[12px] text-white/50 border-t border-white/10 pt-3">
                <Info size={13} className="mt-0.5 shrink-0" />
                <p>
                  20 tools: generate &amp; create designs, add text/shapes/images/tables/embeds, restyle elements, animate, comment and export
                  (SVG/PNG/JSON). Agent edits show up live in open editor sessions. Bearer-token auth; per-IP rate limits apply. Details in the README →{' '}
                  <span className="text-white/70">AI agents (MCP)</span>.
                </p>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </section>
  )
}
