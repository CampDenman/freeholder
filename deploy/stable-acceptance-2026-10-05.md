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

The npm CLI subsequently authenticated as `campdenman`; `npm org ls freeholder`
confirmed that account is the `@freeholder` organization owner. The namespace
currently contains no packages. All seven proposed `0.2.0-beta.1` artifacts also
passed the packed install/usage gate, and eleven version/publication integrity
assertions passed. This beta preparation is private and unpublished; it does not
close public registry acceptance or imply the owner chose that release channel.

The existing workflow still requires `NPM_TOKEN`; no repository publishing token
or package trusted publisher has been configured. npm's current publishing rules
require publishing authentication beyond account login. The authenticated account
and local pack test are separate from a successful authenticated public publish.
No credential is included in this record.

## Actual S3 object transfer and signed host update

A disposable SeaweedFS 4.48 S3-compatible server used fresh fixture-only access
credentials, separate `release-source` and `release-target` buckets and private
storage on the existing host. Its immutable image was
`chrislusf/seaweedfs@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d`.
Production media/backup buckets and credentials were not used by this test.

The real HTTP bootstrap/publish/upload journey ran against a fresh S3-backed
source. With its app stopped, `pg_dump -Fc` produced archive SHA-256
`102c567224a3c5e68f123951f0361fda532ee6371fd2fc3881f836feef844fa7`.
`ownership-export.mjs` exported 377 tables, 785 rows and one actual media asset.
`media-transfer.mjs` copied and verified one object (68 bytes) between the two
buckets. A second empty database was restored with `pg_restore --exit-on-error`;
the target app returned healthy status, the published page and the original PNG
with SHA-256 `3cfe4d361cf37dd566bca35f3f2ef96510bd07d9beb01f4e77592f9d616a50dd`.
This proves actual S3 API transfer and object recovery on an isolated same-host
fixture; it is not managed storage or a different physical Tier-1 host.

The exact merged source `449fe0efe3867f3e08ee4505980be62e1dd8c009` passed main
[CI run 37281161334](https://github.com/CampDenman/freeholder/actions/runs/37281161334)
and [image publication 37283078916](https://github.com/CampDenman/freeholder/actions/runs/37283078916).
The deployment tool verified provenance and resolved the Linux amd64 image to
`ghcr.io/campdenman/freeholder@sha256:cac139fca13101e5e614adf84b030c8777106914e71de4f6c961569324d80495`.

A separate app/db/Caddy Compose installation restored that S3 database and used
the target fixture bucket. The real `scripts/docker-updater.py` host executor
verified the candidate's exact main-workflow cosign identity and forward ancestry,
backed up the database, restored a shadow instance and checked schema/journal,
worker readiness and HTTP smoke routes. It reported `schemaChanged: false`.

A test-only subclass injected one explicit failure after the candidate's real
live-container smoke succeeded. During cutover the Caddy endpoint returned 503.
The executor recorded `rolled_back`, restored the previous immutable image and
independently verified health and smoke routes before reopening traffic. This
exercises actual container/proxy recovery; it does not test migration-changing
rollback, because this candidate has no schema change.

A second unmodified executor run completed the same signed upgrade successfully.
After traffic reopened, the restored page and the S3 original were served over
HTTP with identical content and SHA-256; workers were ready. C11.08 stays open
for the complete normative cross-target/candidate acceptance journey.

## Outstanding findings reflected in MASTER

- C6.11: paid event admission is explicitly refused. No invoice/settlement/seat-hold
  flow exists. Free registration and capacity locking do not close this gap.
- C11.05: manual/mocked entitlement journeys passed; actual configured provider
  checkout, signed webhook settlement and subscription lifecycle remain unverified.
- C11.08: same-host S3 object transfer/recovery and the signed edge-image host
  update/failed-cutover rollback passed. The complete cross-target final-candidate
  journey remains open; the older two-droplet drill had no source object bytes.
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

## Production and playground deployment

The production recipe deployed the verified `449fe0ef` immutable image above.
It uploaded the database archive and checksum before changing the image pin,
then reported schema readiness and public health success. `freeholder.ai`
returned 200 with 1,519 services and all 87 mounted workers ready; `www` resolved
to the canonical HTTPS health URL. The homepage returned 200 and contained no
“Built by WeVibeSites” branding.

The playground's independent image pin was updated to the same digest and its
fixed Compose reset recipe recreated only the playground app/database. The
production environment was not copied. Public demo health returned 200 with
1,519 services, ready workers, zero failed jobs and zero dead letters.

A real Chromium browser on `demo.freeholder.ai` entered as a visitor, created a
page, added a heading, waited for Saved, published it and read the public text.
It reopened the editor, changed the words, waited for Saved, clicked Publish
changes and read the new public text. The button completed and no false
“This page changed after you opened it” conflict appeared. The same visitor's
invitation, mail test and upload-staging API calls each returned 403.

These checks exercise the running deployment and a disposable demo page; they
are separate from the full protected browser CI suite. The demo was reset after
the mutation proof. A browser carrying the old session was redirected to the
playground entry, the test page returned 404, and a fresh visitor could enter
the reseeded admin. Eight documentation/reconciliation assertions and the plan
and license gates passed for this evidence update.
