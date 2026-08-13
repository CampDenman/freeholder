# Contributing to Freeholder

Thanks for wanting to help build the open-source operating system for a
one-person business.

## Ground truth

[`MASTER.md`](MASTER.md) is the only product, architecture, status, and
delivery source of truth. Every product change names an item in its §43
completion checklist and meets the applicable feature-level definition of
done. If a change contradicts the master doc, either the change is wrong or the
doc changes in the same PR — code and doc never disagree silently. Do not
create a parallel roadmap or backlog in another document.

## How to contribute

1. **Choose the work** from `MASTER.md` §43. Discuss anything non-trivial in a
   GitHub Discussion or issue, but keep scope and acceptance criteria in the
   master checklist so an issue never becomes a second product plan.
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
pnpm plan:check    # MASTER.md is the one complete, internally consistent plan
pnpm license:check # Apache-2.0 headers, manifests, and package license texts
pnpm dependency:audit # advisories plus SECURITY.md's exception contract
```

CI runs all of the above plus the build, a dependency audit, and a Docker image
that has to answer a real HTTP request. Run them before opening a PR and the
review is about the code rather than the checks.

## Licensing of contributions

Inbound = outbound: contributions are accepted under Apache-2.0, the same
license as the Freeholder-authored repository and published packages. See
[`LICENSING.md`](LICENSING.md). New files carry the SPDX header shown there.

## Code of conduct

Be excellent to each other. The
[Contributor Covenant](CODE_OF_CONDUCT.md) applies in all project spaces.

## Security issues

Never open a public issue for a vulnerability — see
[`SECURITY.md`](SECURITY.md).
