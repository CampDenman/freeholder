<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Always-final migration journal verification — SOURCE ONLY

This finite descendant preserves frozen DCO68b4f143 and its complete source
manifest byte-exact. No execution, parser/compiler/test/PG/provider/build/SDK
or root checkout action was performed. All acceptance controls remain UNRUN.

Exactly one runtime line is added to `src/core/migrate-runner.mjs`: after the
optional official later-batch migration, ALWAYS await
`verifyCommittedPrefix(session, plan.all, plan.all.length, config)`. This runs
also when the later batch is empty. It uses the SAME genuine session and still
held original Free/hold session lock; old-cohort official-path behavior and all
caller-close/skip/no-URL semantics remain unchanged.

Two existing test files receive bounded continuations. The core source test
first authenticates the complete new three-file source layer, reverses exact
byte ranges to frozen68 bytes and checks the unchanged whole68 manifest SHA
before its original14 hashes/reversals. Only runner/core-test/native-test paths
are allowed in this layer. Both ORIGINAL production lock/close/error test
bodies, frozen68 source manifest, normal SQL0..85/journal, guard fixture,
metadata NULL pins, CLI and packaging remain byte-exact.

The actual PostgreSQL fixture opt-in adds a genuine temporary87 ONLY:

- Positive: `SELECT 87` (no extra DDL). Official before86, exact86 and after86
  engine transactions create all88 real rows. A genuine driver debug callback
  counts the three actual complete-journal SELECTs without recording SQL
  parameters; full actual timestamp/hash membership and distinct real87 xmin
  are asserted.
- ADVERSARIAL NEGATIVE: after official engine genuinely committed0..86, the
  genuine temporary87 deliberately UPDATEs that actual already-applied86 hash
  to all zeroes, then the official engine writes its actual87 row and commits.
  Final verification MUST throw exact FH_MIGRATION_PREFIX_MISMATCH. The full
  prefix0..85 remains exact, real87 hash is correct, changed86/87 actual xmin
  agrees, and the genuine86 probe preserves its separate original transaction
  and prefix85 xmin. All88 real rows remain inspectable. This scratch DB is labelled
  corrupted negative evidence and preserved; it NEVER fabricates/fills an
  applied prefix or claims successful schema/S0 acceptance. No root failed DB
  or existing source journal is mutated.

Those fixture migrations are created ONLY in a new temporary source directory
and NEW isolated scratch DB. No new normal entry, header, product SQL, DDL,
model, trigger, service, public input or helper file is introduced. Existing
six PG proof groups and real-artifact prerequisite remain unchanged. Frozen68
whole-file bytes are retained in the successor manifest, with standard JSON
Unicode period escapes only for archival strings and decoded SHA unchanged.
Root must run source qualification and both real native controls, retain/drain
independent DB evidence, review final source pins and prove packaging and actual
external closed-set drain. No qualification or stable-delivery claim is made.
