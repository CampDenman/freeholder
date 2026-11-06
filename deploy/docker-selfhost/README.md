# Docker Compose (Tier 1)

This recipe runs the published release image, PostgreSQL 16 and a nightly
backup service with Docker Compose. The host needs only Docker (with the
Compose plugin), `openssl` and `curl`: no Node, pnpm or `pnpm install`.

Prefer no Docker at all? [`../linux/README.md`](../linux/README.md) installs
the same release natively on Ubuntu or Debian.

Two Compose files, one project:

- `infra/compose.https.yml` puts Caddy in front with automatic HTTPS from
  Let's Encrypt, for a public server. Owner passkeys need HTTPS, so a public
  site uses this file. The app port is not published; Caddy is the only way
  in.
- `infra/compose.yml` serves plain HTTP on port 3000, for your own machine
  (`http://localhost:3000`).

Both live in `infra/`, so they share one Compose project and its volumes:
moving from one to the other keeps your data.

## Install

On a server with Docker and ports 80 and 443 open:

```sh
git clone --depth 1 --branch v0.2.0-beta.4 https://github.com/CampDenman/freeholder.git
cd freeholder
deploy/docker-selfhost/selfhost.sh prepare        # or: prepare --domain example.com
deploy/docker-selfhost/selfhost.sh start          # prints your private claim link
```

`prepare` writes `deploy/docker-selfhost/.env` (mode 600) with
`POSTGRES_PASSWORD`, `BOOTSTRAP_SECRET`, `SESSION_SECRET` and `CREDENTIAL_KEY`
from `openssl rand -hex 32`, `APP_URL`, `FREEHOLDER_DOMAIN`, the release image
(`FREEHOLDER_IMAGE=ghcr.io/campdenman/freeholder:VERSION`, this checkout's
release, never `edge`) and `FREEHOLDER_STORAGE=local`. Rerunning keeps existing
values. Without `--domain` it uses a temporary `https://<ip>.sslip.io`
address, so you can start before DNS is ready; later run
`prepare --domain example.com` and `start` again. Passkeys belong to the
address they were made on, so add one again after the move. On your own
machine use `prepare --localhost`.

`start` pulls the image, starts the stack, waits for the site and prints the
claim link. Open it yourself, create the owner account and save the recovery
codes. `selfhost.sh claim-link` prints it again.

`pnpm launch:prepare --target docker-selfhost --url https://YOUR-DOMAIN` still
writes the same `.env` from a checkout with Node and pnpm.

## Media: Docker volume or S3

By default media lives on the Compose `media` volume, mounted at
`/var/lib/freeholder/media` and served through the app with the same access
checks as every other storage (`LOCAL_STORAGE_ROOT`). It survives image
updates and container rebuilds, and it is in every backup. It does not
survive losing the server unless the backups were copied off it, and a second
app server cannot share it.

For S3-compatible storage instead, run `prepare --storage s3` and add
`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and
`S3_SECRET_ACCESS_KEY` to the `.env`. To move existing media to a bucket, copy
the volume's files to it with the same paths, then switch.

## Backups and restore

The `backup` service backs up every night at 03:15 UTC (`BACKUP_HOUR_UTC`)
into the `backups` volume: `database.dump` (`pg_dump` custom format),
`media.tar.gz` and `SHA256SUMS` per backup, newest 14 kept (`BACKUP_KEEP`).

```sh
deploy/docker-selfhost/selfhost.sh backup          # one now
deploy/docker-selfhost/selfhost.sh backups         # list them
deploy/docker-selfhost/selfhost.sh restore latest  # or a name from the list
```

Restore verifies the checksums, takes a safety backup, stops the app, restores
into a scratch database and swaps it in (the replaced one is kept as
`freeholder_previous`), restores the media volume and starts the app. Copy
backups off the server, for example
`docker run --rm -v infra_backups:/b alpine tar -C /b -c . | ssh other-host 'cat > backups.tar'`
(the Compose project is named after the `infra` directory; `docker volume ls`
shows the volumes). Keep a
copy of `.env` too: `CREDENTIAL_KEY` is not in the backup.

## Operate

```sh
deploy/docker-selfhost/selfhost.sh check           # containers healthy, /api/health over HTTPS, latest backup
deploy/docker-selfhost/selfhost.sh update 0.2.0-beta.5   # back up, switch image, roll back if unhealthy
deploy/docker-selfhost/selfhost.sh logs
```

`check` is this recipe's Docker-only health check. `update` backs up first and
keeps the old image as `PREVIOUS_FREEHOLDER_IMAGE`; if the new image is not
healthy it switches back (restore the pre-update backup if that release had
already migrated the database). Update the checkout to the same tag
(`git fetch --depth 1 origin tag vVERSION && git checkout vVERSION`) so the
Compose files match the image. Use `migrate.md` for a provider move. Never use
`.env.example` as a live environment file.
