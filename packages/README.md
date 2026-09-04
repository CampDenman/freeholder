# packages/ — pre-release distributable packages

Freeholder-authored packages use Apache-2.0 and each packed artifact carries
the same `LICENSE` as the repository root. The packages build, pack, install
and execute outside the workspace, but public registry publication remains
open under C3.20. See the root `LICENSING.md` for the full policy.

`@freeholder/sdk` currently exposes a generic versioned service client;
registry-generated concrete methods remain open under C3.03.
`create-freeholder` scaffolds verified source and writes target-specific setup
and environment guidance; environment validation and migration execution remain
open under C3.14.
`@freeholder/templates` currently exports starter descriptors; installing
usable seeded pages, entities and messages remains open under C3.15.
`@freeholder/plugin-kit` is the plugin authoring contract (C3.08–C3.12).
