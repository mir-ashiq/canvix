import { test, expect, type Page } from '@playwright/test'

/**
 * v0.14 (D6): dashboard folders — acceptance.
 *
 *   1. folder lifecycle: create a folder from the dashboard, file a
 *      design into it (card ⋯ menu), the folder view shows ONLY that
 *      design while All designs keeps everything, rename the folder,
 *      delete it — the designs survive, back at the root (API truth)
 *   2. folders are PRIVATE organization: a different browser's
 *      attribution cannot list, mutate, filter by, or create into
 *      someone else's folders (flat 404s, no existence oracle)
 *
 * Both tests are fully ANONYMOUS — zero account registrations (the
 * suite-wide register budget is 5/h/IP, see the PR #26 fix).
 */

const ts = Date.now().toString(36)

async function openDashboard(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: /start designing/i }).first().click()
  await expect(page.getByLabel('Create a design')).toBeVisible({ timeout: 60_000 })
}

async function createDesign(page: Page, name: string): Promise<string> {
  const res = await page.request.post('/api/designs', {
    data: {
      name,
      width: 800,
      height: 600,
      pages: [{ id: 'p1', background: { type: 'solid', color: '#FFFFFF' }, elements: [] }],
    },
  })
  expect(res.status(), `create design ${name}: ${await res.text()}`).toBeLessThan(300)
  return ((await res.json()) as { id: string }).id
}

test.setTimeout(120_000)

test.describe('Folders (v0.14 D6)', () => {
  test('create → file a design in → filter → rename → delete → designs survive at the root', async ({ page }) => {
    await openDashboard(page)

    // ── create the folder from the chips row ──
    await page.getByRole('button', { name: 'New folder' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Folder name').fill(`Client work ${ts}`)
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(dialog).toBeHidden()

    const chip = page.getByRole('button', { name: `Open folder Client work ${ts}` })
    await expect(chip).toBeVisible({ timeout: 45_000 })
    await expect(chip).toContainText('0') // empty folder count

    // two anonymous designs: one to file, one to leave at the root
    const filedName = `cvx_d6_filed_${ts}`
    const rootedName = `cvx_d6_rooted_${ts}`
    const filedId = await createDesign(page, filedName)
    await createDesign(page, rootedName)

    // reload the dashboard — both designs are in All designs
    await openDashboard(page)
    const filedCard = page.getByRole('button', { name: `Open ${filedName}` })
    const rootedCard = page.getByRole('button', { name: `Open ${rootedName}` })
    await expect(filedCard).toBeVisible({ timeout: 45_000 })
    await expect(rootedCard).toBeVisible()

    // ── file the design through the card's ⋯ menu ──
    await page.getByRole('button', { name: `Options for ${filedName}` }).click()
    await page.getByRole('menuitem', { name: 'Move to folder' }).click()
    await page.getByRole('menuitem', { name: `Client work ${ts}` }).click()

    // the chip count went up (UI truth)…
    await expect(chip).toContainText('1')

    // …and the API agrees
    const foldersRes = await page.request.get('/api/folders')
    expect(foldersRes.status()).toBe(200)
    const foldersBody = (await foldersRes.json()) as {
      folders: { id: string; name: string; designCount: number }[]
    }
    const folder = foldersBody.folders.find((f) => f.name === `Client work ${ts}`)
    expect(folder?.designCount).toBe(1)
    const listRes = await page.request.get(`/api/designs?folder=${folder?.id}`)
    expect(listRes.status()).toBe(200)
    const listed = (await listRes.json()) as { designs: { id: string }[] }
    expect(listed.designs.map((d) => d.id)).toContain(filedId)

    // ── the folder view shows ONLY the filed design ──
    await chip.click()
    await expect(page.getByRole('heading', { name: `Client work ${ts}` })).toBeVisible()
    await expect(filedCard).toBeVisible()
    await expect(rootedCard).toBeHidden()

    // ── All designs still shows everything ──
    await page.getByRole('button', { name: 'All designs' }).click()
    await expect(page.getByRole('heading', { name: 'Recent designs' })).toBeVisible()
    await expect(filedCard).toBeVisible()
    await expect(rootedCard).toBeVisible()

    // ── rename the folder from the chip's ⋯ menu ──
    await page.getByRole('button', { name: `Options for folder Client work ${ts}` }).click()
    await page.getByRole('menuitem', { name: 'Rename' }).click()
    const renameDialog = page.getByRole('dialog')
    await expect(renameDialog).toBeVisible()
    await renameDialog.getByLabel('Folder name').fill(`Client work 2026 ${ts}`)
    await renameDialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(renameDialog).toBeHidden()
    const renamedChip = page.getByRole('button', { name: `Open folder Client work 2026 ${ts}` })
    await expect(renamedChip).toBeVisible({ timeout: 45_000 })

    // ── delete the folder: the confirm guard accepts ──
    page.on('dialog', (d) => void d.accept())
    await page.getByRole('button', { name: `Options for folder Client work 2026 ${ts}` }).click()
    await page.getByRole('menuitem', { name: 'Delete folder' }).click()

    // the chip is gone, the view falls back to All designs…
    await expect(renamedChip).toBeHidden({ timeout: 45_000 })
    await expect(page.getByRole('heading', { name: 'Recent designs' })).toBeVisible()
    // …and BOTH designs survived (API truth: unfiled, not deleted)
    const after = (await (await page.request.get(`/api/designs/${filedId}`)).json()) as {
      folderId: string | null
      deletedAt: string | null
    }
    expect(after.folderId).toBeNull()
    expect(after.deletedAt).toBeNull()
    await expect(filedCard).toBeVisible()
    await expect(rootedCard).toBeVisible()

    // the folder tree is empty again
    const treeRes = await page.request.get('/api/folders')
    const tree = (await treeRes.json()) as { folders: { name: string }[] }
    expect(tree.folders.some((f) => f.name.includes(ts))).toBe(false)
  })

  test('folders are private to their attribution — foreign ids are flat 404s', async ({ browser }) => {
    // browser A (with the folder) — API only, no dashboard needed
    const ctxA = await browser.newContext()
    const pageA = await ctxA.newPage()
    await pageA.goto('/')
    const createRes = await pageA.request.post('/api/folders', {
      data: { name: `Secret A ${ts}` },
    })
    expect(createRes.status(), await createRes.text()).toBeLessThan(300)
    const { folder } = (await createRes.json()) as { folder: { id: string } }
    expect(folder.id).toBeTruthy()

    // browser B (different attribution): the folder does not exist to it
    const ctxB = await browser.newContext()
    const pageB = await ctxB.newPage()
    await pageB.goto('/')

    const listRes = await pageB.request.get('/api/folders')
    expect(listRes.status()).toBe(200)
    const body = (await listRes.json()) as { folders: { id: string }[] }
    expect(body.folders.some((f) => f.id === folder.id)).toBe(false)

    // no mutation, no filtering, no creating-into, no existence oracle
    const patch = await pageB.request.patch(`/api/folders/${folder.id}`, {
      data: { name: 'Hijacked' },
    })
    expect(patch.status()).toBe(404)
    const del = await pageB.request.delete(`/api/folders/${folder.id}`)
    expect(del.status()).toBe(404)
    const filtered = await pageB.request.get(`/api/designs?folder=${folder.id}`)
    expect(filtered.status()).toBe(404)
    const createInto = await pageB.request.post('/api/designs', {
      data: { name: 'Intruder', width: 800, height: 600, folderId: folder.id },
    })
    expect(createInto.status()).toBe(404)

    // the move route rejects a foreign folder too (ownerless design,
    // editable by B — but the TARGET folder is not B's)
    const designRes = await pageA.request.post('/api/designs', {
      data: {
        name: `cvx_d6_iso_${ts}`,
        width: 800,
        height: 600,
        pages: [{ id: 'p1', background: { type: 'solid', color: '#FFFFFF' }, elements: [] }],
      },
    })
    const designId = ((await designRes.json()) as { id: string }).id
    const move = await pageB.request.post(`/api/designs/${designId}/move`, {
      data: { folderId: folder.id },
    })
    expect(move.status()).toBe(404)

    await ctxA.close()
    await ctxB.close()
  })
})
