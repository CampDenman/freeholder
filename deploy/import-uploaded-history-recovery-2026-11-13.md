<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Historical uploaded erasure: populated upgrade and recovery evidence

C1.08/C3.47/C11.14 remain open. Frozen b0e668ab/SQL80=3a686245/SQL81=955a04d2
supplies one actual synthetic published79→ordinary81 recovery proof. It repairs
an old false-completed status truthfully; it does not infer missing initial
membership or claim that the unknown historical graph was safely erased.
MASTER.md §43 remains the status authority. Public lifecycle, complete record
coverage, transport/browser/provider and stable acceptance remain open.

A retained self-bound `core.eraseImportSourceObjects` task identifies the exact
request and original chunk keys. Private SYSTEM
`imports.reconcileOriginalSourceErasure` requires the verified original request,
applied fulfillment audit and intact receipt before shared
`privacy.reopenErasureJob`. Invalid evidence remains explicit recovery, with no
fabricated replacement artifact, keys or original graph set. It does not select
current graph membership or insert/backfill initial capture. Original-task
idempotency and exclusion of its generated retry tasks prevent a retry chain.
Bounded100-row durable continuation, committed physical-observation callbacks
and a five-minute registered worker are prepared entry points. All use the same
services, permission/audit boundary and identity→privacy→receipt lock order;
provider I/O remains outside the mutation transaction.

Duplicate prepare/ACK now enter this service when an erased old receipt lacks
complete original membership. The old task replay can return without additional
I/O, but the original request becomes pending recovery with a real durable task.
That new task still fails complete-initial-scope admission before physical
cleanup or ACK. Missing membership is never adopted from a current graph or
inferred from raw absence. Reviewing that unknown historical state remains
required before any eventual cleanup/completion.

The first actual controller used only NEW
`freeholder_uploaded_history_upgrade_v1_test_20261113`. It pinned actual old
sourcef1b5d6a3 and unchanged original oracle blob4a470c34. The operational copy
required exactly one failure at the final private-marker assertion (line88),
plus independent verified completed/erased status, retained exact task,
private501 index and accepted PUT/DELETE/raw ENOENT, before ordinary80/81.
All82 migration identities and empty new initial-capture tables passed.

Its new current fixture then failed at setup: a one-item later upload correctly
used finite preview below the500-item limit, so it had no normalized graph.
Failure occurred before old-task replay. Read-only evidence showed zero
reconcile/reopen actions or claims, intact original task/receipt, capture0 and
private old index retained. The ordinary finite later preview legitimately
added its own PUT/DELETE. This was a fixture error, not an exercised product
recovery failure. That v1 DB is preserved untouched; no reset/retry was used.

Test-only78af9d91 changed the later input to an actual501-item WXR and explicitly
required its501-entry graph/private marker. Every original-marker, exact-task,
verification, recovery, idempotency, no-adoption, snapshot/bytes and no-DELETE
assertion remained. Product/controller source, SQL955, all82 journal identities
and original f1/b716/847 oracles were byte-preserved. Frozen docs-only b0e668ab
contains that corrected fixture.

The second controller used only NEW
`freeholder_uploaded_history_upgrade_v2_test_20261113` and a fresh private
filesystem. Its stricter operational copy SHA is
`fa83cb7693d9fbb95dfd1a48b41c7a2a2ae325f3367f3d7b0f59948808a3c100`.
The qualified source controller remains unchanged SHA
`b2e0737d65aea03ab7189963145b1817a5cda081f8adb24be3a529da6169c2c2`;
the recorded operational diff adds only source/import anchoring and stronger
old-failure/state gates. No prior failure/golden DB was accessed, copied or
exported. No guard was dropped, no SQL fragment was applied and no fixture data
was reset to simulate history.

Actual v2 sequence and result:

1. Ordinary0–79 on the new DB, then the unchanged old f1. Its sole expected
   final-marker failure occurred in5.981s; the exact final source line and
   independent completed/raw-deleted/private501 state matched before upgrade.
2. Authorized ordinary80/81 appended in place to THIS owned populated DB.
   All82 hashes/timestamps matched. Initial scope/member/object tables remained
   empty; old media `source_key_digest` remained NULL.
3. A real fresh owner session created a separate actual501-entry later upload
   through shared services. The retained old task replay reopened its original
   verified intact receipt into in-progress/unfulfilled/pending1 recovery.
   Old task digest and exact keys were preserved; one new self-bound task and
   one original-bound idempotency claim were created through shared services.
4. Repeated reconciliation returned changed=false/reopened0; the artifact was
   unchanged. The real new recovery task refused missing initial membership
   before any physical DELETE. All initial captures remained0; neither old nor
   later graph acquired retirement authority. No namespace/current graph was
   adopted and no original key digest was backfilled.
5. Native original and later graph/input snapshots compared exactly before/
   after. Old private501 entry/media-plan text remains for reviewed recovery.
   The later501 graph/private marker and146000 original bytes remained exact;
   independent SHA matched its live accepted PUT. Total PUT2/DELETE1 retained
   only the old baseline DELETE, with original raw ENOENT and no extra DELETE.

The current recovery case passed1.024s, its process9.543s, and the full controller
26.222s. Independent readback confirmed intact artifact, original task digest,
exact keys on both self-bound tasks, one claim and prepare/reconcile/shared-
reopen audit counts1 each. Fifteen table and schema digests, all82 source/journal
identities, UTC/fsync on/jit off/enforced-readonly profile and empty client
readback were saved. A first read-only collector used unsupported `ends_with`;
its error/script were preserved and a separately named portable `right` collector
completed without native retry or product/database changes. No full-row export
or cloned database was made, and deleted bytes are not claimed recoverable.

Local evidence:

- `/tmp/freeholder-uploaded-history-upgrade-v1-20261113/readonly-classification.json`.
- `/tmp/freeholder-uploaded-history-upgrade-v2-20261113/execution.json`.
- `/tmp/freeholder-uploaded-history-upgrade-v2-20261113/verified-proof.json`.
- `/tmp/freeholder-uploaded-history-upgrade-v2-20261113/independent-proof.json`.
- `/tmp/freeholder-uploaded-history-upgrade-v2-20261113/independent-drain.json`.
- The operational copy/diff are
  `/tmp/freeholder-uploaded-history-upgrade-v2-operational-20261113.mjs` and
  `/tmp/freeholder-uploaded-history-upgrade-v2-operational-20261113.diff`.

Qualification preceding this run: all12 dependency descriptors matched with no
install;586e Node22 full types56.947s/whole lint107.832s; all44 contract files384
pass/26 explicit database skips; nine focused assertions pass/nine native or
upgrade skips. The test-only correction passed types65.232s, changed lint6.475s,
four recovery pures2.719s and one explicit upgrade skip. Canonical637 notes,
licensing2914+8+8, changelog and plan373/323/50 passed. All owned runners drained.
These source skips were not counted as native upgrade evidence.

Current admitted-content and later-generation boundaries also passed on eadc;
see `deploy/import-upload-index-erasure-source-2026-11-13.md`. Still required are
all four stronger WXR/ZIP rollback/privacy cases, public small REST and real
TCP501/two-process publication/rollback, live API/MCP/SDK parity, four-locale
production browser, broader old-image/recovery/record coverage, owner/provider
accounts, independent review and final sign-off. The periodic scheduler and
receipt callback are registered; this fixture specifically exercises duplicate
prepare/shared reopening/idempotent retry, not every crash or scheduler journey.
No C-item or stable/account acceptance is closed by this finite result.
