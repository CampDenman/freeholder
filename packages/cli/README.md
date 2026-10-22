<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# `freeholder update` and `freeholder launch`

Check, preflight, apply and roll back a [Freeholder](https://github.com/CampDenman/freeholder)
instance from a terminal or a cron job.

```sh
npm install -g @freeholder/cli@next

freeholder update --check
freeholder update --preflight
freeholder update --apply
freeholder update --rollback
freeholder update            # status, the default
```

This is a thin client, not a second implementation. The update logic lives in
the instance, because only the instance knows its own database, adapters and
deploy target. This establishes an authenticated caller and prints what the
platform says.

## Connecting

```sh
freeholder update --url https://example.com --api-key fh_...
FREEHOLDER_URL=... FREEHOLDER_API_KEY=... freeholder update --check
```

`--email` / `--password` also work, with `--totp-secret` when the owner is
enrolled in two-factor. **In cron, use a scoped API key** — reading update
status and applying an update are separate scopes, so a monitoring key does
not have to be able to cut a site over.

## Exit codes

Meant for a crontab and a monitor:

| Code | Means |
|---|---|
| `0` | Up to date, or the action succeeded |
| `1` | An update is available and was not applied |
| `2` | A security release is outstanding, or an action failed |
| `3` | The instance could not be reached or would not authenticate |

`1` and `2` are separate on purpose. A monitor should be able to page on *"a
security release is outstanding"* without also paging every time a feature
release ships — an operator who collapses those into one alert learns to
ignore both.

An instance that has simply never checked exits `0`. The first cron run
resolves that on its own, and exiting non-zero would make every fresh install
look broken.

`--json` prints the raw service response for anything that consumes it;
`--quiet` suppresses the status summary.

## `freeholder launch`

Stand up a new hosted Freeholder site with one command, ending in a one-click
owner claim link. DigitalOcean first: a droplet running the
[`digitalocean-droplet` recipe](https://github.com/CampDenman/freeholder/tree/main/deploy/digitalocean-droplet),
with media and nightly backups in Spaces.

```sh
export DIGITALOCEAN_TOKEN=...      # or rely on your current `doctl` context
freeholder launch --provider digitalocean --domain example.com --dry-run
freeholder launch --provider digitalocean --domain example.com
```

It checks the account, SSH key, region and size; creates `<name>-media` and a
versioned `<name>-backups` bucket with a key scoped to just those two; creates
an Ubuntu 24.04 droplet from the recipe's cloud-init and waits until it has
really finished; generates `BOOTSTRAP_SECRET`, `SESSION_SECRET`,
`CREDENTIAL_KEY` and `POSTGRES_PASSWORD`; installs and starts the stack;
waits until `/setup` answers over a valid certificate; schedules nightly
backups and confirms a first one; and prints
`https://<host>/setup#claim=…`. The owner opens that once and chooses their
own email and password or passkey; the CLI never creates the owner.

| Flag | Default | |
|---|---|---|
| `--domain` | (required) | The site's domain |
| `--name` | from the domain | Names the droplet, buckets and local files |
| `--region` / `--size` | `nyc3` / `s-2vcpu-2gb` | |
| `--ssh-key` | the account's only key | DigitalOcean key id or fingerprint |
| `--ssh-identity` | your ssh default | Private key file for that key |
| `--image` | current `edge`, pinned | Must be `ghcr.io/campdenman/freeholder@sha256:…` |
| `--temporary-host` | off | Use `<ip>.sslip.io` even if DNS is ready |
| `--paradisemodern-key`, `--paradisemodern-site-id` | | Or `PARADISEMODERN_API_KEY` / `PARADISEMODERN_SITE_ID` in the environment |
| `--context` | current | A named `doctl` context |
| `--dry-run` | | Print the plan and stop |
| `--json` | | Machine-readable summary; no secrets except the claim link |
| `--non-interactive`, `--no-open` | | Never prompt; never open a browser |

**What it costs.** Launching starts real DigitalOcean billing on your
account: the droplet (the default `s-2vcpu-2gb` is about $18/month at
DigitalOcean's list price; see the recipe README for sizing) and Spaces,
which is a subscription with a $5/month minimum covering both buckets.
Check DigitalOcean's pricing page for current figures. `--dry-run` creates
nothing and costs nothing.

**Secrets** go only to `~/.config/freeholder/<name>/freeholder.env` (mode
600), never to the terminal. **Back that file up and store it safely**, like a
password: it holds `CREDENTIAL_KEY`, which decrypts every connected account's
tokens, plus the database password and session secret. Anyone with the file
can read those; losing it means reconnecting every account the site connects
to. Keep a copy in a password manager or encrypted backup, not in a shared
folder or a repository.

**Until DNS points at the server**, the site runs at `<ip>.sslip.io` so it has
a certificate at once. Add the `A` records the summary prints, then:

```sh
freeholder launch --cutover --name example-com --domain example.com
```

**Re-running** the same command continues where it stopped: each step is
recorded in `~/.config/freeholder/<name>/state.json`, so nothing is created
twice. **Tearing down** removes what that record names, after you type the
site name (or pass `--confirm <name>`):

```sh
freeholder launch --destroy --name example-com
```

The droplet and the site's Spaces key are deleted; a bucket is deleted only
if it is empty, because media and backups are your data. If a deletion fails,
the CLI says which resource to remove in the DigitalOcean console. **Spaces
billing continues after `--destroy`**: the $5/month Spaces subscription (and
any bucket kept because it holds files) is billed until you empty the
buckets and cancel Spaces in the DigitalOcean console. The local
`freeholder.env` is kept, so delete it yourself once you no longer need it.

Exit codes follow `freeholder update`: `0` done, `2` a step failed (the
message says how to recover), `3` DigitalOcean could not be reached or
refused the token.

## Licence

Apache-2.0. See `LICENSE`.
