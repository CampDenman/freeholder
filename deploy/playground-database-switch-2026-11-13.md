<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Playground fixture database-switch proof — C1.38

The protected-CI playground separation test reported visitor graffiti after
its fixture switched back to the production-shaped database. The deterministic
control below isolates the fixture's selected pool from actual physical data.
It does not establish a production-site disclosure or cross-database write.

Exact source0e9d02c0 retains the original test helper: assign the new
`DATABASE_URL`, await core `closeDb`, then clear the cached environment.
Every outer mutation starts the actual job producer, including in test mode;
workers are disabled by default. Its deployment-admission poll and heartbeat
continue to call the lazy core database singleton. `closeDb` clears that
singleton before awaiting the old pool's end. While the helper awaits, a poll
can open a new pool using the still-cached old environment. Clearing that
cached environment afterwards does not clear the newly opened old-target pool.
Awaiting ordinary event dispatch does not stop these resident producers.

TESTONLY88845810 uses the original lexical helper unchanged. It creates only
new nonce-named databases with CREATE-only collision refusal, applies ordinary
0–79 migrations and creates an actual playground visitor/page through the real
services. A spy waits for the actual core close, then holds only its return.
Two actual deployment reconciliation calls join any old poll and force a fresh
one in this interval. No database response or service context is fabricated.
Direct independent production/playground clients inspect physical rows before
the final runtime-namespace oracle. All existing isolation assertions remain.

The first BEFORE genuinely fails15.289s at its final `current_database()`
assertion: runtime selected `freeholder_switch_play79_fea318064823` after the
helper requested `freeholder_switch_prod79_fea318064823`. All preceding physical
assertions pass: production has exactly its original sentinel, zero visitor
graffiti; playground has its actual visitor page and no production sentinel.
Both ordinary journals contain80 exact source hashes/max1793310000059.
The JSON-only reporter suppressed console messages, so pre-oracle facts are
proved by the reached assertions; the independent retained stamp is explicitly
POST-cleanup, not a replay of the forced-interleaving timestamp.

Minimal fix7163da76 drains the actual producer, joins deployment reconciliation
and closes the core pool before synchronously assigning the new environment
and clearing its cache. No await remains between that assignment/cache reset
and the helper return. The entire deterministic probe body stays byte-identical
(SHA256`de5fb3fb4fadf96c1ffe87a42a010e349d151c7f39b3cee6342b40539ac23758`).
Incremental full Node22 types8GB and single-file lint pass. An initial optional
close-gate fixture typing error is separately preserved; no native or timeout
relaxation was used to address it.

The unchanged AFTER first passes12.747s on a NEW pair,
`freeholder_switch_prod79_a8a1273ddc8a` and
`freeholder_switch_play79_a8a1273ddc8a`. The runtime selects production and sees
zero visitor graffiti under the same actual poll. Both direct physical
namespace/page assertions and full ordinary journals pass. Default plus JSON
reporters retain the actual pre-assertion evidence in the AFTER log.

Both native runs execute one selected control, original60s and bail1, without
retry. The dedicated no-dotenv config has `globalSetup:[]` and an exact test
name pattern: older fixed-name helpers/hooks are never selected. The explicitly
new ordinary79 harness is `freeholder_switch_harness79_f7e4ac60e1a5`.
`NODE_ENV=test` and unset NEXT_PHASE/FREEHOLDER_JOBS keep the producer real and
workers disabled; the control positively requires an actual producer instance.

Each post-cleanup stamp retains11 domain-table counts/SHA256s, every source
migration hash and public/drizzle schema hashes. The actual playground runtime
is stopped with zero mounted workers and active jobs; production has no job
runtime. All clients, pairs and harness finish with no active sessions. The
AFTER inspector also rechecks both BEFORE databases: all11 hashes, journals,
page identities and schema hashes remain unchanged. No target is dropped,
reset or reused. A metadata-only classified copy corrects a copied BEFORE
wording in the AFTER timing label; every measured value and the original report
remain unchanged, with no additional SQL or native execution.

Evidence:
- `/tmp/freeholder-playground-switch888-before-native-v1.{json,log}`
- `/tmp/freeholder-playground-switch888-before-populated-proof.{json,log}`
- `/tmp/freeholder-playground-switch716-after-native-v1.{json,log}`
- `/tmp/freeholder-playground-switch716-after-populated-proof.json`
- `/tmp/freeholder-playground-switch716-after-populated-proof-classified.json`

This is fixture lifecycle evidence. It does not supply an independent security
review, deployed platform acceptance or a stable-release signature. Qualification
of the original full separation/reset journeys remains separately recorded.
