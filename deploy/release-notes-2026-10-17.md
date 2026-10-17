<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Release notes — session digest 2026-10-17

Product version stays **0.2.0-beta.3**, in active development. This is a
session digest. `CHANGELOG.md`, generated from `.changeset/`, is still the
canonical list of changes for owners. freeholder.ai **was redeployed** to
this revision: see the last section.

It covers what merged after the 2026-10-16 digest (`92504696`, PRs #501–#538):
PRs #540–#546. The members platform in that earlier digest is unchanged here.

## Dependencies and the handoff

- **#541:** eleven Dependabot bumps in one lockfile, the same approach as
  #456. vitest 5.0.5, @simplewebauthn/server 14.0.3, qr 0.7.2, nodemailer
  10.1.1, @formatjs/icu-messageformat-parser 3.5.21, axe-core 4.14.0, pg-boss
  12.37.1, @types/node 26.6.5, railway 3.16.0, typescript-eslint 8.71.2.
  pg-boss is floored at `~12.37.1`, not `^`, because 12.38.0 is a breaking
  schema. Schemas 42–45 migrate when the app starts, so every instance of a
  deployment restarts together. nodemailer 10.1.2 was left for a later
  proposal: it was too new for the release-age gate.
- **#540 and #542:** the 2026-10-16 session handoff and digest, then a
  correction once #541 had merged ahead of that handoff. No product code.

The two high-severity alerts on `apps/mobile/package-lock.json` (braces and
node-forge) still have no published fix. They are build-time tooling. The
owner left them open.

## What closed

- **#543 (C3.29, still open).** The screenshots workflow already captured
  every screen on each push to `main` and replaced the `screenshots` branch.
  This adds the gallery publisher: `scripts/screenshots-gallery.mjs` uploads
  through the product's media API and rebuilds `/screenshots` from the
  instance's own pages. It is proven against a local instance, including
  dedup and retiring a page the capture no longer needs. The GitHub `gallery`
  job skips until the owner adds the scoped credential in
  `deploy/screenshots-gallery.md`. The item stays unchecked until that live
  run on freeholder.ai.
- **#544 (C6.11).** Paid event admission uses the invoice spine. A paid
  ticket holds a seat for 30 minutes and issues one invoice. Full payment
  confirms the seat. The sweep cancels a lapsed hold, voids its invoice, and
  promotes the next waitlisted person with a new invoice. A refund or void
  frees the seat. Check-in of a paid registration requires the settled
  invoice. The public event page has a registration form: free succeeds in
  place, paid goes to the private invoice, and a full session waitlists.
  Migration `0052_event_paid_admission`. Hosted-provider settlement remains
  C11.05.
- **#545 (C9.37).** Before a newsletter campaign starts, the owner sees how
  many people in a segment can actually be mailed: an address, current
  marketing-email consent, and no active suppression. Starting freezes that
  audience and reports the same skip count. Consent is checked again when
  each copy is sent. Mail settings explain what verification proves for
  Resend, Postmark and Amazon SES. The template editor can send one test
  copy. A public subscribe form can require the owner's own consent sentence.
  Someone who unsubscribed can join again. A fresh demo installs The Aurora
  Coast Letter. SMTP and HTTP doubles prove the behavior. Provider
  credentials and live inbox placement remain the owner's acceptance.
- **#546 (C9.38).** A card-required membership trial stays paused, with no
  access, until the customer saves a payment method. The trial window starts
  then. A setup fee is invoiced on its own and, once paid with a consented
  saved card, opens the trial rather than a paid period of the recurring
  price. A zero fee opens the provider's card-setup checkout, and the
  customer starts the trial from the saved card. A manual adapter, or a
  provider that cannot save a card without a charge, keeps the plan
  unavailable. No new migration. The adapter double proves the path. Live
  recurring settlement remains C11.05.

## Still open, not merged

- **#539:** `freeholder launch` in `@freeholder/cli`. One command would create
  a DigitalOcean site and print the owner's claim link. Tests use fakes only.
  Do not merge until the owner has run one real launch by hand, including
  `--destroy` on a throwaway domain.
- **#529:** optional Paradise Modern mail, measurement, form screening and
  Brain. It proposes the same new C3 numbers as #539. Those numbers are not
  in `MASTER.md`. Whichever pull request merges second must renumber.

## Deployment

**freeholder.ai runs product revision `5af2cf0c`** (PR #546), pinned to the
linux/amd64 digest

`ghcr.io/campdenman/freeholder@sha256:87eebf56dfe33d50ee14d523f32df715d00175de5984d19198aeceb7df561ea6`.

These notes merge after that revision. They do not change the droplet. The
tip of `main` moves when this digest lands; the running image stays that pin
until the next `scripts/deploy-droplet.mjs`.

Main CI for that commit succeeded, Publish image
([run 39066301842](https://github.com/CampDenman/freeholder/actions/runs/39066301842))
signed the manifest, and `scripts/deploy-droplet.mjs` was dry-run and then
applied. The database backup uploaded before the pin changed. The app logged
that the schema is up to date. `GET /api/health` returned ok on
0.2.0-beta.3: 37 modules, 1,718 services, 94 registered jobs, one current
worker, no failed jobs, queue state ready. Health also reported three stale
instances and still returned ready. The homepage returned 200.

The previous pin, from the 2026-10-16 deploy, remains the rollback digest:

`ghcr.io/campdenman/freeholder@sha256:68f16cda645c4665205f904b725f14a55a1d35febc3bd7892d71079b8a8d61e8`.

The script does not roll back on its own. The playground that serves
demo.freeholder.ai was not part of this swap. It still returned HTTP 200
after the production app restarted. The host address stays out of this
repository.
