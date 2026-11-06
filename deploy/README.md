# Deploy recipes

A recipe is a documented, validated combination of a deployment target with
sane defaults for adapters and modules (§17). Every recipe runs the **same
application code** — a target that needs a code change gets a capability flag
in core, never a fork (§18).

| Target | Tier | Database | Media | ~Monthly |
|---|---|---|---|---|
| [`digitalocean-droplet`](digitalocean-droplet/) | 1 | Postgres on the droplet | Spaces | $29 |
| [`digitalocean-app`](digitalocean-app/) | 1 | Managed Postgres | Spaces | $32 |
| [`replit`](replit/) | 1 | Replit Postgres | Replit Object Storage | $25 |
| [`railway`](railway/) | 1 | Railway Postgres | S3-compatible | $25 |
| [`render`](render/) | 1 | Render Postgres | S3-compatible | $28 |
| [`docker-selfhost`](docker-selfhost/) | 1 | Compose Postgres | Docker volume or S3 | $12–24 |
| [`linux`](linux/) (no Docker) | 2 | Distribution Postgres | Server disk or S3 | $12–24 |

**By hand, without an AI assistant:** [`linux`](linux/) is the WordPress-style
path: download `install.sh` from a release, run it on any Ubuntu or Debian
server, open the claim link it prints. It needs no Docker, Node, pnpm or
checkout. [`docker-selfhost`](docker-selfhost/) is the same on a host that
already runs Docker.

## The storage mandate

Production media must live somewhere a rebuild cannot take it (§18). On
platforms with no durable disk (App Platform, Render, Railway, Replit) that is
object storage, and the recipe pins it. Media is the least recoverable asset a
business has, and object storage makes moving providers a bucket sync rather
than a rescue operation.

A single-server install may instead keep media on its own disk (C3.44): the
`linux` recipe's `/var/lib/freeholder/media` and the `docker-selfhost` media
volume. Both are outside the replaceable release, kept across updates and
included in the nightly backup, which is why they are supported. The trade-off
is that losing the server loses the media unless its backups were copied off
it, and a second app server cannot share it. Each recipe's README says how to
copy backups elsewhere and how to move media to S3 later.

The `local` adapter **refuses to start** with `NODE_ENV=production` unless
`LOCAL_STORAGE_ROOT` names such an absolute, existing directory. The legacy
`FREEHOLDER_UNSAFE_LOCAL_STORAGE=1` override for an implicit directory remains,
named to be embarrassing in a config review.

## Adding a recipe

Copy an existing directory and keep its shape:

```
deploy/<target>/
├── recipe.yaml     what it provides, what it costs, what it cannot do
├── README.md       provision → deploy → verify, for a human
├── .env.example    every variable this target needs, annotated
├── infra/          compose files, cloud-init, platform specs
└── verify.md       the post-deploy checks doctor cannot automate
```

A recipe may pin an adapter **only** where the platform forces it — a target
with no persistent disk must use S3 storage, for instance. Everything else
stays the owner's choice.

## The published image

Every recipe pulls the same image from
`ghcr.io/campdenman/freeholder`, built and pushed by CI on each change to
`main`:

| Tag | What it is |
|---|---|
| `edge` | current `main` (what CI publishes today) |
| `sha-<short>` | one exact commit |
| `X.Y.Z`, `X.Y`, `latest` | when a `vX.Y.Z` tag is pushed; the same tag publishes npm packages |

Publishing is the *only* thing CI does for your deploy. Running Freeholder
needs no GitHub account, no runner and no fork — `docker compose pull` is the
whole story, which is the point.

> **Maintainers:** a GHCR package is private on first push even when the
> repository is public. Set it to public once, under the repository's Packages
> tab, or nobody else can pull it.

## Operational runbooks

- [`customization-seams.md`](customization-seams.md) — which owner data survives
  an image swap, and why editing core files on a live server is unsupported.
- [`release-channels.md`](release-channels.md) — stable, security and edge, and
  the metadata a release must declare instead of inferring from a version.
- [`release-feed.md`](release-feed.md) — signed `releases.json`, the embedded
  public key, and how rotation keeps the previous key until every image ships
  the successor.
- [`update-checks.md`](update-checks.md) — the daily GET of that feed, jitter,
  the off path, and the guarantee that nothing identifying the instance is sent.
- [`update-preflight.md`](update-preflight.md) — signatures, plugins, drift,
  environment, shadow-schema migration and the downtime estimate before apply.
- [`update-apply.md`](update-apply.md) — snapshot, smoke, cutover, auto-drafted
  release notes and automatic rollback. Target-specific image swap is C10.10.
- [`n1-schema.md`](n1-schema.md) — schema-compatibility plus the upgrade gate
  that boots the previous image, migrates, and rolls back.
- [`update-policy.md`](update-policy.md) — security-auto defaults, business-
  timezone windows, snapshot retention and feature-update approval.
- [`recipe-verification.md`](recipe-verification.md) — install, Doctor,
  database/media restore, update and rollback acceptance for every Tier-1
  target.
- [`migration-runbook.md`](migration-runbook.md) — the 30 directed Tier-1
  moves, downtime/cutover/rollback rules and ID, money, timestamp, media,
  locale and public-URL verification.
- [`ownership-recovery.md`](ownership-recovery.md) — database backup and
  scratch restore, complete logical export, media inventory, configuration and
  credential-key recovery, rotation, retention and erasure evidence.
- [`privacy-rights.md`](privacy-rights.md) — consent evidence, access/export,
  correction, erasure, legal-retention exceptions, artifact retention, backup
  guidance, module registration, and the threat model.
- [`app-store-privacy.md`](app-store-privacy.md) — Apple privacy nutrition
  label, required-reason APIs and review notes for the customer app. Review
  outcomes remain Apple's.
- [`play-data-safety.md`](play-data-safety.md) — Play Data safety answers for
  the same binary. Review outcomes remain Google's.
- [`background-jobs.md`](background-jobs.md) — transactional enqueue,
  idempotency, retry/backoff, global concurrency, leases, cancellation,
  owner history, retained dead letters, redrive controls, process layouts,
  backup scope, and failure recovery.

- [`event-outbox.md`](event-outbox.md) — per-listener delivery receipts,
  leases, bounded retries, event dead letters, duplicate-safe replay,
  webhook idempotency, retention, and recovery.
- [`media-lifecycle.md`](media-lifecycle.md) — accepted formats and limits,
  private-bucket multipart CORS, malware scanning, controlled delivery,
  resumable recovery, trash/purge, and orphan cleanup.
- [`customer-locales.md`](customer-locales.md) — public and portal locale
  precedence, translated chrome authoring, contact-driven templates and
  notification evidence, migration behavior, and verification.
- [`role-guidance.md`](role-guidance.md) — capability-derived owner, staff and
  customer first-win guides, durable outcome evidence, lifecycle controls,
  migration/versioning, rollback and post-deploy verification.

- [`analytics-governance.md`](analytics-governance.md) — consent modes,
  analytics cookies, retention/pruning, reversible bot corrections, Web
  Vitals, campaign attribution, anonymized export, and verification.
- [`content-security-policy.md`](content-security-policy.md) — per-request
  nonces, editor and upload boundaries, separately consented creative origins,
  privacy-bounded violation reporting, retention, and verification.
- [`paradise-modern.md`](paradise-modern.md) — Paradise Modern as one
  optional adapter in the mail, measurement, form-screening, lead-sink and
  model-gateway categories: its public API contract and settings.

## Known gaps

- arm64 images. `linux/amd64` covers the current DigitalOcean recipe; ARM wants
  native runners rather than QEMU emulation.
- Target-specific update/rollback remains C10.10.
