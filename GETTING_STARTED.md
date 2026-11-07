<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Get started with Freeholder

Freeholder is in active development. The public demo is the fastest way to
explore it; a self-hosted instance is a single business on infrastructure you
control.

## Install on your own server (no AI, no Docker needed)

On a fresh Ubuntu 22.04+ or Debian 12+ server (2 GB of memory or more, ports
80 and 443 open), as a user who can `sudo`:

```sh
curl -fsSLO https://github.com/CampDenman/freeholder/releases/download/v0.2.0-beta.5/install.sh
sudo sh install.sh                 # type your domain, or press Enter for a temporary https://<ip>.sslip.io address
sudo freeholder claim-link         # open this link yourself and create your owner account
sudo freeholder status             # health, HTTPS certificate, storage and backups
```

When your domain's `A` record points at the server, move the site to it with
`sudo freeholder domain example.com`.

The installer sets up PostgreSQL, Caddy (automatic HTTPS) and systemd, and
installs a release tarball that carries its own Node.js runtime, after
checking its SHA-256. Media is stored on the server and included in a nightly
backup of the database and media; `sudo freeholder restore latest` restores
it, and `sudo freeholder update latest` updates with automatic rollback. You
can read `install.sh` before running it; [`deploy/linux/README.md`](deploy/linux/README.md)
lists every file it creates, the S3 storage option, offsite backup copies and
how to remove it. Any provider's server works. Docker is an
[optional alternative](deploy/docker-selfhost/README.md).

## Try it

Visit [the live example](https://demo.freeholder.ai/) and follow **Enter the
playground** to try the editor, products, forms and sample contacts. The
playground is shared and resets every hour. Use fictional information only.

## Launch with your coding agent

For Replit, [import Freeholder](https://replit.com/github.com/CampDenman/freeholder)
and follow the [agent launch guide](deploy/agent-launch.md). It includes a prompt
for provisioning PostgreSQL and private Object Storage, one-command credential
preparation, owner passkey setup, and connecting Replit Agent through MCP.

For Lovable, use that guide to connect a separately hosted Freeholder and build
a new interface against its MCP/API. Lovable does not import this existing
repository, and its chat connector does not become your app's runtime backend.

After owner setup, open **Settings → Connect your assistant** (`/admin/connect`)
to choose permissions, create an expiring connection and test its MCP tools.
Keep the owner password, passkeys and recovery codes with the owner.

## Run your own instance

Beta packages are published to npm under the `next` tag:
`npx create-freeholder@next my-business`. The
[release record](https://github.com/CampDenman/freeholder/releases) lists each
beta. There is no stable release yet. Every recipe is in
[`deploy/README.md`](deploy/README.md).

**What it needs.** Freeholder is one application plus one PostgreSQL database.
Measured on the reference site, the application uses about 520 MB of memory
and the database about 500 MB, so plan for a server with 2 vCPUs and 4 GB of
memory (about US$24/month on DigitalOcean). A 2 GB server works while the
database stays small. Below that, Postgres has too little room. The release
tarball is about 90 MB and the container image about 760 MB. Most owners run
it on a server or a hosting platform rather than on their own computer, so the
size of your laptop does not matter for running a site.

- **Your own server, no Docker:** the block at the top of this page, and
  [`deploy/linux/README.md`](deploy/linux/README.md).
- **Your own server, with Docker:** [`deploy/docker-selfhost/README.md`](deploy/docker-selfhost/README.md).
  It needs only Docker: a shell script generates the secrets, media can stay
  on a Docker volume, and a nightly backup runs inside Compose.
- **DigitalOcean in one command:** the
  [Droplet recipe](deploy/digitalocean-droplet/README.md) includes server setup,
  object storage, backups and a restore rehearsal.

There is no stable tagged release yet. Review the [current project
status](MASTER.md#43-product-completion-plan--the-live-checklist) before
trusting an instance with business data.
