<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# The update read model

*MASTER.md §39.10, checklist item C10.11.*

§39.10 lists four entities and then says *"Four surfaces, one service layer"*.
The admin screen (C10.20), the CLI (C10.21), MCP and the notification
escalation (C10.22) must not each work out "how far behind am I" from the raw
feed — four answers to that question is four chances to disagree about whether
a business is exposed. They all read this.

## `available_releases`

What the signed feed offered, cached. Migration `0166_available_releases.sql`.

Cached rather than fetched per read for one reason: **an owner asking "am I
exposed?" must get an answer when the feed is unreachable**, and "I could not
reach the feed" is a different sentence from "you are up to date".

- Written by `platform.checkUpdates` after the feed verifies, in a fresh
  transaction opened once the network is done — never one held across the
  fetch.
- Upserted by version, never insert-only: a release whose metadata is
  corrected upstream corrects here too. A cache that can only grow will
  happily keep telling an owner about a CVSS score that was withdrawn.
- `verified` records whether the signature checked out *when the row was
  written*, so a row can never be mistaken for a trusted one later.
- The database repeats the feed parser's rule that a scored release must name
  a severity band and an unscored one must not. A cache that can hold what the
  parser rejects is not a cache.

## The status line

`platform.updateStatus` returns the one sentence §39.10 says must never be
ambiguous, plus whether it should be shown in the danger colour.

| Posture | Sentence | Urgent |
|---|---|---|
| `unknown` | "No update check has completed yet…" / "Update checks are off…" | no |
| `current` | "Up to date" | no |
| `behind` | "Update available — 0.3.0" | no |
| `behind-security` | "2 security releases behind — CVSS 8.1" | **yes** |

`unknown` is a real posture, not a failure. An instance that has never
completed a check has not been told it is safe, and saying "Up to date"
because the cache happens to be empty is exactly the silence §39.10 refuses.

Channel filtering happens before the count. An instance on the `security`
channel is not "behind" because a feature release exists. A release with no
CVSS score is news, not exposure.

## The rollback horizon

§39.11: *"Once a later release contracts the schema, the releases before it are
no longer reachable by an image swap. The admin states which version is the
earliest one still reachable."*

`earliestReachableVersion` is the newest `schema_breaking` release the instance
has already passed, or `null` when nothing has contracted the schema. A
breaking release the instance has not reached yet does not shorten its horizon.

## Applicability, per row

`platform.listAvailableReleases` marks each cached release `applicable` with a
reason, using C10.02's `canApplyFrom` against `min_from_version`. A list of
releases an owner cannot apply from their current version is a list that
teaches them to ignore it.

## Surfaces

This item ships the model and its services only. The screens are C10.20, the
CLI is C10.21, and MCP plus the email/SMS escalation are C10.22 — the split
recorded in §43 on 2026-09-07, because one checklist line had become the
deferred human surface of ten shipped items.
