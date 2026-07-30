# Contributing to Freeholder

Thanks for wanting to help build the open-source operating system for a
one-person business.

## Ground truth

[`MASTER.md`](MASTER.md) is the canonical specification. Every product and
architecture decision lives there. If a change contradicts the master doc,
either the change is wrong or the doc needs a PR first — code and doc never
disagree silently.

## How to contribute

1. **Discuss first** for anything non-trivial — open a GitHub Discussion or
   an issue before writing code, so nobody builds a feature that can't merge.
2. **Fork and branch** from `main`. Branch names: `feat/...`, `fix/...`,
   `docs/...`.
3. **Sign off every commit** (`git commit -s`). This certifies the
   [Developer Certificate of Origin](DCO.md). PRs with unsigned commits fail
   CI. There is no CLA.
4. **Open a PR** against `main`. `main` is protected: PRs only, status checks
   required, no force pushes.

## Running it locally

You need Node 20+, pnpm, and a PostgreSQL 15+ you don't mind writing to.

```bash
pnpm install
cp .env.example .env          # set DATABASE_URL and SESSION_SECRET
pnpm db:migrate
pnpm dev                      # first visit lands on /setup
```

**Tests want a second, throwaway database.** Set `TEST_DATABASE_URL` in `.env`
and the suite maps it onto `DATABASE_URL` for the run; migrations are applied
by vitest's `globalSetup`, so there is no separate migrate step. Without that
variable the database-backed suites **skip** rather than run — deliberately, so
a test run can never truncate the database you were developing against. The
unit suites always run.

```bash
pnpm test          # vitest
pnpm typecheck     # tsc --noEmit
pnpm lint          # architecture, money (§15.4), service-layer (§15.5), i18n (§15.3)
pnpm license:check # the AGPL/MIT boundary and SPDX headers
```

CI runs all of the above plus the build, a dependency audit, and a Docker image
that has to answer a real HTTP request. Run them before opening a PR and the
review is about the code rather than the checks.

## Licensing of contributions

Inbound = outbound: your contribution is accepted under the license of the
component it touches — AGPL-3.0-only for the core, MIT for `packages/*`.
See [`LICENSING.md`](LICENSING.md). New files carry the SPDX header shown
there.

## Code of conduct

Be excellent to each other. The
[Contributor Covenant](CODE_OF_CONDUCT.md) applies in all project spaces.

## Security issues

Never open a public issue for a vulnerability — see
[`SECURITY.md`](SECURITY.md).
