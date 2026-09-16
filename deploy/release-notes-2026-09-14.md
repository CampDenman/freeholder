<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Release notes — session digest 2026-09-14

Product version remains **0.1.0**, in active development. This is a session
digest, not a release-candidate announcement or a claim of deployment.
`CHANGELOG.md`, generated from `.changeset/`, is the canonical owner-facing
change list. This snapshot includes main through `55d65fc` (#372); refresh
GitHub before treating the pending changes below as shipped.

## Available on main

- **Broader, permission-aware search.** Orders, subscriptions, gift registries,
  suppliers, agreements, price lists, marketplace orders and privacy request
  IDs join the existing search sources. Results use the corresponding read
  permissions and open the relevant record. Privacy request bodies and
  signing credentials are excluded. Labels ship in English, French and Spanish
  (#366, #369, #371).
- **Access-control repairs.** Private order reads and stock operations enforce
  their permissions. Cart capabilities, private wishlists and hidden location
  addresses are protected. Private-note pinning and revision history enforce
  the same visibility rules as ordinary reads (#365, #367, #368, #372).
- **Provider implementations.** Paid catalog lines can use the Printify adapter;
  Shopify sync verifies and imports paid orders; Daily supports private rooms
  and verified recording access (#362–#364). These are implemented provider
  paths with automated contract tests, not completed live-account acceptance.
- **Honest provider erasure.** A privacy erasure request remains in progress
  while durable Daily recording/transcript cleanup jobs are outstanding.
  Retries retain the original job identity; completion follows successful
  cleanup acknowledgment. The admin screen shows pending cleanup (#370).
- **Audit and verification repairs.** The audit corrected authorization,
  provider-state and completion-evidence gaps, verified performance fixture
  counts, repaired tied-row pagination and expanded browser coverage. Booking
  tests now use future dates for live-clock workflows (#361, #369).

The earlier search, per-kind retention, first-party plugin screens and customer
app work remains available. Retention holds still protect eligible records.
Native store binaries and physical-device acceptance are not claimed.

## Implemented in open PRs — not yet on main at this snapshot

- **[#381](https://github.com/CampDenman/freeholder/pull/381): note/task recovery.**
  Move records to trash, restore their original IDs/history/links, or explicitly
  confirm permanent deletion with recent identity verification. Privacy holds
  protect manual and scheduled purge; privacy erasure remains irreversible.
  Project checklists/counts exclude trash. Task navigation and saved views use
  task permissions. Includes localized, paginated UI and migration `0010`.
- **[#382](https://github.com/CampDenman/freeholder/pull/382): queue measurements.**
  Twenty real worker dispatches provide database enqueue-to-start samples and
  p95. Missing or failed work fails the harness. Local small/medium runs passed
  with p95 of 1,985/1,982 ms; these are diagnostic results, not reference-host
  acceptance. Requested missing auxiliary clocks also fail on the large fixture.

Both PRs require fresh green checks and the protected merge queue. Current
blockers and tested commit references are recorded in `SESSION_HANDOFF.md`.

## Operator notes

- Main currently has migrations `0000_reviewed-baseline.sql` through `0009`.
  Note/task trash adds `0010` only when #381 lands. Inspect the journal before
  allocating another number.
- Daily cleanup operations are documented in
  [`provider-recording-erasure.md`](provider-recording-erasure.md). Owner-storage
  recording import and complete live-provider acceptance remain unfinished.
- The pending recovery runbook documents rollback compatibility: old app builds
  do not filter trash timestamps; use the matching pre-upgrade database backup
  when rolling back to a version predating that behavior.
- `doctl` 1.168.0 and Android platform tools 37.0.1 are installed on the local
  workstation. DigitalOcean authentication and Replit SSH setup await the
  owner's connection steps. Neither test device has been detected or wiped.
- No live hosting deployment, payment settlement, device acceptance, image
  publication or independent security-review completion is claimed by this update.

## Completion status

`MASTER.md` §43 remains authoritative: **255 of 273 C-items checked, 18 open**.
The full gate counts F/B criteria too: **297 IDs, 267 checked, 30 open**.
Provider coverage, whole-product verification, reference-host performance,
second-target restore, physical-device evidence, independent security review
and the clean-room/owner completion record remain outstanding.

For reproducible commands, PR state and account/device setup, read
[`SESSION_HANDOFF.md`](../SESSION_HANDOFF.md).
