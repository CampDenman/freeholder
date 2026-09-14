<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Release notes — session digest 2026-09-14

**Not a version bump.** Product version is still `0.1.0` (active development,
not a release candidate). The canonical owner-facing list is `CHANGELOG.md`,
generated from `.changeset/`. This page is a digest of what reached `main`
in the 2026-09-13/14 merge train (`#357` through `#359`).

HEAD at write time: `c496198`.

## For the owner

- **Search.** Admin → Search runs one query over contacts, conversations,
  notes, tasks, invoices, pages, media, products, quotes, projects and
  galleries you can already open (`search.query`).
- **Retention.** Admin → Retention sets a per-kind TTL. Apply now or wait
  for the nightly job. Privacy holds still win. This is not undelete.
- **Customer app.** `npx freeholder-app init` pulls branding into the app
  config. Store privacy manifests and CI export gates are in. Physical
  store binaries still need EAS credentials.
- **Community, voice/video, print-on-demand, marketplace.** First-party
  plugins with real tables and admin screens. Printify and marketplace
  channel APIs are still fixtures.
- **Accessibility.** Ten more admin list screens go through the same axe
  check as Overview. There is still no Arabic catalog.

## For operators

- CI MinIO is `quay.io/minio/minio` (same digest as before). Docker Hub
  `minio/minio` no longer pulls.
- Schema baseline is `db/migrations/0000_reviewed-baseline.sql`. Later
  files are `0001`–`0005` (community, voice-video, POD, marketplace,
  retention). Do not add another `0168_*`.
- Merge path: GitHub merge queue on `main`, then main-push CI, then
  **Publish image** to GHCR. There is no droplet deploy from the session
  that wrote this file.

## Still not in this digest

Live Stripe/PayPal, independent security review, a second live restore,
medium/large performance budgets on the droplet, physical-device proof,
and the owner signature in `MASTER.md` §43.1. Those are open C-items.

Full notes: `CHANGELOG.md` under `## 0.1.0`. Plan status: `MASTER.md` §43.
Session snapshot: `SESSION_HANDOFF.md`.
