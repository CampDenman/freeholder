<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original WordPress index erasure containment

C1.08/C3.47/C11.14 remain open. Protected main `81271622` product was tested
with test-only `f1b5d6a3` in an isolated ordinary schema 0–79 database. The
original full-erasure oracle is preserved on that commit in
`tests/core/import-wxr-index-erasure.test.ts`; it is not the containment test.

The real owner session uploaded and indexed a 501-entry synthetic WXR. Its
private marker appeared in an unaccepted entry title and an image plan. No
plan digest, child batch or accepted asset existed. The actual contact
verification, fulfilment, durable worker UUID and original storage receipts
were used. Only Date advanced beyond the actual captured private window,
after every original PUT had settled; timers and physical I/O remained real.
The test failed its final metadata-absence assertion after 5.656845 seconds.

Independent readback confirmed a completed request, `imports.readerSources`
reported erased with zero pending jobs, an invalidated graph, 501 entries,
one marked entry and one marked media plan, and no marked media key. The
original PUT and DELETE were accepted and its physical chunk was absent.
The populated failure and a separate golden clone have matching counts and
SHA-256 for 12 tables, the entire 80-entry journal, and the public/drizzle
schema (4,972 columns and 2,057 constraints). Deleted bytes are not claimed
as preserved. These synthetic local diagnostics are retained outside the
repository; neither database may be migrated or reset.

The no-DDL containment adds a private registered system service. It verifies
the exact retained queue payload and intact verified pending receipt, locks
the privacy identity/request and owning import runs, checks the existing
upload-bound retention exceptions, and acknowledges the task through the
shared privacy service in the same transaction. An unaccepted normalized
graph conservatively requires explicit recovery. The worker refuses only
after that recovery state commits. It does not edit immutable graph rows,
claim safe cleanup from expiry, adopt a later generation, or create tasks.

The candidate has a separate 501-entry containment oracle: raw bytes must be
absent while the same task remains pending, fulfilment time stays NULL,
resolution names index recovery, and private metadata is still acknowledged
as present. The original full-erasure oracle is preserved unchanged on the
before branch for the future guarded minimization proof. Full normalized minimization,
accepted/held negative controls and historical completed-receipt recovery
remain required before stable readiness.


Source qualification passed: Node22 typecheck, whole-repository ESLint, all
44 static contract files (384 passed, 26 declared database skips), license,
release-note and plan gates. The explicit system/private service inventories
and owner feed decision include the new private phase. Agent coding review
identified a completed selective-task retry regression; it was corrected to
require that exact job ID in the retained scope's completedJobs witness.
Native verification at source `951212de` passed without retry:

- The new 501-entry containment case passed in 5.403s. Independent readback
  confirmed the same original task remains pending, request in_progress,
  fulfilled_at NULL, explicit recovery resolution, invalidated graph with
  the private entry/plan still acknowledged, accepted PUT/DELETE and actual
  chunk absence. The new phase's audit contains only request/task identifiers.
- The unchanged existing outage, physical removal and replay positive passed
  in 6.676s on a separate initially empty database. Independent readback
  confirmed completed/erased, zero pending tasks, physical chunk absence and
  both original-task completion/replay audit entries.
- The other 14 existing raw-source erasure controls passed (61.844s summed
  case time), excluding the positive already run. Coverage includes explicit
  holds, storage switches, unresolved writes, reserved chunks, audit copies
  and import/erasure races. Final independent readback confirmed the last
  generic-source case remains pending with its original private chunk intact.

All three databases retain the original full 80-entry schema journal and
have no remaining client sessions. The new database's ordinary 0–79
migration passed in 5.371s with fsync on, jit off and no recovery. The actual
failing source/golden databases were not migrated, reset or reused. A
standalone inspector syntax error was corrected before it connected; no
native test was rerun as a result. Private metadata minimization remains
unfinished: this is a completion containment proof, not a full-erasure pass.
These checks do not supply C11.10 independent review.


The first protected CI head `ea222dfc` failed two resumption privacy cases
(WXR and ZIP) in shard15; 207 cases in that shard passed. Those older cases
expected completion after rollback even though 500 unaccepted normalized
entries remained. The guard correctly refused. The cases now place the
actual private marker in an indexed early title and explicitly require raw
chunk absence, retained marker, unchanged pending job, NULL fulfilment time
and recovery after rollback. No product guard, assertion timeout or physical
proof was relaxed. Agent coding review agreed that rollback is not index
minimization. The changed fixture passes incremental typecheck and lint;
its four native cases are pending. This is a deliberate stronger privacy
contract, not a claim of full minimization.
