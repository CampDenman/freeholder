# CI and release gate

Freeholder treats the `checks` job in `.github/workflows/ci.yml` as the single
protected-branch fan-in. It succeeds only after application checks, security
checks, all four isolated test shards, the ownership restore drill, browser
tests, and the deployment recipe matrix have passed. Do not add a required
check outside that fan-in without updating the branch-protection contract.

## Feedback objective

The pull-request objective is a 95th-percentile failing-job result within 12
minutes and a complete result within 35 minutes. Every job has a finite timeout.
Review job duration monthly and after two timeout failures in seven days. Improve
caching, fixture isolation, or shard balance when the objective regresses; never
remove coverage or weaken an assertion to meet it.

Each test shard owns a separate PostgreSQL service and database. The browser,
ownership, and deployment jobs also use isolated services so concurrency cannot
hide data coupling or make failures order-dependent.

The image gate also boots once against an unreachable database and requires
process liveness to remain `200` while readiness is `503`, then boots normally
and requires durable current-version worker evidence. This prevents a dependency
outage from being converted into a restart loop.

## Security evidence

Every pull request, merge-group candidate and main-branch push runs a live
registry advisory audit, secret-history scanning, and CodeQL; pull requests also
run dependency review. TruffleHog receives the immutable event-specific base and
head SHAs explicitly. This is required because its action does not infer a
`merge_group` range and otherwise falls back to unrelated full-history findings.
The live audit emits an attestation containing the exact lockfile and exception-
ledger hashes. Scheduled security CI regenerates the same evidence and performs
the deliberate full-history scan weekly instead of trusting a cache.

Credential-shaped values used to prove redaction or URL rejection are assembled
inside the test process. Deployment examples never ship a default database
password: Compose requires a separately generated, URL-safe
`POSTGRES_PASSWORD` before configuration interpolation can succeed.

All third-party actions and CI service containers are pinned to immutable
digests, and CI reads the exact Node version from `.node-version`.
`pnpm workflow:check` enforces the action and service-container rules, rejects
floating action-managed tool versions, and forbids `pull_request_target`
workflows. Checkout credentials are never persisted for repository code, and
the only job with `security-events: write` executes CodeQL actions—not project
scripts or dependency lifecycle hooks.

## Exact-artifact promotion

On a successful push to `main`, CI builds one candidate image, pushes it by an
immutable candidate tag, records its digest, and creates GitHub build-provenance
evidence. Publication downloads the dependency and candidate evidence from that
exact successful CI run, verifies the source SHA, audit freshness, image name,
digest, and provenance, and then promotes the existing digest. It never rebuilds
release source. The promoted digest is keylessly signed and receives an SPDX
SBOM attestation.

A `vMAJOR.MINOR.PATCH` tag, optionally with a SemVer prerelease suffix, is
publishable only when the tagged commit already has a successful `main` push CI
run. Failed or pull-request artifacts cannot enter the release path.
