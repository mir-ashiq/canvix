// ─────────────────────────────────────────────────────────────
// DesignAgent real-model acceptance run (Phase B, 24 Nov 2026).
//
// Drives the autonomous pipeline end-to-end with a REAL planner
// model (z-ai CLI → GLM) at the model seam, exactly as the sandbox
// acceptance harness does for the compiler path:
//
//   phase "run":      prompt → extract-brief → plan (model) →
//                     parse → brief-conformance + compile+check →
//                     [feedback → revise (model)] × ≤3 → report
//                     writes spec/pages/checks/agent-report JSON
//   phase "critique": after scripts/designspec-render.cjs produced
//                     rendered.png, a REAL VLM (z-ai vision) reviews
//                     the render — advisory only, never overriding
//                     the deterministic checks — and the result is
//                     merged into agent-report.json.
//
// Usage:
//   bun scripts/designspec-agent-run.ts run <prompt> <outDir>
//   node scripts/designspec-render.cjs <outDir> "agent-run"
//   bun scripts/designspec-agent-run.ts critique <outDir>
//
// The pipeline itself is src/lib/design-agent/pipeline.ts; the CLI
// model adapter below implements the same DesignAgentModel seam a
// BYOK production adapter would.
// ─────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { runDesignAgent } from '@/lib/design-agent/pipeline'
import { parseCritiqueResponse, type DesignAgentModel } from '@/lib/design-agent/model'
import { PLANNER_SYSTEM, planUserPrompt, revisionUserPrompt, CRITIQUE_SYSTEM, critiqueUserPrompt } from '@/lib/design-agent/prompts'
import { compileSpec } from '@/lib/design-engine/compile'

const TMP = '/tmp/designspec-agent'

/** CLI-backed planner: z-ai chat, OpenAI-shaped output. */
function cliPlan(prompt: string, system: string): string {
  const out = `${TMP}-chat.json`
  execFileSync('z-ai', ['chat', '-p', prompt, '-s', system, '-o', out], { stdio: ['ignore', 'ignore', 'ignore'] })
  const reply = JSON.parse(readFileSync(out, 'utf-8')) as { choices?: { message?: { content?: string } }[] }
  return reply.choices?.[0]?.message?.content ?? ''
}

/** CLI-backed VLM critique: z-ai vision (no --system flag — folded
 * into the prompt). */
function cliVision(prompt: string, image: string): string {
  const out = `${TMP}-vision.json`
  execFileSync('z-ai', ['vision', '-p', prompt, '-i', image, '-o', out], { stdio: ['ignore', 'ignore', 'ignore'] })
  const reply = JSON.parse(readFileSync(out, 'utf-8')) as { choices?: { message?: { content?: string } }[] }
  return reply.choices?.[0]?.message?.content ?? ''
}

const cliModel: DesignAgentModel = {
  plan: async (req) =>
    cliPlan(
      req.feedback ? revisionUserPrompt(req.feedback) : planUserPrompt(req.brief),
      PLANNER_SYSTEM,
    ),
}

const phase = process.argv[2]
const arg = process.argv[3]
const outDirArg = process.argv[4]

if (phase !== 'run' && phase !== 'critique' && phase !== 'recompile') {
  console.error('usage: bun scripts/designspec-agent-run.ts run <promptFile> <outDir> | recompile <outDir> | critique <outDir>')
  process.exit(2)
}

if (phase === 'recompile') {
  // deterministic: recompile a saved spec through the (possibly
  // updated) engine — no model calls, byte-level reproducibility
  const outDir = arg
  const spec = JSON.parse(readFileSync(path.join(outDir, 'spec.json'), 'utf-8'))
  const result = compileSpec(spec)
  writeFileSync(path.join(outDir, 'pages.json'), JSON.stringify(result.pages, null, 2))
  writeFileSync(path.join(outDir, 'checks.json'), JSON.stringify(result.checks, null, 2))
  console.log(`recompiled: checks ${result.checks.passed ? 'PASS' : 'FAIL'} · warnings: ${result.warnings.length}`)
  process.exit(result.checks.passed ? 0 : 1)
}

if (phase === 'run') {
  const prompt = readFileSync(arg, 'utf-8')
  const outDir = outDirArg
  mkdirSync(outDir, { recursive: true })

  const started = Date.now()
  const run = await runDesignAgent({ prompt, model: cliModel })
  const elapsedMs = Date.now() - started

  // artifacts: the same contract the render script consumes
  if (run.report.spec) writeFileSync(path.join(outDir, 'spec.json'), JSON.stringify(run.report.spec, null, 2))
  if (run.pages) writeFileSync(path.join(outDir, 'pages.json'), JSON.stringify(run.pages, null, 2))
  if (run.checks) writeFileSync(path.join(outDir, 'checks.json'), JSON.stringify(run.checks, null, 2))
  writeFileSync(
    path.join(outDir, 'agent-report.json'),
    JSON.stringify({ ...run.report, outcome: run.outcome, warnings: run.warnings, briefConformance: run.briefConformance, elapsedMs }, null, 2),
  )

  console.log(`══ DesignAgent run ══`)
  console.log(`outcome:        ${run.outcome}`)
  console.log(`model calls:    ${run.report.modelCalls} · revisions: ${run.report.revisionRounds} · cycle guard: ${run.report.cycleGuard}`)
  console.log(`elapsed:        ${elapsedMs} ms`)
  for (const s of run.report.stages) {
    console.log(`  ${s.ok ? 'PASS' : 'FAIL'}  ${s.name}${s.modelCall ? ' [model]' : ''}${s.detail ? ` — ${s.detail.slice(0, 110)}` : ''}`)
  }
  if (run.briefConformance.length) console.log(`brief failures:\n  ${run.briefConformance.join('\n  ')}`)
  if (run.warnings.length) console.log(`warnings:\n  ${run.warnings.join('\n  ')}`)
  process.exit(run.outcome === 'passed' ? 0 : 1)
}

if (phase === 'critique') {
  const outDir = arg
  const report = JSON.parse(readFileSync(path.join(outDir, 'agent-report.json'), 'utf-8')) as Record<string, unknown>
  const png = path.join(outDir, 'rendered.png')
  if (!existsSync(png)) {
    console.log('no rendered.png — critique skipped (fail-closed)')
    process.exit(0)
  }
  const brief = report.brief as Parameters<typeof critiqueUserPrompt>[0]
  const raw = cliVision(`${CRITIQUE_SYSTEM}\n\n${critiqueUserPrompt(brief)}`, png)
  const critique = parseCritiqueResponse(raw)
  report.vlmCritique = critique ?? { summary: 'critique reply unparseable — discarded', issues: [], advisory: true, failedClosed: true }
  report.vlmCritiqueRaw = raw
  writeFileSync(path.join(outDir, 'agent-report.json'), JSON.stringify(report, null, 2))
  console.log(`══ VLM critique (advisory) ══`)
  console.log(`summary: ${(critique?.summary ?? '(unparseable — fail-closed)').slice(0, 300)}`)
  for (const i of critique?.issues ?? []) console.log(`  ${i.severity}  ${i.issue.slice(0, 120)}${i.fix ? ` → ${i.fix.slice(0, 80)}` : ''}`)
}
