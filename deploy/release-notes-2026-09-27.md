<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Release notes — session digest 2026-09-27

Product version remains **0.1.0**, in active development. This is a session
digest, not a release-candidate announcement and not a claim of deployment.
`CHANGELOG.md`, generated from `.changeset/`, is the canonical owner-facing
change list. Plan gate at this snapshot: **297 unique IDs, 274 checked,
23 open**. Refresh GitHub before treating anything below as shipped.

## Hardened public playground — C1.38

The disposable demo instance is now hardened to its full contract, closing
the plan item:

- **Privileged operations are refused by the service layer, not the UI.**
  The playground's mutation allow-list is enforced in `authorizeInput`, the
  single choke point every surface (admin UI, REST API, MCP) routes through,
  so staff invitations, role changes, mail test sends, uploads, SMS, payments,
  settings and host updates all fail with a `permission` error no matter which
  door they come in. Tests call these services directly as the playground
  visitor.
- **Nothing leaves the box.** Queued mail, SMS and webhook deliveries now fail
  closed with a playground reason before any provider or endpoint is
  contacted. This matters because background jobs (reminders, compliance
  replies, event webhooks) run as `system`, a caller the visitor-facing
  allow-list was never meant to cover — the container's internal-only
  networks are the outer bound, and this is the in-app twin.
- **Bounded by construction.** Visitors share a 300-mutations/minute ceiling,
  each writable surface (pages, sections, forms, contacts, products, notes,
  tasks) carries a row cap that refuses creates once full, and upload staging
  is off entirely.
- **The hourly reset has a recovery proof.** A service-side test simulates
  the reset job (fresh disposable database + the ordinary boot phases) and
  shows the old visitor session no longer validates, visitor pages are gone,
  the sample site is reinstalled, and a new visitor can edit again. A second
  test proves separation on a live cluster: the playground flag fails closed
  against a database holding real accounts, and the synthetic visitor pair is
  all the playground database ever holds.
- **A real-browser proof drives the whole journey** — entry, the reset and
  privacy banner on every surface, a page edited and published in the editor,
  three privileged API calls refused as the visitor, the reset signing them
  out and 404-ing their page, then re-entry and editing restored
  (`pnpm test:playground`).
