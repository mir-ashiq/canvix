// ─────────────────────────────────────────────────────────────
// DesignSpec browser render proof (Phase A acceptance).
//
// Renders compiled pages through the app's REAL vector export
// pipeline (exportPageToSVG — the code path user downloads use)
// inside real Chromium, then:
//   · embeds the SVG in the page and screenshots it (PNG artifact)
//   · verifies the rendered SVG carries every required text
//     character-for-character and every required hex color
//   · records element counts and writes render-checks.json
//
// Usage: node scripts/designspec-render.mjs <artifactDir> <label>
// Run from the repo root. Requires scripts/designspec-browser-bundle.js
// (bun build scripts/designspec-browser-entry.ts --outfile ...).
// ─────────────────────────────────────────────────────────────
const { chromium } = require('playwright')
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const path = require('node:path')

const artifactDir = process.argv[2]
const label = process.argv[3] ?? 'render'
if (!artifactDir) throw new Error('usage: node scripts/designspec-render.mjs <artifactDir> <label>')

const spec = JSON.parse(readFileSync(path.join(artifactDir, 'spec.json'), 'utf-8'))
const pages = JSON.parse(readFileSync(path.join(artifactDir, 'pages.json'), 'utf-8'))
const compileChecks = JSON.parse(readFileSync(path.join(artifactDir, 'checks.json'), 'utf-8'))

// required texts = user-required slots (the immutable contract)
const requiredTexts = spec.blocks
  .flatMap((b) => b.content)
  .filter((s) => s.source === 'user-required')
  .map((s) => s.text)
const requiredHexes = spec.palette.seeds ?? []

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1400, height: 1800 } })
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8">
    <style>body{margin:0;background:#f0f0f0;padding:24px;font-family:sans-serif}
    #host svg{max-width:1080px;height:auto;display:block;background:#fff}
    h1{font-size:14px;color:#333}</style></head>
    <body><h1>${label} — Canvix DesignSpec render proof</h1><div id="host"></div></body></html>`)

  await page.addScriptTag({ path: path.resolve(__dirname, 'designspec-browser-bundle.js') })

  const result = await page.evaluate(
    ({ pageData, width, height }) => {
      const svg = window.__canvixExportPageToSVG(pageData, width, height)
      document.getElementById('host').innerHTML = svg
      const el = document.querySelector('#host svg')
      // exact-text verification against the RENDERED svg text nodes
      const textContent = el ? el.textContent : ''
      const fills = []
      if (el) {
        for (const node of el.querySelectorAll('[fill]')) {
          const f = node.getAttribute('fill')
          if (f && /^#[0-9a-fA-F]{3,8}$/.test(f)) fills.push(f.toLowerCase())
        }
      }
      return {
        svgLength: svg.length,
        textElementCount: el ? el.querySelectorAll('text').length : 0,
        shapeElementCount: el ? el.querySelectorAll('rect,path,line,circle,ellipse,polygon').length : 0,
        textContent,
        fills: [...new Set(fills)],
        svgXml: svg,
      }
    },
    { pageData: pages[0], width: spec.format.width, height: spec.format.height },
  )

  // character-for-character (NFC) verification, done in Node with the
  // same equality the compiler enforces
  const normalize = (s) => s.normalize('NFC')
  const textChecks = requiredTexts.map((t) => ({
    text: t,
    foundInRenderedSvg: normalize(result.textContent).includes(normalize(t)),
  }))
  const colorChecks = requiredHexes.map((h) => ({
    hex: h,
    foundInRenderedSvg: result.fills.includes(h.toLowerCase()),
  }))
  const passed = textChecks.every((c) => c.foundInRenderedSvg) && colorChecks.every((c) => c.foundInRenderedSvg)

  // screenshot the rendered svg (real pixels in a real browser)
  const svgLoc = page.locator('#host svg')
  await svgLoc.waitFor({ state: 'visible' })
  await page.waitForTimeout(300)
  const png = path.join(artifactDir, 'rendered.png')
  await svgLoc.screenshot({ path: png })
  writeFileSync(path.join(artifactDir, 'rendered.svg'), result.svgXml)

  const report = {
    label,
    renderer: 'exportPageToSVG (src/lib/svg-export.ts) in Chromium via Playwright',
    canvas: { width: spec.format.width, height: spec.format.height },
    elements: pages[0].elements.length,
    renderedTextNodes: result.textElementCount,
    renderedShapeNodes: result.shapeElementCount,
    textChecks,
    colorChecks,
    compileChecksPassed: compileChecks.passed,
    passed,
    screenshot: png,
  }
  writeFileSync(path.join(artifactDir, 'render-checks.json'), JSON.stringify(report, null, 2))
  console.log(`══ ${label} ══`)
  console.log(`elements on page: ${pages[0].elements.length} (text nodes: ${result.textElementCount}, shapes: ${result.shapeElementCount})`)
  for (const c of textChecks) console.log(`  rendered text ${c.foundInRenderedSvg ? 'PASS' : 'FAIL'}  "${c.text}"`)
  for (const c of colorChecks) console.log(`  rendered fill ${c.foundInRenderedSvg ? 'PASS' : 'FAIL'}  ${c.hex}`)
  console.log(`compile checks: ${compileChecks.passed ? 'PASS' : 'FAIL'} · render checks: ${passed ? 'PASS' : 'FAIL'}`)
  await browser.close()
  process.exit(passed ? 0 : 2)
}
main().catch((e) => { console.error(e); process.exit(1) })
