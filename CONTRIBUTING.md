# Contributing to Canvix

Thanks for helping build the open-source Canva alternative! 🎨

## Getting set up

```bash
git clone https://github.com/mir-ashiq/canvix.git
cd canvix
npm install
cp .env.example .env   # then set DATABASE_URL (Supabase / Neon / local Postgres)
npm run db:setup        # migrations + the 110-template seed, one command
npm run dev
```

> `npm run lint` and `npm run typecheck` must pass before every commit.
> (bun works too — `bun install`, `bun run dev` — the lockfile is npm's.)

## Where to help

| Area | Files |
|---|---|
| New templates | `src/lib/templates/collection-v08-*.ts` (compose elements with the builder helpers in `src/lib/templates/helpers.ts`) |
| New fonts | `src/lib/editor-utils.ts` → `FONTS` + the Google Fonts link in `src/app/layout.tsx` |
| Stickers / graphics | `src/lib/editor-utils.ts` → `STICKER_GROUPS`, `GRAPHICS` |
| Canvas behavior | `src/components/editor/canvas/` |
| Panels & toolbars | `src/components/editor/panels/`, `src/components/editor/PropertiesBar.tsx` |
| Export | `src/components/editor/canvas/canvas-bridge.ts` |
| API & data | `src/app/api/`, `prisma/schema.prisma` |

## Adding a template

1. Open one of the `src/lib/templates/collection-v08-*.ts` files.
2. Compose pages using `tx` (text), `sh` (shape), `ln` (line), `st` (sticker), `gr` (graphic).
3. Pick a unique `slug`, `category` (`social | presentation | print | logo | thumbnail`) and an `accent` color.
4. Run `bun run db:seed` and restart the dev server.

## Guidelines

- Keep the Canva-style UI conventions: pill buttons, the teal → violet gradient, dark editor rail.
- TypeScript strict: no `any` unless unavoidable.
- Test your change in the browser on **desktop and mobile** widths.
- Keep design documents small: templates are plain JSON, no binary assets in the repo.

## CI & required checks

Every pull request runs the **CI** workflow (`.github/workflows/ci.yml`):

| Check | What runs | When |
|---|---|---|
| `lint-unit` | `npm ci` → `tsc --noEmit` → `eslint .` → `vitest run` (316 unit tests, no database needed) | every pull request |
| `e2e` | the full Playwright browser suite (28 tests) against a real Postgres service container — migrations + template seed + `next dev`, all inside the job | merges to `main`, and on demand via *Actions → CI → Run workflow* |

Merges to `main` run both jobs, so nothing lands on `main` without the
browser suite either. The deploy pipelines (Vercel, Cloudflare Workers
Builds, Netlify) publish `main` directly — CI is the only test gate they
get, which is why it exists.

**Cutting a release?** Follow [`RELEASE-CHECKLIST.md`](RELEASE-CHECKLIST.md)
(host bump → plugin `engines` ceiling → untracked-route-file sweep → full
CI wall → tag). It exists because three releases shipped with a gap CI
cannot see — a plugin ceiling the host outgrew (×2) and a route file the
scaffold-era `.gitignore` silently skipped.

**One-time setup for maintainers — make the gate binding.** Branch
protection cannot be enabled from a PR, so after merging the CI workflow:

1. Repo **Settings → Branches → Add branch ruleset** (or classic branch
   protection rule) for `main`.
2. Enable **Require status checks to pass** and select **`lint-unit`**
   (the picker lists it after the workflow's first run on a PR).
3. Optionally enable *Require branches to be up to date*.

`e2e` runs after the merge on `main` pushes by design (keeps PR feedback
fast); for risky PRs — UI, collab, export changes — run it pre-merge via
*Actions → CI → Run workflow*, or locally:

```bash
npm run db:setup && npx playwright test
```

## Pull requests

1. Fork & branch (`feat/my-feature`).
2. One logical change per PR.
3. Describe what changed + screenshots for UI changes.
4. `npm run lint` and `npm run typecheck` pass, and the `lint-unit` CI
   check is green.
