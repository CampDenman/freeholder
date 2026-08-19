# DigitalOcean App Platform (Tier 1)

Managed web + optional worker + managed Postgres + Spaces.

## Install

```bash
doctl apps create --spec deploy/digitalocean-app/infra/app.yaml
```

Set `DATABASE_URL`, `SESSION_SECRET`, `CREDENTIAL_KEY`, `APP_URL`, and Spaces keys.

## Verify / backup / update

See `verify.md`. Backup is `pg_dump` of the managed database plus the Spaces
bucket. Update is an image swap; rollback pins the previous tag.
