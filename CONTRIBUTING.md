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
