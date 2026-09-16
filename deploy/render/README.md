# Render (Tier 1)

The root `render.yaml` Blueprint provisions an image-backed web service and a
private PostgreSQL 16 database. Render has no native object bucket in this
recipe, so provide a private S3-compatible store when Blueprint creation
prompts for the `sync: false` values.

## Install

Run `render blueprints validate render.yaml`, create/sync a Blueprint from this
repository, and enter `APP_URL`, a 64-hex-character `CREDENTIAL_KEY`, and every
S3 value. Render generates `SESSION_SECRET`; save both secrets in your recovery
secret manager before accepting real data.

## Operate

- Complete `verify.md` and the recipe's `verify` operation.
- Use `backup`/`restore` from a trusted workstation with the external database
  URL; use `pnpm media:transfer` for the bucket.
- Pin `image.url` to a release digest for production. `update` and `rollback`
  deploy explicit tags supplied in the recipe environment variables.
- Follow `migrate.md` and retain the source read-only until all invariants pass.
