# packages/ — pre-release distributable packages

Freeholder-authored packages use Apache-2.0 and each packed artifact carries
the same `LICENSE` as the repository root. The packages build, pack, install
and execute outside the workspace, but public registry publication remains
open under C3.20. See the root `LICENSING.md` for the full policy.

`@freeholder/sdk` is the typed HTTP client generated from the live service
registry.
`create-freeholder` scaffolds verified source, checks the generated
environment, can install dependencies and run migrations, and prints a setup
URL with reachable-or-recovery guidance.
`@freeholder/templates` currently exports starter descriptors; installing
usable seeded pages, entities and messages remains open under C3.15.
`@freeholder/plugin-kit` is the plugin authoring contract (C3.08–C3.12).
