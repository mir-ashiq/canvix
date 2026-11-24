// ─────────────────────────────────────────────────────────────
// DesignAgent real-model acceptance run (Phase B v2, 24 Nov 2026).
//
// Drives the autonomous pipeline end-to-end with REAL seams:
//   · planner:  z-ai chat (GLM)          — the plan/revise seam
//   · renderer: Chromium + the app's REAL vector export pipeline
//               (exportPageToSVG) — the DesignRenderer seam
//   · critic:   z-ai vision (VLM)        — the critique seam
//
// With --visual (default) the pipeline runs its FULL loop including
// the in-run visual verification stage: render → critique →
// (guarded) revision → re-compile → re-render → verify. Everything
// is recorded in agent-report.json.
//
// Usage:
//   bun scripts/designspec-agent-run.ts run <promptFile> <outDir> [--visual|--no-visual]
//   bun scripts/designspec-agent-run.ts recompile <outDir>
//   bun scripts/designspec-agent-run.ts critique <outDir>
//
// Build the browser bundle first if missing:
//   bun build scripts/designspec-browser-entry.ts --outfile scripts/designspec-browser-bundle.js --target browser
// ─────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { runDesignAgent, type DesignRenderer } from '@/lib/design-agent/pipeline'
import { parseCritiqueResponse, type DesignAgentModel, type CritiqueRequest } from '@/lib/design-agent/model'
import { PLANNER_SYSTEM, planUserPrompt, revisionUserPrompt, CRITIQUE_SYSTEM, critiqueUserPrompt } from '@/lib/design-agent/prompts'
import { compileSpec } from '@/lib/design-engine/compile'
import type { PageData } from '@/lib/types'
import type { DesignSpec } from '@/lib/design-spec/types'

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
  critique: async (req: CritiqueRequest) =>
    cliVision(`${CRITIQUE_SYSTEM}\n\n${critiqueUserPrompt(req.brief)}`, req.image),
}

/** Browser-backed renderer: the app's REAL export pipeline
 * (exportPageToSVG) inside real Chromium, screenshotted to a PNG the
 * VLM can read. One browser for the whole run; each render call
 * re-embeds the current pages (the loop re-renders after revisions). */
async function makeRenderer(outDir: string): Promise<{ renderer: DesignRenderer; close: () => Promise<void> }> {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1400, height: 1800 } })
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8">
    <style>body{margin:0;background:#fff;padding:0}
    #host svg{display:block;background:#fff}</style></head>
    <body><div id="host"></div></body></html>`)
  await page.addScriptTag({ path: path.resolve(process.cwd(), 'scripts/designspec-browser-bundle.js') })
  let shot = 0
  const renderer: DesignRenderer = {
    render: async (pages: PageData[], spec: DesignSpec) => {
      try {
        shot += 1
        await page.evaluate(
          ({ pageData, width, height }) => {
            const svg = (window as unknown as { __canvixExportPageToSVG: (p: unknown, w: number, h: number) => string })
              .__canvixExportPageToSVG(pageData, width, height)
            document.getElementById('host')!.innerHTML = svg
          },
          { pageData: pages[0], width: spec.format.width, height: spec.format.height },
        )
        const host = await page.$('#host svg')
        if (!host) return null
        const png = path.join(outDir, shot === 1 ? 'rendered.png' : `rendered-r${shot}.png`)
        await host.screenshot({ path: png })
        // also keep the final SVG for the artifacts
        writeFileSync(path.join(outDir, 'rendered.svg'), await page.evaluate(() => document.getElementById('host')!.innerHTML))
        return { image: png }
      } catch {
        return null
      }
    },
  }
  return { renderer, close: () => browser.close() }
}

const phase = process.argv[2]
const arg = process.argv[3]
const outDirArg = process.argv[4]
const visualFlag = process.argv.includes('--visual')
const noVisualFlag = process.argv.includes('--no-visual')

if (phase !== 'run' && phase !== 'critique' && phase !== 'recompile') {
  console.error('usage: bun scripts/designspec-agent-run.ts run <promptFile> <outDir> [--visual|--no-visual] | recompile <outDir> | critique <outDir>')
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
  const wantVisual = !noVisualFlag && existsSync(path.resolve(process.cwd(), 'scripts/designspec-browser-bundle.js'))

  const started = Date.now()
  const visual = wantVisual ? await makeRenderer(outDir) : undefined
  const run = await runDesignAgent({
    prompt,
    model: cliModel,
    renderer: visual?.renderer,
    limits: { maxRevisions: 3, maxVisualPasses: 1 },
  })
  const elapsedMs = Date.now() - started
  if (visual) await visual.close()

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
  console.log(`visual:         ${run.report.visualVerification} (${run.report.visualPasses.map((p) => p.action).join(', ') || 'no passes'})`)
  console.log(`elapsed:        ${elapsedMs} ms`)
  for (const s of run.report.stages) {
    console.log(`  ${s.ok ? 'PASS' : 'FAIL'}  ${s.name}${s.modelCall ? ' [model]' : ''}${s.detail ? ` — ${s.detail.slice(0, 110)}` : ''}`)
  }
  if (run.briefConformance.length) console.log(`brief failures:\n  ${run.briefConformance.join('\n  ')}`)
  if (run.warnings.length) console.log(`warnings:\n  ${run.warnings.join('\n  ')}`)
  for (const p of run.report.visualPasses) {
    if (p.issues.length) {
      console.log(`critique pass ${p.round} — ${p.action}:`)
      for (const i of p.issues) console.log(`  ${i.severity}  ${i.issue.slice(0, 110)}`)
    }
  }
  process.exit(run.outcome === 'passed' ? 0 : 1)
}

if (phase === 'critique') {
  // standalone post-hoc critique of an existing rendered.png,
  // merged into agent-report.json (for renders produced by
  // designspec-render.cjs rather than the in-run renderer)
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
  console.log(`══ VLM critique (advisory, standalone) ══`)
  console.log(`summary: ${(critique?.summary ?? '(unparseable — fail-closed)').slice(0, 300)}`)
  for (const i of critique?.issues ?? []) console.log(`  ${i.severity}  ${i.issue.slice(0, 120)}${i.fix ? ` → ${i.fix.slice(0, 80)}` : ''}`)
}
