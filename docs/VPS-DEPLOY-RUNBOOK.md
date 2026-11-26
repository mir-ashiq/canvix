# VPS Deploy Runbook — canvix.app (132.226.127.65)

**Who runs this:** the maintainer (or an agent session holding the SSH key).
**State:** ✅ **DEPLOYED 2026-11-24** — the key was re-provided, the deploy of `52eb8e0` completed via the auto-deploy script, all §4 checks passed live, and the wellKnown activation (§5) is done. This document now serves as the reference for FUTURE deploys.

## 0. What is deployed where

| Piece | Value |
|---|---|
| Host | `132.226.127.65` (Oracle Cloud), user `ubuntu`, aarch64 |
| Auth | SSH key `oracle_vm1.key` (the sandbox copy lives at `/tmp/oracle_vm1.key`; `/tmp` is wiped on sandbox recycle, so it must be re-provided per session — it is never stored in the repository) |
| Site | https://canvix.app → this VPS (reverse proxy → app on `127.0.0.1:3010`) |
| App | `/opt/canvix` — Next.js standalone build, systemd service `canvix`, Postgres in the `canvix-pg` Docker container |
| Deploy pattern | `auto-deploy.sh` (cron, flock-guarded): poll `origin/main` → snapshot → reset → `npm ci` → build → `prisma migrate deploy` → restart → health check → auto-rollback on failure. Manual: `auto-deploy.sh --force` |
| Helper scripts | `/home/z/my-project/scripts/vps.py` and `vps_ssh.py` (paramiko runners, key at `/tmp`) |

## 1. The one blocker — RESOLVED 2026-11-24

The key was re-provided by the maintainer and the deploy executed. This section remains as the procedure for any future session that needs to deploy: the sandbox's `/tmp/oracle_vm1.key` does not survive recycles (the key is never stored anywhere durable, by design), so a fresh session must re-attach it — either:

- upload/provide it again and place it at `/tmp/oracle_vm1.key` (chmod 600) for the helper scripts, or
- run §3 by hand from your own machine where the key already exists.

No credentials, tokens or secrets are stored in this repository.

## 2. What this deploy ships (merge commit of the funding PR)

- The complete v0.29.4 agent-correctness work (already merged to `main` as PR #85).
- **v0.29.5 funding application artifacts**, including `public/.well-known/funding-manifest-urls`.
- The e2e + docker CI jobs now verify the `.well-known` file in dev-mode AND the production standalone container, so a regression is caught before deploy.

## 3. Deploy steps (run on the VPS, as `ubuntu`)

```bash
cd ~/canvix                     # or wherever the repo checkout lives
git fetch origin
git checkout main && git reset --hard origin/main

# snapshot the current standalone build (restore-on-failure safety net)
cp -a .next/standalone ~/standalone-backup-$(date +%Y%m%d%H%M) 2>/dev/null || true

npm ci --no-audit --no-fund
npm run build                    # standalone output (CI already proved this build green)
npx prisma migrate deploy        # idempotent; template sync happens on boot

# restart the service — use whichever manager this VPS runs:
systemctl restart canvix 2>/dev/null || pm2 restart canvix 2>/dev/null || \
  (pkill -f 'node .*standalone' || true; nohup node .next/standalone/server.js &)
```

## 4. Post-deploy verification (must all pass)

```bash
curl -fsS https://canvix.app/api/health            # {"ok":true, "database":{...}, "templates":366}
curl -fsS https://canvix.app/ -o /dev/null -w '%{http_code}\n'   # 200
curl -fsS https://canvix.app/.well-known/funding-manifest-urls
# → must print EXACTLY (v0.32.7: every fetchable form of the manifest
#   URL, one per line — the fundingjson.org checkers do exact-string
#   membership, so a single canonical form was "not found in the list"):
# https://raw.githubusercontent.com/mir-ashiq/canvix/refs/heads/main/funding.json
# https://raw.githubusercontent.com/mir-ashiq/canvix/main/funding.json
# https://github.com/mir-ashiq/canvix/blob/main/funding.json
# https://github.com/mir-ashiq/canvix/raw/refs/heads/main/funding.json
# https://github.com/mir-ashiq/canvix/raw/main/funding.json
# https://canvix.app/funding.json
curl -fsS https://canvix.app/funding.json           # 200 — the domain-hosted manifest copy
```

If health fails or the site is down: restore the snapshot (`rm -rf .next/standalone && cp -a ~/standalone-backup-* .next/standalone`), restart, and investigate offline — the old build keeps serving.

## 5. Well-known activation (after §4 passes) — ✅ COMPLETED 2026-11-24

The deploy of `52eb8e0` ran via the VPS auto-deploy script ("DEPLOY OK" in `~/canvix-auto-deploy.log`), §4's checks passed against the live site, and the activation steps below were executed:

1. ✅ `funding.json` now carries `"wellKnown": "https://canvix.app/.well-known/funding-manifest-urls"` inside `projects[0].webpageUrl`.
2. ✅ The honesty guard in `src/lib/funding-manifest.test.ts` was flipped to assert the property's **presence** (with the activation date and the reason recorded in the test).
3. ✅ Committed, CI-validated and merged; the grants directory picks the manifest up on its weekly refresh.

If the live URL ever stops serving the file, the CI manifest test, the e2e smoke spec and the docker-job assertion all fail loudly — fix the deployment (§3–§4), not the tests.

**Note on how the deploy actually runs (supersedes the §3 manual sketch):** this VPS has an auto-deploy script (cron, `flock`-guarded) that polls `origin/main` every ~5 minutes, snapshots the standalone build, `git reset --hard origin/main`, restores the local `.env`, `npm ci`, `npm run build`, `npx prisma migrate deploy`, `systemctl restart canvix`, health-checks port 3010, and **auto-rolls back to the last-good build on failure**. Manual deploys should use `auto-deploy.sh --force` rather than hand-rolling §3.

## 6. Rollback

The snapshot in §3 plus `git reset --hard <previous-tag>` rebuilds the prior state; database migrations are additive (no destructive migration in this deploy). `prisma migrate deploy` is a no-op when already applied.
