<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Incoming import audit ownership correction — 2026-11-13

C3.22/C3.46/C3.47/F05. Test-only SOURCE correction based on root
`49da38d7`, which already contains the explicit-null HTTP result repair.
No product/service/job/SQL behavior changes. No compiler, lint, tests,
database, native, build, install or provider operation ran in this lane.
MASTER §43 remains the only status authority; no acceptance gate closes.

## Follow-up qualification and upload concealment

At20f6c79d, renewed full types, focused merge/transport lint and eleven source
contract files pass. NEW ordinary V8 matches all82 migration identities. The
incoming refusal case then stops at its prepared403 expectation for a different
uploader: the actual shared upload service deliberately returns404/not_found
when the frozen uploader identity differs, concealing the private upload's
existence. The earlier missing-scope403 assertion already passed. V8 is
preserved with independent read-only table/journal/profile/drain evidence.

The test now requires the exact404 and not_found error code. All original
private-helper, CMS-scope, revocation and unchanged-business-state assertions
remain; their complete execution is still pending in a new database. No
service or permission changed, and no broad403-or404 allowance was introduced.

## Original audit failure

The incoming WXR control reached actual HTTP upload, the SDK500/MCP501
boundary, explicit publication and rollback, and public explicit-null
assertions, then failed its test-wide audit attribution assertion. The V7
failure database is preserved and must not be reset. Independent minimal
evidence is
`/tmp/freeholder-current-cash81-transport-wxr-controls-v4-20261113-failure-ledger-v8.json`.
Its grouped audit records16 import action groups correctly attributed to the
named primary agent and one independent subjectless system crawl reconciler.
The grouped artifact omits audit diff, so it does not establish whether that
one occurrence came from a periodic sweep or committed storage observation.

## Source causality

`src/core/import/crawl-jobs.ts` registers `core.reconcileCrawlOriginals` every
five minutes. Its actual worker context/cancellation check precedes an
independent system call to `imports.reconcileCrawlOriginalObservation`.
`src/core/jobs/core-jobs.ts` includes these jobs. The shared system-only,
external-false reconciler audits a successful mutation without setting an
import-run subject, including a no-op empty periodic selection.

There is a second authentic entry: `observeStorageOperation` commits the
actual physical observation in `src/core/media/write-ledger.ts`, then invokes
`reconcileCommittedStorageObservation`. That ordinary hook deliberately
offers every committed receipt to every registered domain. The crawl hook
in `src/core/import/crawl-privacy.ts` calls the same actual system service with
`receiptId`. Therefore an uploaded WXR PUT can legitimately create this audit
row even when there are no HTTP crawl sources, requests or responses. Its
actual receipt remains independent of the agent's import mutation identity.
REST original-body PUTs follow the same path. No caller-supplied actor or
fabricated service context is supplied by the observation hook.

The shared audit writer records the real call actor. This reconciler's
explicit `auditInputFields:["receiptId"]` means its only accepted audit diff
forms here are an empty object or an exact receipt UUID object; pagination
does not imply an import subject. The test must not require independent
machinery to impersonate the primary import agent.

## Narrow assertion correction

The actual run's `import_run` rows must exist and all retain the exact named
primary agent. Other import mutations still require that primary agent.
The existing exact wrapper system action additionally requires its subject to
be an actual finished response owned through response/request/source/run FKs.
Wrapper authentication remains the real service's admitted-token check.

Only `imports.reconcileCrawlOriginalObservation` receives the independently
owned machinery branch. It must have actor `system`, null subject type/id,
and the strict audit-input shape above. Any nonempty receipt UUID must select
an actual accepted receipt with a positive observed timestamp and the exact
original key, key digest, frozen namespace, byte SHA256 and size. For WXR,
these expectations come from this run's actual server-issued upload and the
unchanged original exact-byte/physical-receipt assertions. For REST, they
come from actual original responses joined through request/source/run FKs.
No key-prefix, equal amount, current account, arbitrary receipt existence or
blanket subjectless-system exception supplies ownership.

Both original incoming lifecycle controls, all source-byte/resource/batch/
publication/rollback and explicit-null assertions, and the scan of the ENTIRE
audit log for credentials/private marker are preserved. No audit row is
removed from that privacy scan. Unexpected actors, nonempty unsupported
diffs, foreign receipts/namespaces, unobserved writes and unrelated wrapper
IDs still fail. These prepared assertions are UNRUN. Fresh execution after
the first failure requires a new database and independent proof, not resetting
the preserved V7 dataset.
