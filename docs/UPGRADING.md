# Upgrading & rolling back a self-hosted Canvix

Canvix ships as one Next.js app plus one Postgres database, and every
release is designed to upgrade with **one migration command**. This
guide covers the routine path, jumping minors, and — the part most
guides skip — how to roll back, with the honest database caveat.

## How releases work

- Versions are semver-ish patch streams (`0.11.0 → 0.11.8 → 0.12.0 …`);
  every change lands on `main` through a PR and is documented in
  `CHANGELOG.md` with the version it shipped in.
- Database changes ship as **forward-only Prisma migrations**
  (`prisma/migrations/…`). They are cumulative: a fresh checkout of any
  version can build the complete schema from zero (`npm run db:setup`).
- The app never reads a schema that is older than its migrations, and
  migrations never drop user data (additive columns are nullable, data
  backfills live inside the migration SQL).

## The routine upgrade (any version → next)

```bash
# 1. snapshot first — see docs/BACKUP-AND-RESTORE.md
pg_dump "$DATABASE_URL" -Fc -f /var/backups/canvix/pre-upgrade-$(date +%Y%m%d).dump

# 2. fetch the new code (however you deploy: git pull, new image, new checkout)
git pull --ff-only

# 3. dependencies (postinstall runs prisma generate + the wasm patch)
npm ci

# 4. apply migrations — idempotent, skips already-applied ones
npm run db:migrate:deploy

# 5. rebuild + restart (Node standalone shown; same idea on every host)
npm run build && npm start

# 6. verify
curl -s your-host/api/health   # → {"ok": true, ...}
```

Downtime = the restart (seconds). The migration step is safe to run
while the old app is still serving: pending migrations are additive,
so the old version keeps working against the migrated schema.

## Jumping minors (e.g. 0.11.8 → 0.12.x)

Same six steps — nothing extra. Things worth knowing:

- **You do not need to stop at intermediate versions.** Migrations are
  cumulative; `db:migrate:deploy` takes you from whatever you have to
  the checkout's schema, applying only the missing ones.
- **Read the CHANGELOG entries you are crossing** for env-var
  additions (they are always optional-with-defaults — e.g. v0.12.3's
  rate limits work with zero configuration) and deploy-size notes
  (v0.9.4 shrank the traced bundle; if you ship to Netlify's 50 MB
  limit, crossing that version changes your artifact size for the
  better).
- **`npm run db:setup` is for fresh databases** (migrate + seed the
  110 templates). On an existing database use `db:migrate:deploy` —
  setup would also re-seed templates that already exist (harmless but
  noisy).
- The template library ships as code; upgrading may add new templates
  via the seed. Existing designs are never touched by an upgrade.

## Rolling back

**App rollback is easy:** redeploy the previous build (git checkout
the previous commit, `npm ci && npm run build && npm start`, or point
your platform at the previous deployment). The previous version runs
fine against a *not-newer* schema.

**The honest database caveat:** Prisma migrations are forward-only —
there is no generated `down`. Two rollback situations:

1. **You upgraded the code but migrations have not run yet** (step 4
   pending): just redeploy the old build. Nothing changed in the DB.
2. **Migrations ran**: the safe path is *restore-forward*, not
   schema-revert:
   ```bash
   # restore the pre-upgrade backup into a FRESH database (tested
   # procedure: docs/BACKUP-AND-RESTORE.md)
   createdb "$RESTORE_TARGET" && pg_restore --no-owner --no-privileges \
     -d "$RESTORE_TARGET" /var/backups/canvix/pre-upgrade-YYYYMMDD.dump
   # repoint DATABASE_URL at it, restart the old build
   ```
   You lose writes made between the backup and the rollback — that is
   the RPO of your backup schedule, stated plainly. If the failing
   change is confined to code (most are), roll the code back and leave
   the migrated schema alone: migrations in the 0.9–0.12 range are
   additive (nullable columns, new tables), so older code simply
   ignores them.

Never hand-edit the schema or the `_prisma_migrations` table to
"un-migrate" — a hand-crafted reverse migration is the one move that
can actually lose data.

## Choosing what to run

| Deployment | Notes |
|---|---|
| Node standalone (`output: "standalone"`) | `npm run build && npm start` — the reference target |
| Vercel / Netlify / Cloudflare Workers | Platform rebuilds from the repo; set `DATABASE_URL`, run `db:migrate:deploy` once per upgrade from anywhere with DB access (CI step, your laptop) |
| Docker | Rebuild the image; run the migration as a one-off container before swapping |

## Quick reference

```bash
npm run db:migrate:deploy   # apply pending migrations (idempotent)
npm run db:setup            # fresh database only: migrate + seed templates
pg_dump "$DATABASE_URL" -Fc -f backup.dump    # pre-upgrade snapshot
npx tsx scripts/media-gc.ts # space check (report only)
```
