import { test, expect } from '@playwright/test'

/**
 * v0.11.5 (F4, research/V0114-QA-PASS.md): presence join latency.
 *
 * The stream pump used to send frames only on design events or every 20th
 * tick, so a client sitting IDLE in the editor learned about a new
 * collaborator only via the 20-tick keepalive — measured at 60–90 s in the
 * v0.11.4 QA pass. The pump now diffs presence per tick and pushes within
 * one tick (≤ 3.2 s idle).
 *
 * This test holds client A idle long enough for its pump to reach the full
 * 3.2 s backoff, then joins client B cold and requires B's avatar in A's
 * top bar well inside the old 60 s failure mode. The 15 s bound leaves
 * generous CI headroom; locally the fix lands in ~1–4 s.
 *
 * Needs a database (design + presence APIs) — see playwright.config.ts.
 */
test.setTimeout(120_000)

test('a joining collaborator becomes visible to an idle client within seconds', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  // deterministic identities, seeded before any app code runs
  await pageA.addInitScript(() =>
    localStorage.setItem(
      'canvix-identity-v1',
      JSON.stringify({ id: 'p_e2e_alice', name: 'Alice E2E', color: '#FF5C8A' }),
    ),
  )
  await pageB.addInitScript(() =>
    localStorage.setItem(
      'canvix-identity-v1',
      JSON.stringify({ id: 'p_e2e_bob', name: 'Bob E2E', color: '#00C4CC' }),
    ),
  )

  // A creates a design and goes idle in the editor
  await pageA.goto('/')
  await pageA.getByRole('button', { name: /start designing/i }).first().click()
  await pageA
    .locator('section:has(h2:text("Start a new design")) [aria-label^="Create "]')
    .first()
    .click()
  await expect(pageA.getByLabel('Design canvas')).toBeVisible({ timeout: 30_000 })
  const designUrl = pageA.url()

  // let A's pump back off to the idle cadence (worst case for the bug):
  // 800 → 1200 → 1800 → 2700 → 3200 ms takes ~9.7 s of quiet
  await pageA.waitForTimeout(12_000)

  // B joins cold — only a presence upsert announces them (no design events)
  const joinedAt = Date.now()
  await pageB.goto(designUrl)
  await expect(pageB.getByLabel('Design canvas')).toBeVisible({ timeout: 30_000 })

  // A must see B's avatar chip promptly (the old bug: 60–90 s)
  await expect(pageA.locator('[title="Bob E2E"]')).toBeVisible({ timeout: 15_000 })
  const latencyMs = Date.now() - joinedAt
  expect(latencyMs, 'idle-client join latency').toBeLessThan(15_000)

  // and B's fresh stream carries the current room state immediately:
  // A's avatar shows in B's top bar without waiting for any keepalive
  await expect(pageB.locator('[title="Alice E2E"]')).toBeVisible({ timeout: 15_000 })

  await ctxA.close()
  await ctxB.close()
})
