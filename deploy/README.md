# Deploy recipes

A recipe is a documented, validated combination of a deployment target with
sane defaults for adapters and modules (§17). Every recipe runs the **same
application code** — a target that needs a code change gets a capability flag
in core, never a fork (§18).

| Target | Tier | Database | Media | ~Monthly |
|---|---|---|---|---|
| [`digitalocean-droplet`](digitalocean-droplet/) | 1 | Postgres on the droplet | Spaces | $29 |
| `replit` | 1 | Replit Postgres | Replit Object Storage | *planned* |

## The storage mandate

Production media lives in managed object storage, never on instance disk
(§18). Media is the least recoverable asset a business has: a dead droplet or a
wiped container must never take the photo archive with it, and object storage
makes moving providers a bucket sync rather than a rescue operation.

The `local` adapter is development-only and **refuses to start** with
`NODE_ENV=production` unless overridden with `FREEHOLDER_UNSAFE_LOCAL_STORAGE=1`
— a flag named to be embarrassing in a config review.

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
| `edge` | current `main` |
| `sha-<short>` | one exact commit |
| `X.Y.Z`, `X.Y`, `latest` | a release tag |

Publishing is the *only* thing CI does for your deploy. Running Freeholder
needs no GitHub account, no runner and no fork — `docker compose pull` is the
whole story, which is the point.

> **Maintainers:** a GHCR package is private on first push even when the
> repository is public. Set it to public once, under the repository's Packages
> tab, or nobody else can pull it.

## Operational runbooks

- [`ownership-recovery.md`](ownership-recovery.md) — database backup and
  scratch restore, complete logical export, media inventory, configuration and
  credential-key recovery, rotation, retention and erasure evidence.
- [`privacy-rights.md`](privacy-rights.md) — consent evidence, access/export,
  correction, erasure, legal-retention exceptions, artifact retention, backup
  guidance, module registration, and the threat model.
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

## Known gaps

- arm64 images. `linux/amd64` covers the current DigitalOcean recipe; ARM wants
  native runners rather than QEMU emulation.
- Replit and the other target recipes remain completion work (`MASTER.md`
  C3.16).
- Per-target migration and the validation matrix remain C3.17–C3.19.
- Target-specific update/rollback remains C10.10.
