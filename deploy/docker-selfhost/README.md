# Docker Compose (Tier 1)

This recipe runs the published image and PostgreSQL 16. Production media must
use a private S3-compatible store; local disk is not a durable Tier-1 target.

Two Compose files, one project:

- `infra/compose.yml` serves plain HTTP on port 3000, for your own machine
  (`http://localhost:3000`).
- `infra/compose.https.yml` puts Caddy in front with automatic HTTPS from
  Let's Encrypt, for a public host. Owner passkeys only work over HTTPS (or on
  localhost), so a public site uses this file. The app port is not published;
  Caddy is the only way in.

Both files live in `infra/`, so they share one Compose project and database
volume: moving from one to the other keeps your data.

## Install

From the repository root, prepare the private configuration:

```sh
pnpm launch:prepare --target docker-selfhost --url https://YOUR-DOMAIN --json
# or, on your own machine: --url http://localhost:3000
```

This writes `deploy/docker-selfhost/.env` (mode 600), where Compose reads it.
It generates independent `BOOTSTRAP_SECRET`, `SESSION_SECRET`,
`CREDENTIAL_KEY` and `POSTGRES_PASSWORD` values, and sets `FREEHOLDER_DOMAIN`
from an HTTPS URL. It preserves values already there on a rerun, and writes the
owner claim link to `.freeholder-launch/claim-link.txt` (mode 600). It prints
only a redacted report. Exit 2 means something is still missing, usually the
S3 bucket values: add `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`,
`S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` to that file and rerun.
`DATABASE_URL` is not needed: Compose runs PostgreSQL and builds it from
`POSTGRES_PASSWORD`.

To fill the file by hand instead, copy `.env.example` to
`deploy/docker-selfhost/.env` and generate each secret with
`node -e "console.log(crypto.randomBytes(32).toString('hex'))"`. Compose
refuses to start while `POSTGRES_PASSWORD` is empty.

Then start the stack with the report's `startCommand`, which is the
recipe's `install-https` operation for an HTTPS URL and `install` for
localhost:

```sh
# Public host: point the domain's A record here and open ports 80 and 443 first.
docker compose --env-file deploy/docker-selfhost/.env -f deploy/docker-selfhost/infra/compose.https.yml up -d
# Your own machine:
docker compose --env-file deploy/docker-selfhost/.env -f deploy/docker-selfhost/infra/compose.yml up -d
```

Always pass `--env-file deploy/docker-selfhost/.env`: the services'
`env_file` does not supply values for `${POSTGRES_PASSWORD}` or
`${FREEHOLDER_DOMAIN}` interpolation. Compose waits for PostgreSQL health and
restarts the services.

Open the private claim link yourself, create your passkey and save the
recovery codes. Then issue any assistant's key at `/admin/connect`.

## Operate

- With HTTPS, use `infra/compose.https.yml` in place of `infra/compose.yml`
  in every operation below and in `recipe.yaml`.
- Use `verify.md` plus the recipe's `verify` command after each change.
- Use `backup` and `restore` for the database and `pnpm media:transfer` for
  object bytes. Rehearse restore into a scratch database.
- Set `FREEHOLDER_IMAGE` to a digest, run `update`, and retain the former digest
  as `PREVIOUS_FREEHOLDER_IMAGE` for `rollback`.
- Use `migrate.md` for any provider move. Never use `.env.example` as a live
  environment file.
