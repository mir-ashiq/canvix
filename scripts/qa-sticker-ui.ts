// Visual QA: screenshot the Stickers app + Elements sticker tab.
import { chromium } from 'playwright'
import { request } from 'playwright'

async function main() {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await ctx.newPage()
  const r = await request.newContext({ baseURL: 'http://localhost:3000' })
  const res = await r.post('/api/designs', {
    data: { name: 'sticker visual qa', width: 1080, height: 720, pages: [{ id: 'p1', background: { type: 'solid', color: '#FFFFFF' }, elements: [] }] },
  })
  const { id } = await res.json()
  await page.goto(`http://localhost:3000/design/${id}`)
  await page.waitForSelector('[aria-label="Design canvas"]', { timeout: 60_000 })

  // Stickers app
  await page.getByRole('button', { name: 'Apps', exact: true }).click()
  await page.getByText('Stickers', { exact: true }).first().click()
  await page.waitForSelector('input[placeholder="Search 160+ stickers"]', { timeout: 20_000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: '/tmp/qa-stickers-app.png' })

  // search state
  await page.fill('input[placeholder="Search 160+ stickers"]', 'heart')
  await page.waitForTimeout(400)
  await page.screenshot({ path: '/tmp/qa-stickers-search.png' })

  // Elements sticker tab
  await page.fill('input[placeholder="Search 160+ stickers"]', '')
  await page.getByRole('button', { name: 'Elements', exact: true }).click()
  await page.getByRole('tab', { name: 'Stickers', exact: true }).click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: '/tmp/qa-elements-tab.png' })

  await browser.close()
  console.log('3 screenshots saved')
}
main()
