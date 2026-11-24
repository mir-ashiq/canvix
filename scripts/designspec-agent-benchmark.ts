// ─────────────────────────────────────────────────────────────
// DesignAgent benchmark (Phase B P1, 24 Nov 2026).
//
// 22 diverse briefs × the REAL pipeline (GLM planner via z-ai chat;
// plan + brief-conformance + compile + bounded self-correction —
// the visual stage is opt-in per run, not benchmarked here).
//
// Measured, per brief and aggregate:
//   · outcome (passed / failed-honestly / guard-cycled)
//   · instruction fidelity — the deterministic, non-fakeable kind:
//     exact texts (NFC-equal slots), required colors (seed
//     guarantee), dimensions, brief conformance
//   · revision rounds, model calls, elapsed ms, cycle guards
//   · engine warnings (density, fit)
//
// Corpus scope, honestly: Latin-script briefs only — the engine's
// SVG export has no non-Latin font pipeline yet, and without the
// visual loop in the benchmark a Devanagari/Arabic brief would
// "pass" deterministically while rendering tofu. That combination
// is exactly what this harness refuses to claim. Multilingual
// fidelity lands with the font work + in-benchmark visual passes.
//
// Usage (run in chunks — each brief is ~2-4 model calls):
//   bun scripts/designspec-agent-benchmark.ts run <outRoot> <from> <to>
//   bun scripts/designspec-agent-benchmark.ts aggregate <outRoot>
// ─────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { runDesignAgent } from '@/lib/design-agent/pipeline'
import type { DesignAgentModel } from '@/lib/design-agent/model'
import { PLANNER_SYSTEM, planUserPrompt, revisionUserPrompt } from '@/lib/design-agent/prompts'

const TMP = '/tmp/designspec-bench'

/** CLI-backed planner call with 429 backoff (the shared sandbox CLI
 * is rate-limited; a benchmark burst trips it — wait and retry
 * instead of failing the brief). */
function cliPlan(prompt: string, system: string): string {
  const out = `${TMP}-chat.json`
  const delays = [0, 30_000, 60_000, 90_000]
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt]) {
      const until = Date.now() + delays[attempt]
      while (Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, Math.min(5_000, until - Date.now()))
    }
    try {
      execFileSync('z-ai', ['chat', '-p', prompt, '-s', system, '-o', out], { stdio: ['ignore', 'ignore', 'ignore'] })
      const reply = JSON.parse(readFileSync(out, 'utf-8')) as { choices?: { message?: { content?: string } }[] }
      return reply.choices?.[0]?.message?.content ?? ''
    } catch (err) {
      const msg = String(err)
      if (attempt === delays.length - 1) throw err
      if (!msg.includes('429') && !msg.includes('Too many')) {
        // non-rate errors (parse, network) still retry once, then bubble
        if (attempt > 1) throw err
      }
    }
  }
  return ''
}

const cliModel: DesignAgentModel = {
  plan: async (req) =>
    cliPlan(
      req.feedback ? revisionUserPrompt(req.feedback) : planUserPrompt(req.brief),
      PLANNER_SYSTEM,
    ),
}

/** 22 briefs — events, commerce, food, nonprofit, education, music,
 *  recruitment, real estate…; varying required-text counts, colors,
 *  formats and vocabulary demands (stats bands, timelines, mockups). */
const BRIEFS: { id: string; prompt: string }[] = [
  { id: 'b01-race', prompt: 'Create a poster for a mountain running event. The poster must show these exact lines: "Valley Runs 2026", "12km · Dachigam Road · 26 Jan", "Register Free". Use the colors #0D47A1 and #FF6F00 somewhere. Size 1080x1350. Include a stats band with runner numbers and a framed photo area. Energetic, bold, race-day feel.' },
  { id: 'b02-menu', prompt: 'Design a dinner menu board. It must show exactly: "Kashmiri Wazwan Evening", "Rista · Rogan Josh · Gustaba", "Rs 1,200 per guest". Use #1B5E20 and #F9A825. Size 1080x1350. Warm, traditional, appetizing.' },
  { id: 'b03-sale', prompt: 'Make a bold sale poster. Must show exactly: "Mega Winter Sale", "Up to 60% Off Everything", "This weekend only". Colors: #D32F2F and #212121. Size 1080x1080. Loud, retail, high-contrast.' },
  { id: 'b04-nonprofit', prompt: 'Create a charity fundraiser poster. Must show exactly: "Books for Every Child", "₹500 sponsors a full school year", "Donate before 31 Dec". Use #00695C and #FFB300. Size 1080x1350. Hopeful, warm, trustworthy.' },
  { id: 'b05-music', prompt: 'Design a music festival poster. Must show exactly: "Alpine Nights Festival", "12–14 June 2026", "Tickets from Rs 3,500". Colors #311B92 and #FF4081. Size 1080x1350. Dark, electric, nightlife energy.' },
  { id: 'b06-education', prompt: 'Make a coding bootcamp poster. Must show exactly: "12-Week Full-Stack Bootcamp", "Batch starts 5 January", "Scholarships for 10 students". Use #1565C0 and #FFFFFF. Size 1080x1350. Modern, clean, career-focused.' },
  { id: 'b07-recruit', prompt: 'Create a hiring poster. Must show exactly: "We are hiring Designers", "Apply by 15 Jan 2027", "Remote-friendly". Colors #37474F and #FF7043. Size 1080x1080. Professional, direct, confident.' },
  { id: 'b08-realestate', prompt: 'Design an open-house poster. Must show exactly: "Open House Sunday", "11 AM – 4 PM · Gulmarg Residences", "RSVP 98x000 000". Use #4E342E and #FFCA28. Size 1080x1350. Elegant, premium, inviting.' },
  { id: 'b09-yoga', prompt: 'Make a wellness retreat poster. Must show exactly: "Himalayan Yoga Retreat", "7 days of stillness", "From Rs 18,000". Colors #2E7D32 and #FFF8E1. Size 1080x1350. Calm, minimal, breathing room.' },
  { id: 'b10-tech', prompt: 'Create a product-launch poster. Must show exactly: "Canvix 2.0 Launch Week", "One prompt, one professional design", "Try it free — 18 Feb". Use #0D47A1 and #FF6F00. Size 1200x628. Sharp, confident, modern.' },
  { id: 'b11-exhibit', prompt: 'Design an art-exhibition poster. Must show exactly: "Threads of the Valley", "Contemporary Kashmiri Textiles", "4 Mar – 30 Apr 2026". Colors #4A148C and #FFD54F. Size 1080x1350. Refined, gallery-quiet.' },
  { id: 'b12-farmers', prompt: 'Make a farmers-market poster. Must show exactly: "Saturday Farmers Market", "6 AM – 1 PM · Lal Chowk", "Fresh from the valley". Use #1B5E20 and #F9A825. Size 1080x1080. Friendly, earthy, hand-made warmth.' },
  { id: 'b13-fitness', prompt: 'Create a gym-promotion poster. Must show exactly: "New Year, New You", "First month free", "Join before 10 Jan". Colors #B71C1C and #FFEB3B. Size 1080x1350. High-energy, motivational.' },
  { id: 'b14-conference', prompt: 'Design a tech-conference poster. Must show exactly: "DevSrinagar 2026", "26–27 September · SKICC", "Early bird Rs 1,999". Use #004D40 and #FF6F00. Size 1080x1350. Serious, tech-forward, structured. Include a schedule timeline band.' },
  { id: 'b15-bakery', prompt: 'Make a bakery poster. Must show exactly: "Saffron & Almond Bakes", "Order 48 hours ahead", "Call 95x000 000". Colors #5D4037 and #FFB300. Size 1080x1080. Cozy, artisanal, golden warmth.' },
  { id: 'b16-marathon', prompt: 'Create a marathon poster. Must show exactly: "Srinagar Half Marathon", "21.0975 km · 2 Feb 2026", "Register at srinagarrun.in". Use #01579B and #FFC107. Size 1080x1350. Athletic, crisp, morning-light energy. Add a stats band with participant numbers.' },
  { id: 'b17-theatre', prompt: 'Design a theatre poster. Must show exactly: "Bhand Pather: The Living Tradition", "8 PM nightly · Abhinav Theatre", "Tickets Rs 300". Colors #880E4F and #E0E0E0. Size 1080x1350. Dramatic, dark-stage contrast.' },
  { id: 'b18-vaccination', prompt: 'Make a health-camp poster. Must show exactly: "Free Health Camp", "9 AM – 4 PM · Community Hall", "Bring your health card". Use #00695C and #FFFFFF. Size 800x2000. Clear, accessible, high-contrast, calm urgency.' },
  { id: 'b19-coffee', prompt: 'Create a café poster. Must show exactly: "Pheran & Pour", "Kahwa served till dusk", "Open 8 AM daily". Colors #3E2723 and #FF8F00. Size 1080x1080. Warm, slow, aromatic mood.' },
  { id: 'b20-startup', prompt: 'Design a demo-day poster. Must show exactly: "Demo Day Winter 2026", "10 startups, 5 minutes each", "Apply to pitch by 20 Dec". Use #1A237E and #FF5252. Size 1080x1350. Ventures, momentum, bold numerals.' },
  { id: 'b21-cleanup', prompt: 'Make a lake-cleanup drive poster. Must show exactly: "Save Dal, One Sunday", "7 AM · Boulevard Road", "Volunteers get breakfast". Colors #0277BD and #AED581. Size 1080x1350. Community, fresh, hopeful. Include a stat row with last year\'s numbers.' },
  { id: 'b22-crafts', prompt: 'Create a craft-workshop poster. Must show exactly: "Papier-Mâché Workshop", "Saturdays · 11 AM", "Materials included · Rs 800". Use #6A1B9A and #FFD600. Size 1080x1350. Artisanal, playful, colorful. Add a framed photo area for student work.' },
]

const phase = process.argv[2]
const outRoot = process.argv[3]

if (phase !== 'run' && phase !== 'aggregate') {
  console.error('usage: bun scripts/designspec-agent-benchmark.ts run <outRoot> <from> <to> | aggregate <outRoot>')
  process.exit(2)
}

if (phase === 'run') {
  const from = Math.max(0, Number(process.argv[4] || 0))
  const to = Math.min(BRIEFS.length, Number(process.argv[5] || BRIEFS.length))
  mkdirSync(outRoot, { recursive: true })
  const results: unknown[] = []
  for (let i = from; i < to; i++) {
    const brief = BRIEFS[i]
    const outDir = path.join(outRoot, brief.id)
    mkdirSync(outDir, { recursive: true })
    writeFileSync(path.join(outDir, 'prompt.txt'), brief.prompt)
    const started = Date.now()
    let run
    try {
      run = await runDesignAgent({ prompt: brief.prompt, model: cliModel })
    } catch (err) {
      results.push({ id: brief.id, outcome: 'error', error: String(err) })
      console.log(`${brief.id}  ERROR ${String(err).slice(0, 80)}`)
      continue
    }
    const elapsedMs = Date.now() - started
    if (run.report.spec) writeFileSync(path.join(outDir, 'spec.json'), JSON.stringify(run.report.spec, null, 2))
    if (run.pages) writeFileSync(path.join(outDir, 'pages.json'), JSON.stringify(run.pages, null, 2))
    if (run.checks) writeFileSync(path.join(outDir, 'checks.json'), JSON.stringify(run.checks, null, 2))
    const rec = {
      id: brief.id,
      outcome: run.outcome,
      modelCalls: run.report.modelCalls,
      revisionRounds: run.report.revisionRounds,
      cycleGuard: run.report.cycleGuard,
      briefConformanceFailures: run.briefConformance.length,
      checks: run.checks ? { passed: run.checks.passed, failures: run.checks.failures.length } : null,
      warnings: run.warnings.length,
      elapsedMs,
    }
    writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(rec, null, 2))
    results.push(rec)
    console.log(
      `${brief.id}  ${run.outcome.padEnd(15)} calls=${run.report.modelCalls} rev=${run.report.revisionRounds} ` +
        `briefFails=${run.briefConformance.length} ${elapsedMs}ms`,
    )
  }
  writeFileSync(path.join(outRoot, `chunk-${from}-${to}.json`), JSON.stringify(results, null, 2))
  console.log(`chunk ${from}-${to} done: ${results.length} briefs`)
  process.exit(0)
}

// ── aggregate ──
const dirs = readdirSync(outRoot).filter((d) => d.startsWith('b') && d.length > 3 && existsSync(path.join(outRoot, d, 'result.json')))
const rows = dirs
  .map((d) => JSON.parse(readFileSync(path.join(outRoot, d, 'result.json'), 'utf-8')) as Record<string, number | string | boolean>)
  .sort((a, b) => String(a.id).localeCompare(String(b.id)))

const passed = rows.filter((r) => r.outcome === 'passed').length
const honestFails = rows.filter((r) => r.outcome === 'failed-honestly').length
const cycled = rows.filter((r) => r.outcome === 'guard-cycled').length
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0)

const summary = {
  briefs: rows.length,
  passed,
  failedHonestly: honestFails,
  guardCycled: cycled,
  passRate: rows.length ? Number((passed / rows.length).toFixed(3)) : 0,
  avgModelCalls: avg(rows.map((r) => Number(r.modelCalls ?? 0))),
  avgRevisionRounds: avg(rows.map((r) => Number(r.revisionRounds ?? 0))),
  avgElapsedMs: avg(rows.map((r) => Number(r.elapsedMs ?? 0))),
  totalModelCalls: rows.reduce((a, r) => a + Number(r.modelCalls ?? 0), 0),
  // the self-correction story: runs that needed at least one revision
  // and still finished passed
  selfCorrectedToPass: rows.filter((r) => r.outcome === 'passed' && Number(r.revisionRounds ?? 0) > 0).length,
}

writeFileSync(path.join(outRoot, 'benchmark-report.json'), JSON.stringify({ summary, rows }, null, 2))

const md = [
  '# DesignAgent benchmark — instruction fidelity (24 Nov 2026)',
  '',
  `**${summary.briefs} diverse briefs · real GLM planner · deterministic evaluation.**`,
  '',
  `| metric | value |`,
  `| --- | --- |`,
  `| briefs run | ${summary.briefs} |`,
  `| passed (all checks + brief conformance) | ${summary.passed} (${(summary.passRate * 100).toFixed(0)}%) |`,
  `| failed honestly | ${summary.failedHonestly} |`,
  `| cycle-guarded | ${summary.guardCycled} |`,
  `| self-corrected to pass (≥1 revision, finished passed) | ${summary.selfCorrectedToPass} |`,
  `| avg model calls per brief | ${summary.avgModelCalls} |`,
  `| avg revision rounds | ${summary.avgRevisionRounds} |`,
  `| avg wall time per brief | ${(summary.avgElapsedMs / 1000).toFixed(1)}s |`,
  `| total model calls | ${summary.totalModelCalls} |`,
  '',
  'Fidelity here is the deterministic, non-fakeable kind: exact texts',
  '(NFC-equal slots, rendered through the real export pipeline in the',
  'single-brief acceptance runs), required colors via the seed',
  'guarantee, exact dimensions, and the brief→spec conformance check',
  'the agent layer owns. Aesthetic quality is judged separately by',
  'the visual-verification loop (advisory, VLM-on-the-real-render).',
  '',
  '## Per-brief outcomes',
  '',
  `| brief | outcome | calls | revisions | brief-fails | wall |`,
  `| --- | --- | --- | --- | --- | --- |`,
  ...rows.map(
    (r) =>
      `| ${r.id} | ${r.outcome} | ${r.modelCalls} | ${r.revisionRounds} | ${r.briefConformanceFailures} | ${(Number(r.elapsedMs) / 1000).toFixed(1)}s |`,
  ),
  '',
  'Corpus scope: Latin-script briefs only. Multilingual fidelity is',
  'scoped out until the font pipeline and in-benchmark visual passes',
  'exist — a Devanagari brief would pass text-presence checks while',
  'rendering tofu, which this harness refuses to claim as fidelity.',
  '',
].join('\n')
writeFileSync(path.join(outRoot, 'benchmark-report.md'), md)
console.log(`══ benchmark aggregate ══`)
console.log(JSON.stringify(summary, null, 2))
