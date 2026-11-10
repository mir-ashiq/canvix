// Render all sticker SVGs to a contact sheet for visual QA.
import { STICKER_PACKS } from '../src/lib/stickers/index'
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } })
  const cols = 10
  const cell = 120
  const all = STICKER_PACKS.flatMap((p) => p.stickers.map((s) => ({ ...s, pack: p.id })))
  const rows = Math.ceil(all.length / cols)
  const html = `<!doctype html><html><body style="margin:0">
  <div style="position:relative;width:${cols * cell}px;height:${rows * cell}px;background:#f4f4f6">
  ${all
    .map(
      (s, i) =>
        `<div style="position:absolute;left:${(i % cols) * cell}px;top:${Math.floor(i / cols) * cell}px;width:${cell}px;height:${cell}px;display:flex;align-items:center;justify-content:center">${s.svg.replace('viewBox="0 0 120 120"', 'width="100" height="100" viewBox="0 0 120 120"')}</div>`,
    )
    .join('')}
  </div></body></html>`
  await page.setContent(html)
  await page.screenshot({ path: '/tmp/sticker-sheet.png', fullPage: true })
  await browser.close()
  writeFileSync('/tmp/sticker-order.txt', all.map((s, i) => `${i}: ${s.pack}/${s.id}`).join('\n'))
  console.log(`rendered ${all.length} stickers to /tmp/sticker-sheet.png`)
}
main()
