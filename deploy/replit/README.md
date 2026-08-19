# Replit (Tier 1)

Fork the template, hit Run, walk through `/setup`. Media must live in Replit
Object Storage. A sleeping workspace is not production — use a Deployment.

## Install

1. Fork the Freeholder Replit template.
2. Add `DATABASE_URL`, `SESSION_SECRET`, `CREDENTIAL_KEY`, `APP_URL`.
3. Run. Open `/setup`.

## Verify

See `verify.md`. Doctor must be green.

## Backup / restore

Use `pnpm ownership:export` plus a Postgres dump. Restore into a scratch
database before trusting the backup.

## Update / rollback

Redeploy the published image tag. Rollback is pinning the previous `sha-` tag.

## Migrate

See `migrate.md` for every Tier-1 pair.
