---
"freeholder": patch
---

The project's copyright and repository now name Tony Aly directly rather than
Camp Denman Society. Nothing about the licence changes: the core stays
AGPL-3.0-only, `packages/` stay MIT, and contributions stay under the DCO so
contributors keep their own copyright.

If you self-host and pull the published image, its address changes to
`ghcr.io/tonyaly/freeholder`. Images published before this change are signed
under the old repository identity and verify against it — that is keyless
signing working as intended, and `deploy/digitalocean-droplet/verify.md` shows
both.
