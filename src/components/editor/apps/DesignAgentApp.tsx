'use client'

// ─────────────────────────────────────────────────────────────
// DesignAgentApp (v0.31) — the autonomous generation panel.
//
// The P1 gap from docs/DESIGN-AGENT-ACCEPTANCE-REPORT.md: the
// pipeline shipped as a server contract (POST /api/ai/design-agent)
// without a user-facing surface. This panel is that surface, and it
// follows the house rule every generative surface obeys: NOTHING
// lands on the canvas unreviewed.
//
//   prompt → [autonomous run, live status + stop]
//          → REVIEW GATE: brief contract, per-page toggles,
//            conformance failures, the full run report
//          → Apply: deterministic canvas fit + appendPages
//            (one Ctrl+Z removes everything)
//          → optional post-apply critique on the REAL rendered
//            pixels (captureStage → vision slot — the browser
//            capture path, richer than the server's SVG review)
//
// Honesty rules mirrored from the pipeline: a failed run shows its
// evidence (best-attempt pages + unmet requirements) instead of a
// shrug; visual verification says 'unavailable' when no vision
// model answers; abort keeps nothing applied.
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react'
import {
  Workflow, Loader2, Sparkles, Check, Square, Gauge, ListChecks, Eye, EyeOff,
  ShieldCheck, ShieldAlert, RefreshCw, X,
} from 'lucide-react'
import { useEditorStore } from '@/store/editor-store'
import { AppHeader, type AppPanelProps } from './registry'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { useAICapabilities } from '@/hooks/use-ai-capabilities'
import { requestDesignAgent, critiqueAppliedCanvas, type DesignAgentRunResult } from '@/lib/design-agent/client'
import { fitPagesToCanvas } from '@/lib/design-agent/fit-pages'
import type { PageData, AnyElement } from '@/lib/types'
import type { AgentOutcome } from '@/lib/design-agent/pipeline'

const IDEAS = [
  'A launch poster for a night market — "Friday 6 PM", neon purples, 1080×1350',
  'An Instagram post for a bakery opening — warm cream and chocolate browns, exact text "Opening 12 March"',
  'A conference poster: "AI & Design 2026", 3–5 March, blue #1B4F9C accents',
]

/** the pipeline's fixed stage order — shown while it runs so the wait
 *  is legible; the authoritative record is the run report at the end */
const EXPECTED_STAGES = [
  'extract brief',
  'plan',
  'compile + checks',
  'brief conformance',
  'self-correction',
  'render',
  'visual critique',
  'final verdict',
]

const OUTCOME_META: Record<AgentOutcome, { label: string; tone: string }> = {
  passed: { label: 'Passed — every deterministic check is green', tone: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' },
  'failed-honestly': { label: 'Stopped honestly — the agent would not fake a pass', tone: 'border-amber-400/30 bg-amber-400/10 text-amber-200' },
  'guard-cycled': { label: 'Stopped by the cycle guard — the plan repeated itself', tone: 'border-amber-400/30 bg-amber-400/10 text-amber-200' },
  aborted: { label: 'Stopped — nothing was applied', tone: 'border-white/15 bg-white/5 text-white/70' },
}

const VISUAL_META: Record<string, string> = {
  verified: 'verified',
  improved: 'improved after critique',
  unverified: 'ran without vision critique',
  unavailable: 'unavailable (no vision model)',
  aborted: 'aborted',
}

const PASS_ACTION_META: Record<string, string> = {
  revised: 'revision accepted',
  'accepted-as-is': 'accepted as-is',
  'rejected-by-checks': 'rejected — checks outrank critique',
  'no-improvement': 'kept previous (no improvement)',
  'budget-exhausted': 'budget exhausted',
  'unparseable-discarded': 'discarded unparseable critique',
  unavailable: 'unavailable',
}

export function DesignAgentApp({ onClose }: AppPanelProps) {
  const [prompt, setPrompt] = useState('')
  const [revisions, setRevisions] = useState(3)
  /** null = follow the vision capability; the user can always opt out */
  const [visualOverride, setVisualOverride] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [result, setResult] = useState<DesignAgentRunResult | null>(null)
  const [enabled, setEnabled] = useState<boolean[]>([])
  const [applied, setApplied] = useState(false)
  const [critique, setCritique] = useState<{ findings: { severity: string; issue: string; fix?: string }[]; note: string } | null>(null)
  const [critiquing, setCritiquing] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const width = useEditorStore((s) => s.width)
  const height = useEditorStore((s) => s.height)
  const { configured: aiConfigured, loaded: aiLoaded, vision, designAgent } = useAICapabilities()

  const visualCheck = visualOverride ?? vision
  const runAvailable = aiLoaded && aiConfigured && designAgent

  // elapsed timer while the pipeline runs (reset at run start; the
  // effect itself only ticks — no synchronous setState in effects)
  useEffect(() => {
    if (!busy) return
    const started = Date.now()
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(t)
  }, [busy])

  const generate = async () => {
    const text = prompt.trim()
    if (!text || busy) return
    const controller = new AbortController()
    abortRef.current = controller
    setElapsed(0)
    setBusy(true)
    setResult(null)
    setEnabled([])
    setApplied(false)
    setCritique(null)
    try {
      const res = await requestDesignAgent(
        text,
        { visual: visualCheck, maxRevisions: revisions },
        controller.signal,
      )
      setResult(res)
      setEnabled(res.pages.map(() => true))
      if (!res.pages.length && res.error) {
        toast({ title: 'The design agent stopped', description: res.error })
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        setResult({ outcome: 'aborted', pages: [], briefConformance: [], warnings: [], report: null, format: null })
      } else {
        toast({ title: 'The design agent failed', description: e instanceof Error ? e.message : 'Unknown error' })
      }
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  const stop = () => abortRef.current?.abort()

  const apply = () => {
    if (!result || applied) return
    const chosen = result.pages.filter((_, i) => enabled[i])
    if (!chosen.length) {
      toast({ title: 'Nothing to apply', description: 'Enable at least one page first.' })
      return
    }
    const from = result.format ?? { width, height }
    const fit = fitPagesToCanvas(chosen, from, { width, height })
    const store = useEditorStore.getState()
    store.appendPages(fit.pages)
    setApplied(true)
    // v0.32 (Unified Canvix AI — continuation): the applied pages carry
    // their contract. The store brief makes every later chat-agent run
    // on THIS design merge it (create→verify→refine on one design);
    // the provenance PUT persists it across sessions/reloads. Both are
    // best-effort AFTER the pages landed — a persistence hiccup never
    // rolls the apply back, and the session brief still guards.
    const brief = result.report?.brief ?? null
    if (brief) store.setAIBrief(brief)
    if (brief && store.designId && !store.readOnly) {
      void fetch(`/api/designs/${store.designId}/ai-provenance`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, brief, outcome: result.outcome }),
      }).catch(() => {
        /* session brief still guards; reload loses the stored contract */
        console.warn('[design-agent] provenance save failed')
      })
    }
    toast({
      title: `${chosen.length} page${chosen.length > 1 ? 's' : ''} added`,
      description:
        (fit.scale !== 1
          ? `Rescaled from ${from.width}×${from.height} to fit the ${width}×${height} canvas — fully editable. `
          : 'Fully editable elements. ') +
        (brief ? 'The brief now guards chat-agent refinements of this design. ' : '') +
        'Ctrl+Z removes them all.',
    })
  }

  /** post-apply critique: capture the REAL rendered canvas (the newly
   *  appended page is current) and ask the vision slot against the brief */
  const runCritique = async () => {
    if (!result || critiquing) return
    setCritiquing(true)
    try {
      const { captureStage } = await import('@/components/editor/canvas/canvas-bridge')
      const image = await captureStage({ pixelScale: 0.5, mimeType: 'image/jpeg', quality: 0.7 })
      const brief = result.report?.brief
        ? {
            requiredTexts: result.report.brief.requiredTexts.map((t) => ({ text: t.text })),
            requiredColors: result.report.brief.requiredColors.map((c) => ({ hex: c.hex })),
          }
        : { requiredTexts: [], requiredColors: [] }
      setCritique(await critiqueAppliedCanvas(image, brief))
    } catch {
      setCritique({ findings: [], note: 'Could not capture the canvas — critique skipped.' })
    } finally {
      setCritiquing(false)
    }
  }

  const brief = result?.report?.brief
  const specFormat = result?.format
  const rescale = specFormat && (specFormat.width !== width || specFormat.height !== height)
  const enabledCount = enabled.filter(Boolean).length
  const meta = result ? OUTCOME_META[result.outcome] : null

  return (
    <div data-testid="design-agent-panel">
      <AppHeader icon={Workflow} title="Design agent" onClose={onClose} />

      {aiLoaded && !aiConfigured && (
        <div data-testid="design-agent-no-provider" className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[11.5px] text-amber-200">
          No AI provider configured yet — add a key in Admin → AI &amp; models (or your profile) to use the design agent.
        </div>
      )}
      {aiLoaded && aiConfigured && !designAgent && (
        <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[11.5px] text-amber-200">
          The design agent is switched off in the admin console (AI &amp; models → features).
        </div>
      )}

      <p className="text-[11.5px] text-white/50 leading-snug mb-3">
        One prompt in — the agent plans, compiles, checks and visually reviews a real design. Nothing lands
        until you review it; a failed run shows its evidence, never a fake pass.
      </p>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="e.g. A 1080×1350 poster for a marathon — “Run Dal Lake 2026”, 26 Jan, navy #1B3A6B + coral accents, stats band, framed photo area"
        className="w-full h-24 rounded-xl bg-white/[0.05] border border-white/10 text-white text-[12.5px] p-3 resize-none focus:outline-none focus:border-[#02C0CC]"
        maxLength={2000}
        aria-label="Design brief"
        data-testid="design-agent-prompt"
      />

      {/* options row */}
      <div className="flex items-center gap-2 mt-2.5 flex-wrap">
        <button
          onClick={() => setVisualOverride(!visualCheck)}
          disabled={!vision}
          title={vision ? 'Render the pages and critique the real pixels before you review' : 'No vision model configured'}
          className={cn(
            'flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[11px] font-semibold transition-colors',
            visualCheck ? 'bg-[#02C0CC]/15 text-[#02C0CC]' : 'bg-white/5 text-white/45',
            !vision && 'opacity-50 cursor-not-allowed',
          )}
          aria-pressed={visualCheck}
        >
          {visualCheck ? <Eye size={12} /> : <EyeOff size={12} />}
          Visual check
        </button>
        <div className="flex items-center gap-1" role="group" aria-label="Revision rounds">
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              onClick={() => setRevisions(n)}
              className={cn(
                'w-7 h-7 rounded-lg text-[11px] font-bold transition-colors',
                revisions === n ? 'bg-[#7630D7] text-white' : 'bg-white/[0.05] text-white/55 hover:bg-white/10',
              )}
              aria-pressed={revisions === n}
              title={`${n} self-correction round${n > 1 ? 's' : ''}`}
            >
              {n}
            </button>
          ))}
        </div>
        <button
          className="btn-cv h-9 px-4 ml-auto text-[12px] flex items-center gap-1.5 disabled:opacity-60"
          onClick={() => void generate()}
          disabled={busy || !prompt.trim() || (aiLoaded && (!aiConfigured || !designAgent))}
          data-testid="design-agent-run"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {busy ? 'Running…' : 'Generate'}
        </button>
      </div>

      {!result && !busy && (
        <div className="mt-3 space-y-1.5">
          {IDEAS.map((idea) => (
            <button
              key={idea}
              onClick={() => setPrompt(idea)}
              className="block w-full text-left text-[11px] text-white/45 hover:text-white/80 px-2.5 py-2 rounded-lg hover:bg-white/[0.04] transition-colors"
            >
              &ldquo;{idea}&rdquo;
            </button>
          ))}
        </div>
      )}

      {/* the live run */}
      {busy && (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-3" data-testid="design-agent-running">
          <div className="flex items-center gap-2 text-[11.5px] text-white/60 mb-2">
            <Loader2 size={12} className="animate-spin text-[#02C0CC]" />
            The autonomous pipeline is running
            <span className="text-white/35">{elapsed}s</span>
            <button onClick={stop} className="ml-auto flex items-center gap-1 px-2 h-6 rounded-full bg-red-500/15 text-red-300 text-[10.5px] font-semibold hover:bg-red-500/25 transition-colors">
              <Square size={9} /> Stop
            </button>
          </div>
          <ol className="space-y-0.5">
            {EXPECTED_STAGES.map((s, i) => (
              <li key={s} className={cn('text-[11px] flex items-center gap-1.5', i === 0 ? 'text-white/70' : 'text-white/35')}>
                <span className={cn('w-1 h-1 rounded-full', i === 0 ? 'bg-[#02C0CC]' : 'bg-white/20')} />
                {s}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[10px] text-white/30 leading-snug">
            Stage order is fixed; the authoritative record arrives with the run report.
          </p>
        </div>
      )}

      {/* the review gate */}
      {result && !busy && (
        <div className="mt-4 space-y-3" data-testid="design-agent-result">
          {meta && (
            <div className={cn('rounded-xl border px-3 py-2 text-[12px] font-semibold flex items-center gap-1.5', meta.tone)} data-testid="design-agent-outcome">
              {result.outcome === 'passed' ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />}
              {meta.label}
            </div>
          )}

          {result.error && (
            <p className="rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2 text-[11.5px] text-red-200">
              {result.error}
            </p>
          )}

          {/* brief contract */}
          {brief && (brief.requiredTexts.length > 0 || brief.requiredColors.length > 0) && (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-white/50 mb-1.5">Brief contract (checked verbatim)</p>
              <div className="flex flex-wrap gap-1.5">
                {brief.requiredTexts.map((t, i) => (
                  <span key={i} className="px-1.5 py-0.5 rounded bg-white/8 text-[10.5px] text-white/80 font-medium">
                    &ldquo;{t.text}&rdquo;
                  </span>
                ))}
                {brief.requiredColors.map((c, i) => (
                  <span key={i} className="px-1.5 py-0.5 rounded bg-white/8 text-[10.5px] text-white/80 font-mono flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-sm inline-block border border-white/20" style={{ background: c.hex }} />
                    {c.hex.toUpperCase()}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* conformance failures — the honest-failure evidence */}
          {result.briefConformance.length > 0 && (
            <div className="rounded-xl border border-amber-400/25 bg-amber-400/8 px-3 py-2" data-testid="design-agent-conformance">
              <p className="text-[10px] font-bold uppercase tracking-wide text-amber-300/80 mb-1">Unmet requirements</p>
              <ul className="space-y-0.5">
                {result.briefConformance.map((f, i) => (
                  <li key={i} className="text-[11px] text-amber-100/80 leading-snug">· {f}</li>
                ))}
              </ul>
            </div>
          )}
          {result.warnings.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-white/45 mb-1">Warnings</p>
              <ul className="space-y-0.5">
                {result.warnings.map((w, i) => (
                  <li key={i} className="text-[11px] text-white/55 leading-snug">· {w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* pages review */}
          {result.pages.length > 0 && (
            <div className="space-y-2">
              {result.pages.map((page, i) => (
                <PageReviewCard
                  key={i}
                  index={i}
                  page={page}
                  specWidth={specFormat?.width ?? width}
                  specHeight={specFormat?.height ?? height}
                  enabled={enabled[i] ?? true}
                  onToggle={() => setEnabled((e) => e.map((v, j) => (j === i ? !v : v)))}
                />
              ))}
            </div>
          )}

          {/* apply row */}
          {result.pages.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              {!applied ? (
                <>
                  <button className="btn-cv h-8 px-3.5 text-[11.5px] flex items-center gap-1.5" onClick={apply} data-testid="design-agent-apply">
                    <Check size={12} /> Apply {enabledCount > 0 ? `${enabledCount} page${enabledCount > 1 ? 's' : ''}` : ''}
                  </button>
                  {rescale && (
                    <span className="text-[10.5px] text-white/40">
                      pages were compiled {specFormat!.width}×{specFormat!.height} — they will be rescaled to fit this {width}×{height} design
                    </span>
                  )}
                  <button
                    className="flex items-center gap-1 text-[11px] text-white/50 hover:text-white px-2 h-8 rounded-lg hover:bg-white/10"
                    onClick={() => void generate()}
                  >
                    <RefreshCw size={11} /> Try again
                  </button>
                  <button
                    className="flex items-center gap-1 text-[11px] text-white/50 hover:text-white px-2 h-8 rounded-lg hover:bg-white/10"
                    onClick={() => { setResult(null); setPrompt('') }}
                  >
                    <X size={11} /> Discard
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="h-8 px-3.5 rounded-lg bg-white/10 text-white/85 text-[11.5px] font-semibold hover:bg-white/15 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                    onClick={() => void runCritique()}
                    disabled={critiquing}
                    data-testid="design-agent-critique"
                  >
                    {critiquing ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />}
                    {critiquing ? 'Critiquing…' : 'Critique the result'}
                  </button>
                  <button className="btn-cv h-8 px-3.5 text-[11.5px]" onClick={onClose}>
                    Done
                  </button>
                </>
              )}
            </div>
          )}

          {/* post-apply critique on the real pixels */}
          {critique && (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2" data-testid="design-agent-critique-result">
              <p className="text-[10px] font-bold uppercase tracking-wide text-white/50 mb-1.5">Visual critique (real pixels)</p>
              {critique.findings.length === 0 ? (
                <p className="text-[11px] text-white/55 leading-snug">{critique.note}</p>
              ) : (
                <>
                  <ul className="space-y-1 mb-1.5">
                    {critique.findings.slice(0, 8).map((f, i) => (
                      <li key={i} className="text-[11px] leading-snug">
                        <span
                          className={cn(
                            'inline-block px-1.5 rounded text-[10px] font-bold mr-1.5',
                            f.severity === 'P1' && 'bg-amber-500/20 text-amber-300',
                            f.severity === 'P2' && 'bg-blue-500/20 text-blue-300',
                            f.severity === 'P3' && 'bg-white/10 text-white/50',
                          )}
                        >
                          {f.severity}
                        </span>
                        <span className="text-white/80">{f.issue}</span>
                        {f.fix && <span className="text-white/45"> → {f.fix}</span>}
                      </li>
                    ))}
                  </ul>
                  <p className="text-[10px] text-white/35">{critique.note}</p>
                </>
              )}
            </div>
          )}

          {/* the run report */}
          {result.report && (
            <details className="rounded-xl border border-white/8 bg-white/[0.02] overflow-hidden" data-testid="design-agent-report">
              <summary className="px-3 py-2 text-[11px] font-semibold text-white/60 cursor-pointer flex items-center gap-1.5">
                <ListChecks size={12} /> Run report
                {result.report.modelCalls > 0 && (
                  <span className="text-white/35">
                    · {result.report.modelCalls} model calls · {result.report.revisionRounds} revision rounds
                  </span>
                )}
              </summary>
              <div className="px-3 pb-2.5 space-y-2">
                <div className="space-y-1">
                  {result.report.stages.map((s, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-[10.5px] leading-snug">
                      <span className={s.ok ? 'text-emerald-400' : 'text-red-400'}>{s.ok ? '✓' : '✗'}</span>
                      <span className="text-white/75 font-mono shrink-0">{s.name}</span>
                      {s.modelCall && <span className="text-[#02C0CC]/70 text-[9.5px] mt-px">model</span>}
                      <span className="text-white/45 min-w-0">{s.detail}</span>
                    </div>
                  ))}
                </div>
                {result.report.visualPasses.length > 0 && (
                  <div className="border-t border-white/8 pt-2 space-y-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-white/40">
                      Visual verification — {VISUAL_META[result.report.visualVerification] ?? result.report.visualVerification}
                    </p>
                    {result.report.visualPasses.map((p, i) => (
                      <div key={i} className="rounded-lg border border-white/8 px-2.5 py-1.5">
                        <div className="flex items-center gap-1.5 text-[10.5px] text-white/60">
                          <span className="font-mono">pass {p.round}</span>
                          <span className="px-1.5 rounded bg-[#02C0CC]/10 text-[#02C0CC] text-[9.5px] font-semibold">
                            {PASS_ACTION_META[p.action] ?? p.action}
                          </span>
                        </div>
                        {p.summary && <p className="text-[10.5px] text-white/45 mt-0.5 leading-snug">{p.summary}</p>}
                        {p.issues.slice(0, 5).map((issue, j) => (
                          <p key={j} className="text-[10.5px] text-white/55 leading-snug mt-0.5">
                            <span className="font-bold mr-1">{issue.severity}</span>
                            {issue.issue}
                          </p>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2 text-[10px] text-white/35 border-t border-white/8 pt-2">
                  <Gauge size={10} />
                  <span>
                    {result.report.modelCalls} model calls · {result.report.revisionRounds} revision rounds
                    {result.report.cycleGuard ? ' · cycle guard tripped' : ''}
                    {result.report.spec?.format
                      ? ` · compiled ${result.report.spec.format.width}×${result.report.spec.format.height}`
                      : ''}
                  </span>
                </div>
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

/** One reviewable compiled page: honest geometry wireframe + toggle. */
function PageReviewCard({
  index,
  page,
  specWidth,
  specHeight,
  enabled,
  onToggle,
}: {
  index: number
  page: PageData
  specWidth: number
  specHeight: number
  enabled: boolean
  onToggle: () => void
}) {
  const previewW = 96
  const previewH = Math.max(48, Math.round((previewW * specHeight) / Math.max(1, specWidth)))
  const bg =
    page.background?.type === 'gradient'
      ? `linear-gradient(${page.background.angle}deg, ${page.background.from}, ${page.background.to})`
      : page.background?.type === 'solid'
        ? page.background.color
        : '#FFFFFF'

  return (
    <div
      className={cn(
        'rounded-xl border p-2.5 flex gap-2.5 items-center transition-colors',
        enabled ? 'border-white/12 bg-white/[0.04]' : 'border-white/8 bg-white/[0.015] opacity-60',
      )}
    >
      <button
        onClick={onToggle}
        className={cn(
          'w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors',
          enabled ? 'bg-[#02C0CC] border-[#02C0CC] text-black' : 'border-white/25 text-transparent',
        )}
        aria-label={enabled ? `Disable page ${index + 1}` : `Enable page ${index + 1}`}
        aria-pressed={enabled}
      >
        <Check size={12} strokeWidth={3.5} />
      </button>
      <div
        className="relative shrink-0 rounded-lg overflow-hidden border border-white/10"
        style={{ width: previewW, height: previewH, background: bg }}
        aria-hidden
      >
        {page.elements.map((el: AnyElement) => (
          <div
            key={el.id}
            className="absolute rounded-[2px]"
            style={{
              left: `${(el.x / specWidth) * 100}%`,
              top: `${(el.y / specHeight) * 100}%`,
              width: `${(el.width / specWidth) * 100}%`,
              height: `${(el.height / specHeight) * 100}%`,
              background: el.type === 'text' ? 'rgba(255,255,255,0.75)' : (('fill' in el ? String((el as { fill?: unknown }).fill ?? '') : '') || '#02C0CC'),
              opacity: el.type === 'text' ? 0.85 : 0.8,
              minHeight: 2,
            }}
          />
        ))}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11.5px] font-semibold text-white/85">
          Page {index + 1}
          <span className="ml-1.5 text-[10px] text-white/35 font-normal">
            {specWidth}×{specHeight} · {page.elements.length} element{page.elements.length === 1 ? '' : 's'}
          </span>
        </p>
      </div>
    </div>
  )
}
