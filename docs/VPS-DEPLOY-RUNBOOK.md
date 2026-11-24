# VPS Deploy Runbook — canvix.app (132.226.127.65)

**Who runs this:** the maintainer (or an agent session holding the SSH key).
**State:** the deploy automation itself is ready; the ONLY missing piece is the SSH private key (see §1).

## 0. What is deployed where

| Piece | Value |
|---|---|
| Host | `132.226.127.65` (Oracle Cloud), user `ubuntu` |
| Auth | SSH key `oracle_vm1.key` (was uploaded to the sandbox at `/tmp/oracle_vm1.key` — `/tmp` is wiped on sandbox recycle, so it must be re-provided) |
| Site | https://canvix.app → this VPS |
| App | Next.js standalone build, local Postgres (`127.0.0.1`, database `canvix`) |
| Deploy pattern | build on the VPS from `main`, migrations via `prisma migrate deploy`, standalone snapshot + restore-on-failure (ROADMAP, 2026-11-07 hardening) |
| Helper scripts | `/home/z/my-project/scripts/vps.py` and `vps_ssh.py` (paramiko runners, key at `/tmp`) |

## 1. The one blocker

The sandbox that prepared this runbook lost the SSH key in a recycle (`/tmp/oracle_vm1.key` no longer exists; the key was never stored anywhere durable, by design). **To execute a deploy, re-attach the key** — either:

- upload it to the sandbox again (it will land in the upload dir and can be moved to `/tmp/oracle_vm1.key` for the helper scripts), or
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
# → must print EXACTLY:
# https://raw.githubusercontent.com/mir-ashiq/canvix/refs/heads/main/funding.json
```

If health fails or the site is down: restore the snapshot (`rm -rf .next/standalone && cp -a ~/standalone-backup-* .next/standalone`), restart, and investigate offline — the old build keeps serving.

## 5. Well-known activation (after §4 passes)

Once `https://canvix.app/.well-known/funding-manifest-urls` returns the exact manifest URL in production:

1. Edit `funding.json`: add `"wellKnown": "https://canvix.app/.well-known/funding-manifest-urls"` inside `projects[0].webpageUrl`.
2. Update the honesty guard in `src/lib/funding-manifest.test.ts` (the test that asserts `wellKnown` is *absent* — flip it to assert presence).
3. Commit, push, let CI re-validate, merge. The grants directory picks it up on its weekly manifest refresh.

This is the exact "remaining step" referenced in `docs/FUNDING-VALIDATION.md` §website — the ownership claim is deliberately withheld until the public URL actually serves the file.

## 6. Rollback

The snapshot in §3 plus `git reset --hard <previous-tag>` rebuilds the prior state; database migrations are additive (no destructive migration in this deploy). `prisma migrate deploy` is a no-op when already applied.
