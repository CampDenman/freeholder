<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Release notes — session digest 2026-10-16

Product version stays **0.2.0-beta.3**, in active development. This is a
session digest. `CHANGELOG.md`, which is generated from `.changeset/`, is still
the canonical list of changes for owners, and it was regenerated with no drift.
freeholder.ai **was redeployed**: see the last section.

It covers PRs #501–#538, which merged between 2026-10-14 and 2026-10-16. That
is the members platform (MASTER §44, section C12), built on the 2026-10-14
multi-user decision: one site, many members.

## Members, social, calls and marketplace (C12)

- **#502:** the plan for members, social, calls and marketplace (§44 and
  C12).
- **#505 (C12.01–04, 06, 07, 13):** these items add:
  - member accounts and profiles;
  - the follow/connection graph;
  - posts and a feed;
  - notifications;
  - direct messages;
  - one-to-one calls.
- **Marketplace:**
  - #507 (C12.08): listings;
  - #508 (C12.09): multi-seller checkout with seller payouts;
  - #509 (C12.10): buyer protection, which covers delivery, sale threads and
    disputes;
  - #510 (C12.11): double-blind buyer and seller reviews;
  - #513 (C12.28): a published prohibited-items policy that sellers accept.
- **Safety:**
  - #511 (C12.12): anything can be reported, into one moderation queue;
  - #512 (C12.29): adult content is opt-in for adults and never shown to
    minors;
  - #514 (C12.15): member data export and account erasure.
- **Profiles and sign-in:**
  - #515 (C12.20): avatars, plus profile sections that each have their own
    audience;
  - #516 (C12.19): passkey-first sign-in for members;
  - #522 (C12.14): personal API keys, so a member's own agents act as that
    member.
- **Media and notifications:**
  - #517 (C12.22): web push using the site's own VAPID keys, with quiet
    hours;
  - #518 (C12.21): photos and video on posts, comments and messages.
- **Earning:**
  - #519 (C12.05): paid member subscriptions with subscriber-only content;
  - #520 (C12.25): bookable services on members' own calendars.
- **Demo and onboarding:**
  - #521 (C12.16): a demo community, a playground, and a guide for AI
    builders;
  - #524 (C12.31): a new-site preset for communities.
- **#523 (C12.17):** an end-to-end test of the whole member journey, a load
  test, and fixes to calls.

## Federation and end-to-end encryption

- **Fediverse:**
  - #526 (C12.18): opt-in ActivityPub federation for members;
  - #534 (C12.32): members can follow fediverse accounts from here;
  - #535 (C12.33): members can move between fediverse accounts, in either
    direction.
- **Encrypted messages:**
  - #527 (C12.23): end-to-end encrypted member messages using MLS (`ts-mls`).
    It includes a device directory, message franking (so abuse reports still
    work), and sealed blobs.
  - #531 (C12.35): members can verify the devices in an encrypted
    conversation.
  - #532 (C12.36): attachments in encrypted conversations are encrypted end
    to end.
  - #533 (C12.34): a new device can receive earlier encrypted history after
    another device approves it. The transfer uses HPKE.
- **Encrypted group calls:**
  - #528 (C12.24): end-to-end encrypted group calls through the site's LiveKit
    SFU, with call keys delivered over MLS.
  - #530 (C12.37): people who leave mid-call are dropped, and the call moves to
    a new key generation.
- **Known limit:** `ts-mls` has no independent audit. Moving to OpenMLS is
  recorded as **C12.39**. The owner deferred it on 2026-10-16, because it needs
  a Rust/WASM build.

## Payouts and abuse imagery

- **#536 (C12.26–C12.27):** sellers can be paid through Stripe Connect, PayPal
  Payouts or Razorpay Route. All three adapters are **mocked**. No live keys
  exist, so neither item is checked. Migration 0050. Sellers acting as the
  merchant of record is recorded as **C12.38**.
- **#537 (C12.30):** uploads are hash-matched against known abuse imagery
  through a composite scanner (the PhotoDNA adapter). A match is blocked and
  kept under legal hold: trash and rescan cannot remove it. The uploader is
  suspended pending review. The owner sees it in a legal queue under
  Admin → Members, with where to report it (Cybertip.ca or NCMEC). The scanner
  is **off** until the owner has a PhotoDNA agreement, which they have not
  signed up for. Migration 0051.

## Fixes

- **#538 (boot on existing sites).** `seed.creator` and `seed.everything`
  changed without a version bump. `syncOnboardingDefinitions` refused them on
  any site that already stored version 1, so the worker never registered, and
  prod readiness returned 503 `no_live_producer`.
  - Both scenarios are now version 2.
  - `tests/core/onboarding-definitions-frozen.test.ts` freezes every
    definition. Changing a definition without bumping its version now fails
    the build. A new entry is added with `ONBOARDING_FREEZE_ADD=1`.
- **#535:** the plain-text scanner now strips in a single pass. This fixes
  CodeQL alerts #28 and #29 (incomplete multi-character sanitization). They
  had slipped through #534 because the merge watcher only checked check names.
- **#525:** the editor crop test retries opening the crop tool while the
  canvas settles.
- **#503:** the booking and ICS journeys use future dates relative to now.
- **#504 (C3.29):** the start of living screenshots of every screen. C3.29
  stays open.

## Open, not merged

- **#539 (proposed as the next C3 item): `freeholder launch` in `@freeholder/cli`.** One command
  creates a DigitalOcean site and prints the owner's claim link. It
  provisions the Spaces buckets, a scoped key, the droplet and cloud-init,
  then deploys, waits for readiness and turns on backups. It has state-file
  resume, `--dry-run`, `--cutover` and `--destroy`, a secret redactor, and 11
  tests that use fakes only.
  - **Do not merge until a real launch has been run by hand.**
  - It also **collides with #529, which proposes the same C3 IDs**. Whichever PR merges second must
    renumber its IDs.

## Deployment

The first deploy of 5b1c7bcb failed readiness (the #538 bug above). Fixing
forward was the owner's choice. **freeholder.ai now runs main `92504696`**,
pinned to the linux/amd64 digest
`ghcr.io/campdenman/freeholder@sha256:68f16cda645c4665205f904b725f14a55a1d35febc3bd7892d71079b8a8d61e8`.
After the deploy, readiness passed with 93 jobs and 1 worker. The deploy used
`scripts/deploy-droplet.mjs`, after a `--dry-run`.
