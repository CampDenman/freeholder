# Tier-1 migration runbook

This is the shared procedure for all 30 directed moves among Replit,
DigitalOcean App Platform, a DigitalOcean Droplet, Railway, Render and Docker
self-hosting. The database and media formats are provider-neutral; the source
and target recipe only change how credentials and commands are obtained.

## What must survive

The acceptance invariants are **ids**, **money**, **timestamps**, **media**,
**locales** and **public-urls**. The CI ownership drill restores a custom-format
PostgreSQL archive for every directed pair, fingerprints every application
table, and generates the logical ownership export plus media inventory from
each restore. The operator verifies the object bytes and public URL after the
platform move.

## 1. Prepare and rehearse

1. Upgrade the source to a release supported by the target recipe.
2. Run Doctor and resolve every failure.
3. Protect `CREDENTIAL_KEY`, `SESSION_SECRET` and provider credentials in a
   secret manager. They are intentionally absent from the ownership export.
4. Create a disposable restore database and run `pnpm ownership:drill` against
   it before scheduling downtime.
5. Provision the target with its `recipe.yaml` `install` operation. Do not
   point public DNS at it yet.

## 2. Quiesce and export the source

Put the source behind a maintenance response or otherwise stop writes. Record
the UTC start time. Keep the old instance and bucket intact until final signoff.

```bash
pg_dump --format=custom --no-owner --no-privileges \
  --file freeholder.dump "$SOURCE_DATABASE_URL"
EXPORT_DATABASE_URL="$SOURCE_DATABASE_URL" pnpm ownership:export -- \
  --output ownership-export
```

Verify `ownership-export/manifest.json` and `checksums.sha256`. Its
`media-manifest.json` is the authoritative key list. Copy each listed object
from the source store to the target store; use the source and target provider's
S3/rclone tooling or `scripts/media-transfer.mjs`. Never use a public bucket as
an intermediate.

`pnpm media:transfer -- --manifest ownership-export/media-manifest.json`
accepts `SOURCE_STORAGE` and `TARGET_STORAGE` as `s3` or `replit`. For an S3
side, set the correspondingly prefixed `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`,
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and optional
`S3_ADDRESSING_STYLE=virtual`. For a Replit side, set the prefixed
`REPLIT_BUCKET_ID`. For example, an S3-to-Replit move uses
`SOURCE_STORAGE=s3`, `SOURCE_S3_*`, `TARGET_STORAGE=replit` and
`TARGET_REPLIT_BUCKET_ID`. The command refuses an incomplete inventory and
reads back every target object to compare size and SHA-256 before succeeding.

## 3. Restore the target

Restore into an empty target database. Migrations may run when the target app
first boots, but they are not a substitute for restoring the owned data.

```bash
pg_restore --no-owner --no-privileges \
  --dbname "$TARGET_DATABASE_URL" freeholder.dump
```

Set the target's `APP_URL` to the final public origin. Keep the same
`CREDENTIAL_KEY` so encrypted connected-account credentials remain readable.
Use a new `SESSION_SECRET` only if signing every user out is intentional.

## 4. Verify before DNS

Run the target recipe's `verify` operation against its temporary platform URL.
Then compare the source ownership export with a target export:

```bash
EXPORT_DATABASE_URL="$TARGET_DATABASE_URL" pnpm ownership:export -- \
  --output target-ownership-export
```

The following must match:

- every table row count and SHA-256 fingerprint (ids, money and timestamps);
- the locale set and every stored public path/slug (locales and public-urls);
- media asset IDs, keys, sizes and checksums, with no missing or unreferenced
  keys in the media inventory (media);
- a browser request for `/`, `/setup` or `/admin` as appropriate, and an actual
  upload/read/delete cycle through the target object store.

Do not continue if any comparison differs. Resume the source, investigate and
repeat the final export.

## 5. Cut over and roll back

Lower DNS TTL in advance. Change DNS only after verification, keep the source
read-only, and monitor health, authentication, writes, jobs and media. Expected
application downtime is the final dump/restore window; DNS caches can extend
visible cutover time.

Rollback means restoring DNS to the still-read-only source. If the target has
accepted writes, stop both sides and reconcile those writes before rollback;
never let two writable instances diverge. Retain the old database and bucket
for the documented recovery window, then revoke old credentials and remove
them according to the source provider's deletion procedure.

## Pair matrix

Each source row is tested against every other target column by
`pnpm ownership:drill -- --all-pairs`:

| Source | Valid targets |
| --- | --- |
| Replit | DigitalOcean App, DigitalOcean Droplet, Railway, Render, Docker |
| DigitalOcean App | Replit, DigitalOcean Droplet, Railway, Render, Docker |
| DigitalOcean Droplet | Replit, DigitalOcean App, Railway, Render, Docker |
| Railway | Replit, DigitalOcean App, DigitalOcean Droplet, Render, Docker |
| Render | Replit, DigitalOcean App, DigitalOcean Droplet, Railway, Docker |
| Docker | Replit, DigitalOcean App, DigitalOcean Droplet, Railway, Render |
