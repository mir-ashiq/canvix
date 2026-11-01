# Backup & restore — the tested drill

Canvix keeps **everything** in one Postgres database: designs (jsonb
pages), accounts and sessions, comments, version snapshots, the
template library — and **uploaded audio/video, as `bytea`**. One
`pg_dump` therefore captures the entire instance. There is no object
storage, no secondary state, nothing else to back up (unless you count
`.env`, which you should also keep a copy of — it holds your
`DATABASE_URL` and any AI/MCP keys).

This guide documents a restore drill **actually executed and verified**
(the output below is real, not illustrative): dump → scratch database →
restore → row/byte-level count verification → boot the app against the
restored database. The drill ran against PostgreSQL 18 on a development
instance; on a hosted database (Supabase, Neon, RDS…) only the
connection flags change — the steps and the verification are identical.

> **When to read this:** before your first production-ish deployment,
> and every time you change backup schedules. A backup that has never
> been restored is a hope, not a backup.

---

## 1. Back up

```bash
# custom format: compressed, pg_restore-able, selective restore possible
pg_dump "$DATABASE_URL" -Fc -f canvix-backup-$(date +%Y%m%d).dump
```

Notes that matter:

- **The `bytea` media travels inside the dump.** A design-heavy or
  media-heavy instance produces a proportionally large dump — media is
  capped at 32 MB per file by default (`CANVIX_MAX_MEDIA_MB`), but
  hundreds of uploads add up. Check the dump size before assuming a
  schedule is fine; a daily full dump is the right cadence for a
  single-instance self-host.
- **Supabase**: use the **session/direct connection** for `pg_dump`,
  not the transaction pooler port 6543 (pg_dump needs session-level
  features the pooler does not pass through). The direct port is
  5432, or the *session* pooler (`:5432`-style `pooler.supabase.com`
  URL with `pgbouncer=false`). Plain `pg_dump` with the connection
  string from the dashboard works when the host has an IPv6 route;
  otherwise use the session pooler.
- Verify a dump non-destructively any time:

  ```bash
  pg_restore --list canvix-backup-20261101.dump | head
  ```

## 2. Restore into a scratch database (the drill)

Never test a restore over your live database. The drill, exactly as
executed:

```bash
# 1. dump the source
pg_dump -h localhost -p 5433 -U canvix -Fc -f canvix-backup-20261101.dump canvix
# → 753 KB for a dev instance (167 designs, 110 templates, 30 media)

# 2. create the scratch target
createdb -h localhost -p 5433 -U canvix canvix_restore_drill

# 3. restore — cross-owner safe flags
pg_restore -h localhost -p 5433 -U canvix -d canvix_restore_drill \
  --no-owner --no-privileges canvix-backup-20261101.dump
# → exit 0
```

`--no-owner --no-privileges` matter when the restoring role differs
from the dumping role (typical when moving between hosts: dump as
`postgres`, restore as `postgres` on Supabase).

## 3. Verify (counts + bytes)

```sql
-- run against BOTH databases; every line must match
SELECT 'designs='   || COUNT(*) FROM "Design" UNION ALL
SELECT 'users='     || COUNT(*) FROM "User" UNION ALL
SELECT 'templates=' || COUNT(*) FROM "Template" UNION ALL
SELECT 'media='     || COUNT(*) || ' (' || COALESCE(SUM(size),0)/1024 || ' KB)' FROM "Media" UNION ALL
SELECT 'events='    || COUNT(*) FROM "DesignEvent" UNION ALL
SELECT 'comments='  || COUNT(*) FROM "Comment";
```

Drill output (source vs restored — identical, including media bytes):

```
[canvix]                 [canvix_restore_drill]
 designs=167              designs=167
 users=0                  users=0
 templates=110            templates=110
 media=30 (3756 KB)       media=30 (3756 KB)
 events=13                events=13
 comments=0               comments=0
```

The `Media` line is the one to watch: `SUM(size)` proves the bytea
payloads restored at full length, not just the row count.

## 4. Boot the app against the restored database

```bash
DATABASE_URL=postgresql://…canvix_restore_drill npm run dev   # or your prod start
curl -s localhost:3000/api/health
```

Drill output — the app declares the restored database healthy and
serves its designs:

```json
{
  "ok": true,
  "database": { "kind": "local", "host": "localhost", "database": "canvix_restore_drill" },
  "templates": 110
}
```

```
GET /api/designs → 60 designs on page 1 (keyset pagination), first:
"v0110 browser smoke"
```

Then drop the scratch database (`dropdb … canvix_restore_drill`) — or,
in a real recovery, point production at the restored database instead.

## 5. Restoring over the live database (actual recovery)

1. Stop the app (or put it behind a maintenance page).
2. Back up the current database first (`pg_dump` again) — you want the
   pre-recovery state for forensics.
3. Restore. Two options:
   - **Same database**: `psql "$DATABASE_URL" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'` then `pg_restore --no-owner --no-privileges -d "$DATABASE_URL" backup.dump`.
     (Supabase: do NOT drop the schema you are connected through the
     dashboard — use a connection to `postgres` or a fresh database.)
   - **Fresh database** (safer, zero-downtime-ish): `createdb`, restore,
     then repoint `DATABASE_URL` and restart the app. Verified above.
4. `curl -s your-host/api/health` until `ok: true`.
5. Spot-check a design, a media element (play an uploaded video), and a
   login.

## 6. Scheduled backups (example)

```cron
# /etc/cron.d/canvix-backup — daily 03:15, keep 14 days
15 3 * * * canvix pg_dump "$DATABASE_URL" -Fc -f /var/backups/canvix/canvix-$(date +\%Y\%m\%d).dump
25 3 * * * canvix find /var/backups/canvix -name 'canvix-*.dump' -mtime +14 -delete
```

Offsite: sync the dump directory to any object storage (`rclone`,
`aws s3 sync`). Because everything is one dump file, a restore needs
nothing but the newest file and a fresh database.

## 7. Media orphan GC (companion)

Deleted designs leave their uploaded media behind (deletes remove the
element JSON, not the media row — intentional, media may be shared by
version snapshots). Reclaim space periodically:

```bash
DATABASE_URL=… npx tsx scripts/media-gc.ts          # report only
DATABASE_URL=… npx tsx scripts/media-gc.ts --prune  # actually delete
GRACE_DAYS=30 npx tsx scripts/media-gc.ts --prune   # keep 30d of orphans
```

The script removes never-finalized uploads older than 24 h and
finalized uploads past the grace period whose id no design references
(verified by a drill that plants one orphan + one referenced row and
asserts exactly the orphan is pruned). Cron it next to the backup.
