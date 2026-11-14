# Release Checklist

> Born from three real incidents: the **plugin-ceiling misses** (v0.22.0 and v0.23.0 both bumped the host version and forgot the shipped Word Cloud plugin's `engines` ceiling — fixed same-day each time) and the **`.gitignore` casualty** (v0.23.0's `/api/profile/ai-providers/test` route was silently never committed: the scaffold-era bare `test` rule matched the route directory, the button 404'd on every deployment until v0.23.1). Every step below exists because skipping it broke a real release.

---

## 1. Bump the host version

- [ ] Update `version` in `package.json` (semver: patch for fixes, minor for features).
- [ ] Update `CHANGELOG.md`: new version heading, dated, entries in the house style — what shipped, why, honest incident notes where relevant.
- [ ] Update `ROADMAP.md` per its own footer rule: move §3 items into §2 (the shipped map), re-rank the open map, refresh the status-date line and test-posture numbers.
- [ ] Grep the docs for stale version references: `grep -rn "v0\.2[0-3]" docs/ README.md` — fix any that name the old release as current.

## 2. Update the plugin engines ceiling

- [ ] Check `public/plugins/wordcloud/manifest.json`: the `engines.canvix` range must **include the new host version** (e.g. `">=0.13.4 <0.24.0"` covers 0.23.x but not 0.24.0).
- [ ] If the release changes plugin-facing surface (renderer contract, RPC broker, element schema), bump the ceiling deliberately and port the plugin in the same release.
- [ ] Verify with the plugin e2e suite: `PLAYWRIGHT_PLUGINS=1 npx playwright test -c playwright.plugins.config.ts` (install flow, sandbox, element render).

## 3. Sweep for untracked route files

The `.gitignore` incident: `git add` **silently skips** ignored paths — a route directory can be working locally, tested locally, and still missing from the release.

- [ ] `git status --short` — **must be empty** before tagging (no `??`, no ` M`, no deleted).
- [ ] Diff the API surface against the tree: every directory under `src/app/api/` must contain its `route.ts` **in git**:
  ```bash
  for d in $(find src/app/api -type d); do
    [ -f "$d/route.ts" ] && git ls-files --error-unmatch "$d/route.ts" >/dev/null 2>&1 \
      || echo "UNTRACKED: $d/route.ts"
  done
  ```
- [ ] If anything prints: fix the `.gitignore` rule (root-anchor it, e.g. `/test` not `test`), `git add` the file, and add a unit/e2e guard if the gap was user-visible.
- [ ] `git check-ignore -v <path>` names the exact rule when in doubt.

## 4. Run the full CI wall locally, then tag

- [ ] `npm run typecheck` — `tsc --noEmit`, zero errors.
- [ ] `npm run lint` — eslint, zero errors **and zero warnings** (the bar CI enforces).
- [ ] `npm test` — the full unit suite (1,411 tests / 108 files at v0.23.2; the number in `ROADMAP.md` §status must match this run).
- [ ] `npm run build` — the production-build guard (added v0.16.1 after the edge-instrumentation Prisma regression); if targeting Cloudflare, also `npm run verify:deploy` for the Workers bundle-size ceiling (~3 MB gz).
- [ ] e2e (needs a reachable `DATABASE_URL`): `npm run test:ui` — the 32-spec Playwright suite; optional gated suites when touched: plugins (`PLAYWRIGHT_PLUGINS=1`), stock video (`PLAYWRIGHT_STOCK_VIDEO=1`).
- [ ] Tag and push: `git tag vX.Y.Z && git push origin main --tags`, cut the GitHub Release from the changelog entry.
- [ ] Post-deploy verification on the live instance: `/api/health?v=2` returns `"ok":true` with fresh counts; the release's own headline features work in the deployed build (the v0.23.1 lesson: verify *on the deployment*, not just locally).

---

### House rules

- **CI is the gate, not the alibi** — every step above is enforced on PRs (`lint-unit` incl. production build + `e2e` on main); this checklist exists because some failures (untracked files, live-deploy gaps) only manifest *after* merge.
- **Same-day fix policy** — a release-blocking miss on the live instance gets a patch release the same day (the precedent: v0.22.1, v0.23.1, v0.23.2).
- **Grant-funded releases** additionally follow the commit-trailer convention in [README § AI & Development Disclosure](README.md#-ai--development-disclosure) (`Grant: NLnet WP#` trailers).
