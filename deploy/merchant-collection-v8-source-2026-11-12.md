<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Unpublished normal80 v8 composition (C1.08/C3.47/C12.38)

This NEW isolated source candidate starts at financialf0c61f8e. The previously
qualified financial source, normal-v7 database and SQLd060 remain unchanged.
No populated history or qualification is silently transferred to the new SQL.

The source composition applies the actual hold-transaction callback once via
21d98bea (the equivalent earlier544/5b callback is not applied again), then
669b7ae2's normalized original retention snapshots/members and cleanup admission.
Imports source/evidence is c9b85c00,3f263cc8,d4322e78,c4b1f32c,15dd3fbc,31035022.
The new fragment is appended at the end of the owned assembler list. Every
previous composed source-fragment byte remains identical and in the same order.
Only an operator comment is added to the common header, explicitly extending
stop/drain requirements to privacy retention, capture and import/storage cleanup.
No already-admitted provider call is fenced by pretending a SELECT trigger or
absence proof exists.

New assembled80 SQL SHA256:
`1ac4652c6e4234cdf07848b244368eca30108b00b3eb54f1eeacfe0f83d4e2c8`.
The exact root-owned retention fragment SHA256 is
`72737e0e81e8da96b7fdb1cce88a64b5615c25afbc1a3eff5f8511096b0c06ec`.
It creates normalized privacy_retention_source_snapshots and
privacy_retention_source_members, with original hold foreign keys, membership
bounds and guarded capture. Missing historical capture is never backfilled as
known-empty. The original signed component evidence documents remain authority
for their respective earlier source checks/native results.

At this composition checkpoint there has been no full source check, database
application or native v8 run. Canonical release-note regeneration, bounded source
checks, a NEW ordinary0–80 v8 migration and explicitly selected native controls
remain required. Do not run this source against the old normal-v7 database or
claim actual provider/cold-runtime/populated-upgrade acceptance from composition.
The new merchant model remains disabled; C12.38 and the full stable gate stay open.


Source qualification of the composed candidate (2026-11-12): full Node22
TypeScript, changed-source ESLint and changed compatibility-test lint pass.
Finite source batches supply 29 unique passing controls; 24 database controls
are explicitly skipped. The first batch preserved a stale compatibility-test
failure: its inventory admitted renames only for76/79, despite actual80's
subscription-column rename and explicit breaking-upgrade declaration. The
correction requires that exact rename, its stop/drain/cold-readiness/exact
pre-upgrade restore/provider-effects rollback text and the additional original
retention cleanup stop requirement. It still rejects a compatible declaration.
Only the failed four-case inventory group and the unrun three release-note
controls were repeated. Existing passed controls were preserved.

Actual canonical release-note generation and the subsequent three controls
pass; SQL remains the exact hash above. Logs are
`/tmp/freeholder-collection80-v8-{types,lint,contracts}-v1.*` and
`/tmp/freeholder-collection80-v8-{schema,changelog,testlint}-v2.*`.
A new normal-v8 migration, actual model-to-SQL parity for both new retention
tables, the unchanged actual legacy hold test, canonical lifecycle controls,
provider/runtime upgrade and full product acceptance remain unqualified.


Fresh ordinary migration qualification (2026-11-12): exact sourcef64c54db,
SQL1ac4652c, NEW database
`freeholder_collection80_normal_v8_test_20261112`. The actual normal0–80
Drizzle migration passed5.877s, with81 journal entries and latest timestamp
1793310000060. There was no explicit fragment application or change to v7.
The diagnostic loads the actual two retention models from this source and
compares their SQL columns/types/null/default presence, ordered primary keys,
foreign-key columns/targets/delete actions and check names. Snapshot parity
is5columns/1PK/1FK/3checks; membership is4columns/1PK/1FK/0checks. Six actual
retention triggers and the two declared indexes are present, alongside the
prior fifteen refund tables/seven guards/setup fields. Runner exited0; a
separate read-only activity check returned no active v8 database work.

Script and log: `/tmp/freeholder-collection80-normal-diagnostic-v8.mjs` and
`.log`; drain `/tmp/freeholder-collection80-normal-diagnostic-v8-drain.json`.
This fresh schema proof supplies no native domain lifecycle, populated history
upgrade, old-software readiness, real provider or stable acceptance. The
unchanged legacy hold and canonical lifecycle controls are the next separate
qualification steps under the shared database allocation.
