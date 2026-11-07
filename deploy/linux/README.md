# Linux server, no Docker (Tier 2)

Freeholder on one Ubuntu or Debian server: a release tarball that carries its
own Node.js runtime, PostgreSQL from the distribution, Caddy for automatic
HTTPS, and systemd. No Docker, Node, pnpm or source checkout on the server,
and no AI assistant needed. This is the WordPress-style install: download it,
run it, open the link.

## What you need

- A server running **Ubuntu 22.04 or newer, or Debian 12 or newer**, on x86_64
  or arm64, with root access over SSH. 2 GB of memory works while the site is
  small; 4 GB (2 vCPUs) is comfortable. Any provider works: DigitalOcean,
  Hetzner, Linode, Vultr, OVH, AWS Lightsail, a box under your desk.
- Ports 80 and 443 open to the internet (Caddy needs both for the
  certificate).
- Optionally, a domain. Without one, the site starts at a temporary
  `https://<ip>.sslip.io` address with a real certificate, and you move it to
  your domain later.

## Install

```sh
curl -fsSLO https://github.com/CampDenman/freeholder/releases/download/v0.2.0-beta.6/install.sh
less install.sh                      # optional: read what it does
sudo sh install.sh                   # asks for your domain; Enter = temporary address
```

`--domain example.com` skips the question. If that domain does not point at
the server yet, the installer starts on the temporary address and tells you the
command for later. It finishes in a few minutes and prints your private owner
claim link. Open it yourself, create the owner account and save the recovery
codes. Get the link again any time with `sudo freeholder claim-link`.

The installer, in order:

1. installs PostgreSQL (the distribution's package, or the official
   PostgreSQL apt repository when the distribution's is older than 15), Caddy
   (from Caddy's official apt repository), `curl` and `openssl`;
2. creates a `freeholder` system user;
3. downloads `freeholder-VERSION-linux-ARCH.tar.gz` from the GitHub release,
   checks it against the published `.sha256`, and unpacks it to
   `/opt/freeholder/releases/VERSION` with `/opt/freeholder/current` pointing
   at it;
4. runs `freeholder setup` from that release, which creates the database and
   role, writes `/etc/freeholder/freeholder.env` with secrets from
   `openssl rand -hex 32`, installs the systemd units and the nightly backup
   timer, writes `/etc/caddy/Caddyfile`, opens 80/443 if `ufw` is active, and
   starts everything.

Running it again is safe: secrets, data and settings are kept. To check what
you downloaded came from this repository's release workflow, run
`gh attestation verify freeholder-*.tar.gz --repo CampDenman/freeholder`.

## Where everything is

| Path | What |
|---|---|
| `/opt/freeholder/releases/VERSION` | Unpacked releases (root-owned, read-only to the app) |
| `/opt/freeholder/current` | Symlink to the running release |
| `/etc/freeholder/freeholder.env` | Settings and secrets (`root:freeholder`, mode 640) |
| `/var/lib/freeholder/media` | Uploaded media (local storage) |
| `/var/lib/freeholder/backups` | Nightly backups (root only) |
| `/etc/caddy/Caddyfile` | HTTPS proxy, rewritten by `freeholder setup` and `freeholder domain` |
| `freeholder.service`, `freeholder-backup.timer` | systemd units |

The app listens on `127.0.0.1:3000` only and PostgreSQL on localhost only;
Caddy is the only way in. Migrations run when the service starts, before it
reports ready.

## Day to day

```sh
sudo freeholder status        # service, database, HTTPS certificate, storage, backups
sudo freeholder logs          # follow the application log
sudo freeholder claim-link    # the owner claim link, until the owner exists
```

`freeholder status` is this recipe's health check (the Doctor): it needs no
Node, pnpm or checkout.

## Media storage: local disk or S3

By default uploaded media is stored on the server in
`/var/lib/freeholder/media` and served through Freeholder, which checks access
on every request (private galleries, paid files and trashed media stay
private). It is in every backup.

| | Local disk (default) | S3-compatible bucket |
|---|---|---|
| Setup | Nothing to do | Create a private bucket and a key scoped to it |
| Cost | Server disk | A few dollars a month |
| Survives losing the server | Only through your backups, so copy them off the server | Yes, media lives elsewhere |
| More than one app server | No | Yes |
| Large uploads | Through the app | Direct, resumable browser uploads |

To start with S3: `sudo sh install.sh --storage s3` (it asks for the endpoint,
region, bucket and key). To move an existing site to S3 later, copy the media
directory to the bucket with the same paths
(`rclone copy /var/lib/freeholder/media remote:bucket`), then run
`sudo freeholder setup --storage s3`.

## Backups and restore

`freeholder-backup.timer` runs `freeholder backup` every night at about 03:15
server time. Each backup is a directory in `/var/lib/freeholder/backups`:

- `database.dump`: the whole database (`pg_dump` custom format);
- `media.tar.gz`: the media directory (local storage only);
- `RELEASE.json`, `BACKUP`: the version and why it was taken;
- `SHA256SUMS`: checked before any restore.

The newest 14 are kept (`BACKUP_KEEP` in the env file). Backups do not contain
`/etc/freeholder/freeholder.env`; keep a copy of it somewhere safe once,
because `CREDENTIAL_KEY` is needed to read stored provider credentials.

**Keep a copy off the server.** A backup on the same disk does not survive
losing the server. Install `rclone`, configure a remote (`rclone config`, for
example an S3-compatible bucket), and set `BACKUP_RCLONE_REMOTE=remote:bucket/path`
in `/etc/freeholder/freeholder.env`; every backup is then copied there too.

Restore:

```sh
sudo ls /var/lib/freeholder/backups
sudo freeholder restore latest            # or a directory name from the list
```

It verifies the checksums, takes a safety backup of the current data, restores
the database into a scratch database and swaps it in (the replaced one is kept
as `freeholder_previous`), restores the media (the replaced directory is kept
as `/var/lib/freeholder/media.previous`), restarts and waits until the site is
ready. To restore on a new server, install Freeholder there, copy the old
`freeholder.env` secrets you kept (at least `CREDENTIAL_KEY`) into the new
`/etc/freeholder/freeholder.env`, copy the backup directory over, and run
`sudo freeholder restore /path/to/it`.

## Updates

```sh
sudo freeholder update latest       # or: sudo freeholder update 0.2.0-beta.6
sudo freeholder rollback            # undo the last update
```

`update` downloads the release, checks its SHA-256, unpacks it beside the
current one, takes a backup, switches `current`, restarts and waits for
`/api/health`. If the new release does not become ready it switches back and
restores the database from that pre-update backup, because the new release
may already have migrated it. `rollback` does the same on request. The three
newest releases are kept. Release notes are on the
[releases page](https://github.com/CampDenman/freeholder/releases).

## Moving to your real domain

Point the domain's `A` record at the server, wait until `dig +short
example.com` shows its address, then:

```sh
sudo freeholder domain example.com
```

Passkeys belong to the address they were created on. After the move, sign in
with your password at the new address and add a passkey again under
Settings → Security.

## Removing it

```sh
sudo systemctl disable --now freeholder freeholder-backup.timer
sudo rm -rf /opt/freeholder /etc/freeholder /etc/systemd/system/freeholder*.service \
  /etc/systemd/system/freeholder-backup.timer /usr/local/bin/freeholder
sudo -u postgres dropdb freeholder; sudo -u postgres dropuser freeholder
# Your data and backups stay in /var/lib/freeholder until you delete it.
```

## Building the tarball yourself

From a checkout on Linux of the architecture you want:
`pnpm install --frozen-lockfile && pnpm build && pnpm release:build`. It writes
`dist/release/freeholder-VERSION-linux-ARCH.tar.gz`, its `.sha256` and
`install.sh`; install it with `sudo sh install.sh --tarball FILE`.
