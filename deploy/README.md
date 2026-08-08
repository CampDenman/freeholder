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

## Known gaps

- arm64 images. `linux/amd64` covers DigitalOcean and Replit; ARM wants native
  runners rather than QEMU emulation.
- `migrate.md` per target (§18 requires one for Tier 1–2) waits on a second
  Tier-1 recipe: a migration path needs somewhere to migrate to.
- The recipe validation matrix (§18) is not in CI yet, so a rotting recipe is
  still found by a frustrated user rather than automatically.
