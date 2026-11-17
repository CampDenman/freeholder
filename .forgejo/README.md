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
| `publish-image.yml` | — | No. Publishes to ghcr.io with the GitHub identity |
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

## Open defect: `deploy-production.yml` cannot run

`.forgejo/workflows/deploy-production.yml` declares `runs-on: freeholder-release`.
**No runner on the fleet carries that label** (checked 2026-11-17 against
`/api/v1/admin/actions/runners`). A dispatch of it would queue forever rather
than fail, which is the quiet failure mode the fleet doc warns about.

This is **not changed here.** Repointing a production deploy at a different
runner is a decision about which hosts may hold the production SSH key, and
that is Tony's to make. Either add `freeholder-release` to a chosen runner, or
change the label — but do not leave it as it is and assume deploys work.

Note also the file's own header: it lives on the private forge **on purpose**,
because a public repository's runner would otherwise hold the production SSH
key. Do not copy it to `.github/workflows`.
