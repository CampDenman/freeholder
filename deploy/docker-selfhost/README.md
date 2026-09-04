# Docker Compose (Tier 1)

This recipe runs the published image and PostgreSQL 16. Production media must
use a private S3-compatible store; local disk is not a durable Tier-1 target.

## Install

Copy `deploy/docker-selfhost/.env.example` to
`deploy/docker-selfhost/.env`, fill every required value, then run the
`install` operation in `recipe.yaml`. Compose waits for PostgreSQL health,
restarts both services, and exposes only the app on port 3000.

Generate independent URL-safe values for `POSTGRES_PASSWORD` and
`SESSION_SECRET`; for example, run
`node -e "console.log(crypto.randomBytes(32).toString('hex'))"` once for each.
Compose refuses to start when the database password is empty.

## Operate

- Use `verify.md` plus the recipe's `verify` command after each change.
- Use `backup` and `restore` for the database and `pnpm media:transfer` for
  object bytes. Rehearse restore into a scratch database.
- Set `FREEHOLDER_IMAGE` to a digest, run `update`, and retain the former digest
  as `PREVIOUS_FREEHOLDER_IMAGE` for `rollback`.
- Use `migrate.md` for any provider move. Never use `.env.example` as a live
  environment file.
