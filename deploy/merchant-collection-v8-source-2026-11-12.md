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
