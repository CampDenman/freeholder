<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Release notes — session digest 2026-09-15

Product version remains **0.1.0**, in active development. This is a session
digest, not a release-candidate announcement or a claim of deployment.
`CHANGELOG.md`, generated from `.changeset/`, is the canonical owner-facing
change list.

## Scope decision — mobile apps move to v2

**Owner decision, 2026-09-15 (Tony Aly):** "DONE now means everything but the
mobile apps — mobile happens as v2." The seven remaining mobile-app acceptance
items — **C10.17, C10.18, C10.25, C10.26, C10.27, C10.28 and C10.30** — are
deferred to v2 and recorded in `MASTER.md` §43.18.

This is a dated, bounded, owner-approved scope decision, not a generic escape
hatch. The plan's doctrine stands: version labels express dependency order,
not an excuse to leave the product incomplete. Concretely:

- Each deferred item is quoted verbatim in §43.18 with its ID, evidence and
  outstanding physical-device obligations intact; §35 remains the v2
  specification for the mobile apps.
- Checked mobile items stay checked — their evidence stands. Native store
  binaries and physical-device acceptance are still not claimed.
- The plan gate encodes the same closed set as an explicit `DEFERRED`
  constant: references to those IDs keep resolving, C10 sequence contiguity
  is computed around the sanctioned holes, and any change that re-enters one
  of the seven into the live checklist as a checkbox fails the gate. An item
  leaves the set only by shipping in v2 or by explicit owner reversal, never
  by silent deletion.
- §43.1's completion rule, scope-of-DONE paragraph and remaining-open row now
  name the deferral; the owner signature and completion record remain
  untouched and unsigned.

The rest of the plan is unchanged: C0.11, C3.13, C11.08–C11.17 and the
per-item F01–F12 rows remain open v1 work.

## Completion status

`MASTER.md` §43 remains authoritative. After the deferral the full gate
counts: **290 IDs, 267 checked, 23 open** (was 297 / 267 / 30; the seven
deferred mobile items leave the live sequence, all other counts unchanged).
Provider live-acceptance, whole-product verification, reference-host
performance, second-target restore, independent security review and the
clean-room/owner completion record remain outstanding.

For reproducible commands, PR state and account/device setup, read
[`SESSION_HANDOFF.md`](../SESSION_HANDOFF.md).
