<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Get started with Freeholder

Freeholder is in active development. The public demo is the fastest way to
explore it; a self-hosted instance is a single business on infrastructure you
control.

## Try it

Visit [the live example](https://demo.freeholder.ai/) and follow **Enter the
playground** to try the editor, products, forms and sample contacts. The
playground is shared and resets every hour. Use fictional information only.

## Run your own instance

The first beta uses the explicit npm `next` channel. Once its packages are
published, run `npx create-freeholder@next my-business`; check the
[release record](https://github.com/CampDenman/freeholder/releases) for public
availability. There is no stable release yet. To install from source now,
clone the [source repository](https://github.com/CampDenman/freeholder) and
use one of the maintained [deployment recipes](deploy/README.md). The
[DigitalOcean Droplet recipe](deploy/digitalocean-droplet/README.md) includes
server setup, object storage, backups and a restore rehearsal. The
[Docker Compose recipe](deploy/docker-selfhost/README.md) is a local or
self-hosted starting point.

For Docker Compose, have Docker, a private S3-compatible bucket and its scoped
credentials ready. From a fresh checkout:

```sh
git clone https://github.com/CampDenman/freeholder.git
cd freeholder
cp deploy/docker-selfhost/.env.example deploy/docker-selfhost/.env
# Fill POSTGRES_PASSWORD, BOOTSTRAP_SECRET, SESSION_SECRET, CREDENTIAL_KEY,
# APP_URL, and the S3 values in deploy/docker-selfhost/.env.
docker compose --env-file deploy/docker-selfhost/.env \
  -f deploy/docker-selfhost/infra/compose.yml up -d
```

Open the `APP_URL` you configured, visit `/setup`, and enter the bootstrap
secret from your `.env` file. The [recipe verification
guide](deploy/docker-selfhost/verify.md) covers health, storage, backup,
restore and updates. Keep the `.env` file out of version control.

The Compose recipe uses the current `edge` image by default. To run a build of
your own checkout, build a local image and put `FREEHOLDER_IMAGE=freeholder:local`
in `deploy/docker-selfhost/.env` before starting Compose:

```sh
docker build -t freeholder:local .
```

There is no stable tagged release yet. Review the [current project
status](MASTER.md#43-product-completion-plan--the-live-checklist) before
trusting an instance with business data.
