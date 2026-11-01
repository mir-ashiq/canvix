'use client'

import { Component, type ErrorInfo, type ReactNode, useSyncExternalStore } from 'react'
import { useAppStore } from '@/store/app-store'
import { useEditorStore } from '@/store/editor-store'

// ─────────────────────────────────────────────────────────────
// Error boundaries (v0.12.2, roadmap H4 — research/V0118-ROADMAP-
// RESEARCH.md §3.9 debt #4). Until now a single render-time throw
// anywhere in the editor tree unmounted React root-down: a white
// screen with no recovery and no diagnostics. These boundaries
// catch render/lifecycle errors per surface and offer the three
// recoveries that actually help:
//
//   Reload editor     — fresh mount, browser state (URL, design id)
//                        preserved
//   Back to dashboard — switches the app-store view and remounts
//                        the crashed surface from scratch
//   Copy diagnostics  — design id, last-saved seq, save state,
//                        page/element counts, the error itself;
//                        paste-ready for a bug report
//
// A boundary only helps for errors DURING render/lifecycle of its
// children — event-handler and async errors were already handled
// by the validated-collab / db-error paths. That split is honest
// and documented in the README.
// ─────────────────────────────────────────────────────────────

export interface CrashDiagnostics {
  surface: string
  at: string
  url: string
  designId: string | null
  designName: string | null
  savedAt: number | null
  saving: boolean
  dirty: boolean
  lastSavedSeq: number | null
  pages: number | null
  elements: number | null
  userAgent: string
  error: string
  stackHead: string
}

/** Read editor state at crash time — never during render, never throwing. */
function collectDiagnostics(surface: string, error: unknown): CrashDiagnostics {
  const err = error instanceof Error ? error : new Error(String(error))
  // getState() is side-effect free; wrapped so a store-level failure can
  // never break the boundary itself.
  let editor: {
    designId: string | null
    designName: string
    savedAt: number | null
    saving: boolean
    dirty: boolean
    pages?: unknown[]
  } | null = null
  try {
    editor = useEditorStore.getState()
  } catch {
    /* store unavailable — the dashboard boundary, usually */
  }
  let lastSavedSeq: number | null = null
  try {
    const designId = editor?.designId
    if (designId && typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(`canvix-seq-${designId}`)
      const n = raw === null ? NaN : Number(raw)
      if (Number.isFinite(n)) lastSavedSeq = n
    }
  } catch {
    /* storage unavailable */
  }
  const pages = Array.isArray(editor?.pages) ? editor!.pages!.length : null
  return {
    surface,
    at: new Date().toISOString(),
    url: typeof location !== 'undefined' ? location.href : '',
    designId: editor?.designId ?? null,
    designName: editor?.designName ?? null,
    savedAt: editor?.savedAt ?? null,
    saving: editor?.saving ?? false,
    dirty: editor?.dirty ?? false,
    lastSavedSeq,
    pages,
    elements:
      pages !== null
        ? (editor!.pages as { elements?: unknown[] }[]).reduce(
            (n, p) => n + (Array.isArray(p?.elements) ? p.elements.length : 0),
            0,
          )
        : null,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    error: `${err.name}: ${err.message}`,
    stackHead: (err.stack ?? '').split('\n').slice(0, 6).join('\n'),
  }
}

interface ErrorBoundaryProps {
  /** which surface is guarded — shown in the recovery UI */
  label: string
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
  diagnostics: CrashDiagnostics | null
  copied: boolean
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, diagnostics: null, copied: false }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error, copied: false }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // visible in dev/console + captured for the copy button
    const diagnostics = collectDiagnostics(this.props.label, error)
    this.setState({ diagnostics })
    console.error(`[canvix] ${this.props.label} crashed`, error, info.componentStack)
    // one-shot: if this was the dev crash probe, rearm it so a
    // recovered boundary remounts clean instead of re-throwing
    clearDevCrashProbe()
  }

  private reload = () => {
    location.reload()
  }

  private backToDashboard = () => {
    // remount the guarded surface from a clean slate
    this.setState({ error: null, diagnostics: null, copied: false })
    useAppStore.getState().goDashboard()
  }

  private copyDiagnostics = async () => {
    if (!this.state.diagnostics) return
    const text = JSON.stringify(this.state.diagnostics, null, 2)
    try {
      await navigator.clipboard.writeText(text)
      this.setState({ copied: true })
    } catch {
      // clipboard unavailable (permissions) — fall back to console
      console.info('[canvix] crash diagnostics (copy from console):', text)
      this.setState({ copied: true })
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          aria-label={`${this.props.label} crashed`}
          className="flex h-screen w-full items-center justify-center bg-[#0D0F14] p-6"
        >
          <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#181B23] p-6 text-white shadow-2xl">
            <div className="mb-1 flex items-center gap-2">
              <span aria-hidden className="text-xl">
                ⚠️
              </span>
              <h2 className="text-lg font-semibold">Something went wrong</h2>
            </div>
            <p className="mb-4 text-sm text-white/60">
              The {this.props.label} hit an unexpected error and was stopped
              safely. Your design is saved on the server up to the last
              autosave.
            </p>
            <div className="mb-4 rounded-lg bg-black/40 p-3 font-mono text-xs text-red-300">
              {this.state.error.message || 'Unknown error'}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={this.reload}
                className="rounded-lg bg-[#00C4CC] px-4 py-2 text-sm font-semibold text-black hover:bg-[#00b3ba]"
              >
                Reload editor
              </button>
              <button
                onClick={this.backToDashboard}
                className="rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20"
              >
                Back to dashboard
              </button>
              <button
                onClick={this.copyDiagnostics}
                className="rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20"
              >
                {this.state.copied ? 'Diagnostics copied ✓' : 'Copy diagnostics'}
              </button>
            </div>
            {this.state.diagnostics?.designId ? (
              <p className="mt-4 text-xs text-white/40">
                design {this.state.diagnostics.designId} · last saved seq{' '}
                {this.state.diagnostics.lastSavedSeq ?? 'unknown'}
              </p>
            ) : null}
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// ─────────────────────────────────────────────────────────────
// Dev-only crash probe — the e2e suite's way of proving a forced
// crash in a child renders the boundary instead of a white screen
// (the H4 acceptance criterion). It throws DURING RENDER, which is
// the only class of error a boundary can catch, so no event-hook
// tricks. Compiled out of production builds: NODE_ENV is inlined,
// making the throw branch dead code that minifiers drop.
// ─────────────────────────────────────────────────────────────

const probeListeners = new Set<() => void>()
let probeRequested = false

/** Flip the probe; exposed as window.__canvixRequestDevCrash in dev. */
function requestDevCrash(): void {
  probeRequested = true
  probeListeners.forEach((l) => l())
}

/** Rearm the probe once its crash has been delivered to a boundary. */
function clearDevCrashProbe(): void {
  if (!probeRequested) return
  probeRequested = false
  probeListeners.forEach((l) => l())
}

function InnerDevCrashProbe(): null {
  const requested = useSyncExternalStore(
    (cb) => {
      probeListeners.add(cb)
      return () => probeListeners.delete(cb)
    },
    () => probeRequested,
    () => false,
  )
  if (process.env.NODE_ENV !== 'production' && requested) {
    throw new Error(
      'Canvix dev crash probe — intentional (e2e: proves the error boundary renders)',
    )
  }
  return null
}

/**
 * The crash probe as an explicit child — mount it inside exactly ONE
 * boundary per test target (AppShell mounts it inside the editor
 * boundary). Rendering it from every boundary would make every probe
 * throw in the same render pass, and the outermost boundary's fallback
 * would replace the inner one's — the wrong surface would “catch”.
 */
export function DevCrashProbe() {
  return <InnerDevCrashProbe />
}

declare global {
  interface Window {
    __canvixRequestDevCrash?: typeof requestDevCrash
  }
}

// mounted once per boundary; dev only (the probe itself no-ops in prod)
export function DevCrashHook(): null {
  if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
    window.__canvixRequestDevCrash = requestDevCrash
  }
  return null
}
