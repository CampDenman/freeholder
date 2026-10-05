<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->
# Stable release preparation evidence — 2026-10-05

This is evidence for MASTER.md C11.08/C11.16/C11.17. Stable is unpublished;
C11.10 has no independent reviewer and the owner signature remains unsigned.

## Fresh image and actual object restore

Baseline source: `04c27ca5f251164e9d385b1cd05449f341119262`, signed main image
`ghcr.io/campdenman/freeholder@sha256:597aa25d4fb5fc20ff79501e60ed8f7434e775023b6800432ea7b96013c627dd`.
The disposable fixture used PostgreSQL 16 and private loopback HTTP ports on the
existing DigitalOcean host. The database, credentials and storage directories
were separate from production and the public playground.

Eight HTTP acceptance assertions passed:

1. Missing/incorrect independent bootstrap secret refused (401).
2. Correct bootstrap created the first owner (201), issuing session/CSRF cookies.
3. A second owner claim refused (409).
4. Session-bearing business-profile mutation without CSRF refused (403).
5. Real TOTP enrollment and confirmation succeeded, issuing recovery codes.
6. First-boot business setup completed and locked.
7. A two-block page published and served its expected text over HTTP.
8. Multipart upload stored and served an actual PNG with identical original bytes.

The source app was stopped before `pg_dump -Fc` and media archive creation,
then restarted. The database archive was restored with `pg_restore` into a
second empty database; actual media files were restored into a separate
private directory. A second instance using the same immutable image returned
healthy status, the published page (200), and the uploaded original (200).

| Artifact | SHA-256 |
| --- | --- |
| Database archive | `39453e47c6acf5963c6513b3abad05dfb296dff651f725a25d3a04ebf12d093f` |
| Media archive | `ff7f75ed2b1ca8eff7182327c2f1736f6fbf8a31bdcf643f264f6039bc68abfa` |
| Uploaded and restored original PNG | `3cfe4d361cf37dd566bca35f3f2ef96510bd07d9beb01f4e77592f9d616a50dd` |

This is an isolated **local-storage** image rehearsal. It establishes recovery
of actual object bytes, unlike the old metadata-only fixture. It does not
establish cross-target Tier-1 S3 transfer or the final candidate's upgrade and
failed-update rollback. The baseline predates this round's security/release
repairs. No real payment provider was configured or charged.

## Package and release preparation

`pnpm packages:verify` built, packed, installed and exercised all seven workspace
packages outside the workspace. Six packages belong to the public v1 publisher;
the mobile package remains deferred. This proves packed artifacts, not public
registry installation. The release contract gate passed 347 tests in 37 files;
focused database-backed release/feed/fork checks passed 50 tests in five files.
The release PR and security PR both passed their full protected PR CI runs.
Merge-queue/main runs are separate required gates before deployment.

No npm user is authenticated in this workspace (`npm whoami`: ENEEDAUTH).
No user/workspace/repository `.npmrc` is present. The six proposed registry
endpoints returned 404; namespace ownership is unknown. GitHub authenticates
as `domainersuite` (Tony Aly), which does not prove npm identity. Repository
secret names expose a release signing key and no `NPM_TOKEN`; organization
secret access is unavailable to the current GitHub scope. Publishing needs an
owner-controlled npm account/namespace and privately configured publishing
access. Credentials are never part of this record.

## Outstanding findings reflected in MASTER

- C6.11: paid event admission is explicitly refused. No invoice/settlement/seat-hold
  flow exists. Free registration and capacity locking do not close this gap.
- C11.05: manual/mocked entitlement journeys passed; actual configured provider
  checkout, signed webhook settlement and subscription lifecycle remain unverified.
- C11.08: cross-target Tier-1 object-byte recovery and final candidate update/rollback
  remain unverified. The older drill had 10,000 media rows and no source bytes.
- C11.10: independent review remains unchecked at the owner's request.
- C11.16/C11.17: reconciliation, final clean-room acceptance and owner signature
  remain open. The publisher must refuse a final stable tag while these are open.

## Newly reported mobile dependencies

GitHub reports two high alerts in `apps/mobile/package-lock.json`: node-forge
1.4.0 (alert #6) and braces 3.0.3 (alert #7). The root pnpm workspace excludes
`apps/mobile`; a clean root audit does not clear these alerts. Mobile lock entries
are not marked development-only. node-forge is reached by `@expo/cli` and
`@expo/code-signing-certificates`; braces is reached by micromatch. This describes
the dependency graph, not a completed runtime reachability review.

The reviewed [node-forge advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv)
and [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) list no
patched version as of this check. Mobile remains v2-deferred. Neither alert was
dismissed or waived; review exposure, follow upstream repairs, and retest before
shipping mobile. These dependencies are separate from the v1 server's audited
pnpm graph.
