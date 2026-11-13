<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Historical uploaded erasure: source-only recovery

C1.08/C3.47/C11.14 remain open. Frozen acbb/SQL955 passed fresh ordinary0–81,
22-model/guard checks, the unchanged original501-WXR full-erasure AFTER, the
unchanged b716 URL-key AFTER and the held-upload boundary. Those finite proofs
do not cover an older79 receipt that already claimed completion while retaining
private normalized input. This new historical-recovery source is unqualified.
No compiler, lint, tests, database, migration or native execution was performed
for it. SQL81 remains byte-identical955a04d2; SQL80 remains3a686245.

A retained self-bound `core.eraseImportSourceObjects` task identifies its exact
request and original chunk keys. Reconciliation requires the verified original
request, applied fulfillment audit and intact receipt before shared job
reopening. It never selects a current graph, reconstructs an original source
set, inserts a capture, backfills a digest or treats missing bytes as erasure.
Invalid task/applied/receipt evidence stays explicit recovery, with no fabricated
replacement artifact or key set.

`imports.reconcileOriginalSourceErasure` is a private SYSTEM service. It uses
`privacy.reopenErasureJob` in the same service transaction, copies keys only from
the retained original task, preserves verification and existing retention
outcomes, and sets a truthful pending recovery status. The idempotency key binds
the original task; reconciliation-created retry tasks are excluded from future
original-task selection. A replay cannot grow a retry chain. Each bounded100-row
page admits its continuation durably. Physical-observation callbacks and a
five-minute registered worker provide normal and missed-callback entry points.
All locks follow identity, privacy request, then receipt order. No provider I/O
runs in the reconciliation transaction.

Duplicate prepare and ACK paths now enter this service when an erased legacy
receipt lacks complete initial membership. The old task can finish its replay,
but its request no longer falsely remains complete. The new pending recovery
task still fails the ordinary complete-initial-scope admission before physical
I/O or ACK. Current initial membership is never adopted. Historical missing
capture therefore requires reviewed recovery; this change does not invent a
repair that can safely erase that unknown graph.

A new opt-in populated upgrade fixture is prepared:

1. `tests/fixtures/run-uploaded-history-upgrade.mjs` demands an explicitly NEW,
   absent test database and fresh private filesystem. It pins the actual old
   source to f1b5d6a3 and unchanged oracle blob4a470c34, checks all published0–79
   identities, and uses the ordinary0–79 migrator.
2. The unchanged old-runtime f1 runs once at its original60s/bail1/retry0. The
   controller requires the genuine false-completed result: completed/erased,
   verified original task retained,501 indexed entries/private marker and
   accepted PUT/DELETE with physically absent original bytes. A different
   failure stops before upgrade. Only synthetic IDs, counts and digests are
   saved; no full-row export or cloned database is made.
3. The ordinary current migrator appends exact80/81 to that owned populated
   database and checks all82 journal identities. New initial-capture tables
   must remain empty. No standalone SQL fragment, dropped guard or reset is used.
4. `tests/core/import-uploaded-history-upgrade.test.ts` has an explicit fixture
   gate and no truncate. It creates a real later reviewed upload through actual
   owner services, replays the retained original task, proves shared reopening
   and idempotent replay, and proves the new recovery worker refuses before any
   physical deletion. Original and later graph/input snapshots remain exact;
   all initial-scope tables remain empty. Original task identity, verification,
   intact artifacts and keys are preserved. Old deleted bytes are never claimed
   recoverable.

The fixture requires a later explicit native lane grant, exact qualified current
HEAD, `FREEHOLDER_HISTORY_BEFORE_SOURCE` pointing at the pinned old worktree,
`FREEHOLDER_HISTORY_UPGRADE_DATABASE` matching
`freeholder_uploaded_history_upgrade_v1_test_20261113` (or a new numbered name),
`FREEHOLDER_HISTORY_OUTPUT` naming a fresh `/tmp` directory, and
`FREEHOLDER_HISTORY_EXPECTED_HEAD` naming the qualified current commit. It never
opens any prior failure/golden database. The first unexpected failure preserves
its new database, filesystem and logs and stops the pipeline.

Four meaningful task-evidence/source controls are also prepared in
`tests/core/import-uploaded-history-contract.test.ts`. They cover exact retained
identity/keys, different request/task refusals, malformed/empty/excessive keys,
and the shared idempotent recovery path without current graph or capture writes.
They are not database or upgrade acceptance evidence.

Outstanding proof includes source qualification of this change, the actual new
populated fixture, current-flow regression after callback registration, admitted
content and later-generation boundaries, public HTTP and independent-process501
lifecycle, old-image recovery, owner/provider acceptance and independent review.
MASTER.md §43 is the only status authority; no item is checked by this source.
