# `.forgejo/workflows` — what runs on the private forge, and what does not

Tony's decision, 17 November 2026: **GitHub and Forgejo run CI independently.**
GitHub keeps its eight `.github/workflows` and stays the pull-request gate.
Forgejo exists so the private copy is independently testable on our own runner
fleet. Nothing here is a merge gate.

## One job or many?

| | CI shape | Why |
|---|---|---|
| **Tier 0/1** — a small site | **One workflow, one job**, sequential steps ending in deploy | Nothing to parallelise, and a split pipeline costs more of a shared 21-slot fleet than the site is worth |
| **Tier 2/3** — a real product | Split jobs plus a fan-in `checks` job | `.github/workflows/ci.yml` says it in its own header: independent jobs keep first feedback inside the CI SLO. One browser job crept from 15 to 29 minutes and was cancelled |

Freeholder is Tier 3, so `ci.yml` here is split. Most of the portfolio is not,
and should use the single-job shape.

**Actions are the thing to keep scarce, not jobs.** The GitHub workflows pull 17
distinct actions. These twins use **two**: `checkout` and `setup-node`.
Everything else is a plain `run:` step. Keep it that way — every action is a
third-party dependency inside the build.

## The shadowing rule

**`.forgejo/workflows/` shadows `.github/workflows/` entirely on Forgejo.** When
both directories exist, Forgejo registers only `.forgejo`. Camp Denman lost all
of Platform CI for a week to exactly this: four native workflows shadowed
seventy-one. A `.github` workflow with no `.forgejo` twin is **dormant on
Forgejo**, which is fine as long as it is deliberate — and on this repo it is,
because GitHub still runs all eight.

## The map

| `.github/workflows` | Twin here | Status |
|---|---|---|
| `ci.yml` | `ci.yml` | **Partial.** `application`, `tests` (8 shards, not 32), `dependency-audit`, `checks` fan-in |
| `security-scheduled.yml` | `security-scheduled.yml` | **Partial.** Dependency audit only |
| `publish-image.yml` | `publish-image.yml` | **Different on purpose.** Upstream *promotes* a CI-attested candidate and signs it keylessly with a GitHub OIDC identity. The twin *builds* and signs with our own key, because a private forge attests its own images (C10.31). Dispatch-only, and it refuses a revision with no successful `CI (Forgejo)` run |
| `publish-packages.yml` | — | No. Publishes with the GitHub identity |
| `mirror-ci-images.yml` | — | No. Mirrors into the GitHub registry |
| `release-tarballs.yml` | — | No. Its matrix asks for `ubuntu-24.04` and `ubuntu-24.04-arm`; **no runner on this fleet carries either label**, so it would wait forever rather than fail |
| `screenshots.yml` | — | Not yet. Needs browser dependencies unverified on the fleet image |
| `eas.yml` | — | No. Expo EAS credentials, dispatch-only, and a PR must not spend EAS quota |

### `ci.yml` jobs deliberately absent from the twin

| Job | Why |
|---|---|
| `codeql` | `github/codeql-action` is GitHub-proprietary. No Forgejo equivalent |
| `candidate-image` | Pushes to ghcr.io and uses GitHub OIDC attestation (`id-token`, `attestations: write`). Neither exists here |
| `security` (the action half) | `actions/dependency-review-action` needs GitHub's dependency-graph API. `trufflesecurity/trufflehog` is GitHub-hosted and unverified on this instance. The `dependency-audit.mjs` half **is** twinned |
| `ownership` | Its PostgreSQL 16 client shim runs `docker run` **inside the job**. Service containers are a first-class runner feature; docker-in-job is not verified here. Omitted rather than made skip-on-failure, because a skipped job reports as SUCCESS |
| `browser` | Playwright browser dependencies and a loopback LiveKit SFU, neither verified on `paradise-actions-runner:2026-08-23` (Ubuntu 22.04.5) |
| `mobile`, `openmls` | Portable in principle but heavy (20 and 35 minutes, plus a full Rust toolchain install per run) on a fleet shared with every other repo. Add when there is a reason to |

## Fleet facts that constrain anything added here

Measured 2026-11-17; see `site-registry/docs/forgejo-ci-runners.md`.

- **Labels carried:** `ubuntu-latest` (11), `nvc-heavy` (11), `self-hosted` (11),
  `nvc-deploy` (10), `pm-release` (3). A runner runs a job only if it carries
  **every** label in `runs-on`, so adding a label narrows, never widens. A label
  nothing carries waits forever instead of failing.
- **21 concurrent slots for every repo on the forge.** A 32-shard matrix per
  push starves Plotfinity, NVC, Paradise Modern and Camp Denman. That is why
  these triggers are `push` to `main` and `workflow_dispatch`, not every pull
  request.
- **Bare action names may not resolve.** `deploy-production.yml` pins
  `https://data.forgejo.org/actions/...` by full URL. These twins do the same,
  and deliberately do **not** reuse `./.github/actions/setup-project`, because
  that composite pulls `pnpm/action-setup` by bare name. pnpm is activated
  through `corepack` from `package.json`'s `packageManager` field instead.
- **A skipped job reports as SUCCESS** in the status API, and `cancelled`
  reports as FAILURE. The `checks` job asserts every result explicitly rather
  than relying on `needs` alone.

## Resolved: `deploy-production.yml` could not run

It declared `runs-on: freeholder-release`, which **no runner on the fleet
carried** (checked 2026-11-17 and again 2026-11-18 against
`/api/v1/admin/actions/runners`: 12 runners, 0 with that label, 11 with
`ubuntu-latest`). A dispatch would have queued forever rather than failing —
the quiet failure mode the fleet doc warns about.

Repointed to `ubuntu-latest` on 2026-11-18. The label question was really
"which hosts may hold the production SSH key", and the answer is the same
ordinary fleet that already holds every other project's deploy key; inventing
a label reserved nothing, because Forgejo has no label priority.

## Secrets `publish-image.yml` needs

Repository secrets on the forge. None of them are in this repository, and the
workflow fails closed with a named error if any is missing.

| Secret | What it is |
|---|---|
| `FORGE_API_TOKEN` | Reads `/actions/runs` to prove CI passed on the revision |
| `FORGE_REGISTRY` | e.g. `forge.paradisemodern.com` |
| `FORGE_REGISTRY_USER` / `FORGE_REGISTRY_TOKEN` | `docker login` for the push |
| `FORGE_IMAGE_REPOSITORY` | e.g. `forge.paradisemodern.com/tony/freeholder` |
| `FREEHOLDER_COSIGN_PRIVATE_KEY` / `FREEHOLDER_COSIGN_PASSWORD` | Signs the pushed digest |
| `FREEHOLDER_COSIGN_PUBLIC_KEY` | Verifies the signature in the same run |

Generate the keypair once, off this machine's shared checkouts:

```sh
cosign generate-key-pair          # writes cosign.key (private) and cosign.pub
```

`cosign.key` and its password become the two signing secrets. `cosign.pub`
becomes `FREEHOLDER_COSIGN_PUBLIC_KEY` **and** is the file every host's
`scripts/docker-updater.py` names as `publisher.cosign_key`, installed
root-owned and not group-writable. The private half never leaves the secret
store.

The workflow verifies its own signature against the public half before
finishing. That is deliberate: a mismatched keypair then fails in CI rather
than on a production host at update time, where the symptom is a refused
update that looks like a corrupted image.

**Publishing does not deploy.** It produces a signed digest. Deploying it is
`deploy-production.yml`, or offering the digest to a host running the updater.

Note also the file's own header: it lives on the private forge **on purpose**,
because a public repository's runner would otherwise hold the production SSH
key. Do not copy it to `.github/workflows`.
