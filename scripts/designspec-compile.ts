// ─────────────────────────────────────────────────────────────
// DesignSpec end-to-end proof harness (Phase A acceptance).
//
// Two paths, same deterministic compiler:
//   1. "brief"   — raw prompt → extractBrief() → specFromBrief()
//                   → compileSpec()   (zero-model path)
//   2. "model"   — raw model JSON (a real LLM planner output)
//                   → parseSpecResponse() → compileSpec()
//
// Usage: bun scripts/designspec-compile.ts brief <outdir>
//        bun scripts/designspec-compile.ts model <outdir> <rawModelJson>
//
// Writes: brief.json, spec.json, pages.json, checks.json and prints
// the check report. The render step (real browser) is separate:
// scripts/designspec-render.mjs.
// ─────────────────────────────────────────────────────────────

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { extractBrief } from '@/lib/agent/brief'
import { specFromBrief } from '@/lib/design-spec/from-brief'
import { parseSpecResponse } from '@/lib/design-spec/parse'
import { compileSpec, type CompileResult } from '@/lib/design-engine/compile'
import type { DesignSpec } from '@/lib/design-spec/types'

// The canonical proof brief. Three verbatim lines (one with an em dash
// and middle dots — the NFC-exactness contract), two required hexes,
// explicit 1080x1350 dimensions, warm mood.
export const PROOF_BRIEF = [
  'Create a poster for a harvest festival.',
  'The poster must show these exact lines:',
  '"Kashmir Apple Harvest Festival 2026",',
  '"Oct 18 · Dachigam Grounds · Srinagar",',
  '"Entry Free — 10 AM to 6 PM".',
  'Use the colors #1B5E20 and #F9A825 somewhere.',
  'Size 1080x1350. Warm autumn feel, bold and inviting.',
].join(' ')

function write(outdir: string, file: string, data: unknown): void {
  writeFileSync(`${outdir}/${file}`, JSON.stringify(data, null, 2))
}

function report(label: string, spec: DesignSpec, result: CompileResult, outdir: string): void {
  const { checks } = result
  console.log(`\n══ ${label} ══`)
  console.log(`spec: "${spec.name}" ${spec.format.width}x${spec.format.height} · mood=${spec.palette.mood} · seeds=[${spec.palette.seeds.join(', ')}] · blocks=${spec.blocks.length}`)
  console.log(`elements: ${result.pages[0]?.elements.length ?? 0}`)
  console.log(`checks.passed: ${checks.passed}`)
  for (const t of checks.exactTexts) console.log(`  exactText  ${t.found ? 'PASS' : 'FAIL'}  "${t.text}"`)
  for (const c of checks.colors) console.log(`  color     ${c.found ? 'PASS' : 'FAIL'}  ${c.hex}`)
  console.log(`  inCanvas=${checks.inCanvas} overlapOk=${checks.noUnintendedOverlap} textFits=${checks.textFits}`)
  for (const c of checks.contrast) console.log(`  contrast  ${c.ok ? 'PASS' : 'FAIL'}  ${c.pair} = ${c.ratio.toFixed(2)}`)
  if (checks.failures.length) {
    console.log('  FAILURES:')
    for (const f of checks.failures) console.log(`    - ${f}`)
  }
  if (result.warnings.length) console.log(`  warnings: ${result.warnings.length}`)
  write(outdir, 'spec.json', spec)
  write(outdir, 'pages.json', result.pages)
  write(outdir, 'checks.json', { ...checks, warnings: result.warnings, palette: result.palette, typography: result.typography })
}

const mode = process.argv[2] ?? 'brief'
const outdir = process.argv[3] ?? '/tmp/designspec-out'
mkdirSync(outdir, { recursive: true })

if (mode === 'brief') {
  const brief = extractBrief(PROOF_BRIEF)
  write(outdir, 'brief.json', brief)
  const spec = specFromBrief(brief)
  report('DETERMINISTIC PATH (prompt → extractBrief → specFromBrief → compileSpec)', spec, compileSpec(spec), outdir)
  console.log(`\nrequiredTexts extracted: ${brief.requiredTexts.map((t) => `"${t.text}"`).join('  ')}`)
  console.log(`requiredColors extracted: ${brief.requiredColors.map((c) => c.hex).join('  ')}`)
  console.log(`dimensions: ${brief.dimensions ? `${brief.dimensions.width}x${brief.dimensions.height}` : '(none)'}`)
} else if (mode === 'model') {
  const rawFile = process.argv[4]
  if (!rawFile) throw new Error('model mode needs the raw model output JSON file')
  const raw = JSON.parse(readFileSync(rawFile, 'utf-8'))
  const parsed = parseSpecResponse(raw, 1080, 1350)
  if (!parsed.ok) {
    console.log(`PARSE FAILED: ${parsed.error}`)
    write(outdir, 'parse-failed.json', { ok: false, error: parsed.error })
    process.exit(1)
  }
  report('MODEL PATH (LLM planner → parseSpecResponse → compileSpec)', parsed.spec, compileSpec(parsed.spec), outdir)
} else {
  throw new Error(`unknown mode "${mode}" (use brief|model)`)
}
