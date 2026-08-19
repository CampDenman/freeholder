# Railway (Tier 1)

One service from `ghcr.io/campdenman/freeholder` plus Railway Postgres and an
S3-compatible bucket.

## Install

Create a project, add Postgres, set the env from `.env.example`, deploy the
image. Open `/setup`.

## Verify / backup / update

See `verify.md`. Backup is `pg_dump` plus the bucket. Update is an image swap.
