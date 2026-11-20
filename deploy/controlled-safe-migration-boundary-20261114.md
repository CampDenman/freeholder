<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# C11.10/C11.08/C1.08 migration boundary — SOURCE ONLY

This isolated leaf starts at `7ee71e2f`. It changes no normal migration SQL or
journal entry and performs no execution, compilation, parser, database,
provider, host, build or SDK action. Every control below is PREPARED/UNRUN.
The accompanying source manifest stores each complete old file, complete
before/after SHA, finite byte-offset reversal and all old normal SQL/journal
identities. Its decoded archival strings preserve exact old bytes; standard
JSON Unicode period escapes avoid introducing obsolete plan references.

The 14 approved core/fixture/packaging paths are:

- `src/core/migrate.ts`: same skip/no-URL/client options/result/finally-end.
- `tests/setup/migrate.ts`: same test URL/no-URL/client/finally semantics;
  deliberately does not honor the production skip flag.
- `src/core/migrate-runner.mjs`: env-free shared runner.
- `src/core/migrate-runner.d.mts`: precise actual-client/official-meta types.
- `db/migrations/meta/controlled-safe-response-boundary.json`: reviewed boundary
  identity, with final predecessor85/whole86/prefix hashes explicitly NULL.
- `tests/core/migrate.test.ts`: setup-only old-cohort mocks; BOTH original
  lock/close/failure test bodies, assertions and error identity unchanged.
- `tests/core/migrate-boundary.test.ts`: source identity/reversals, synthetic
  unit-only metadata refusal, real fake-env child and packaging source checks.
- `tests/modules/migrate-boundary86.test.ts`: six real PostgreSQL groups and a
  separate real artifact import probe, described below.
- `tests/fixtures/controlled-safe-response-first-guard86.sql`: EXACT frozen S0
  first split statement, comments/newlines included, 2038 bytes,
  SHA `14b90f4109f06e5457ddaa0b0c0210516092f0e2e6d8965d067eca7c3370b8d4`.
- `scripts/migrate.mjs`: actual manual CLI; existing config URL fallback,
  standard `.env` via Node22 `process.loadEnvFile`, existing environment wins,
  no production skip flag, fixed bounded failure output, finally-close.
- `package.json`: `db:migrate` calls `node scripts/migrate.mjs`.
- `tests/core/playground.test.ts`: exactly two former direct official calls
  use the same dedicated-client runner; all original business oracles remain.
- `Dockerfile`: explicit copies of only the new CLI and MJS runner.
- `scripts/build-release.mjs`: copies exactly those two files at matching
  relative paths; existing whole `db` copy includes metadata.

MASTER, this note, changeset and manifest are documentation/evidence, not
additional runtime helpers. No services, public inputs, schema, columns,
triggers, dependencies, flags, fake transaction or journal rows are added.

## Actual engine and source identity

Official Drizzle0.45.4 `readMigrationFiles` supplies whole-file hashes, original
SQL split statements, breakpoint flags and folder timestamps. The actual
`new PgDialect().migrate` engine wraps all supplied pending entries in one
`session.transaction`; therefore calls are before86 / exact86 / after86 on the
SAME actual `drizzle(client)._.session`. No raw BEGIN/COMMIT, copied database,
manual applied row or guard exemption appears in the runner. Caller-created
max1 clients retain close ownership. One original Free/hold session advisory
lock covers the complete invocation and all official engine calls.

A valid source cohort below87 entries retains the old official `migrate`
call. Any boundary claim requires contiguous exact source indices, increasing
original timestamps, matching official timestamps/breakpoints, exact index86,
tag `0086_controlled_safe_response`, timestamp1793310000066 and whole first
statement SHA. Reviewed non-NULL whole85/whole86/canonical ordered0..85 hash
pins are mandatory before migration starts. NULL metadata currently REFUSES.

After the genuine prefix engine call commits, all actual journal rows are
read on the same session, checking complete timestamp/hash membership in
source order, unique timestamps and minimum committed prefix size. SERIAL ID
gaps are allowed; IDs are not manufactured. The same check follows exact86.
This detects drift and does not invent rows. Existing later valid source rows
are checked too. Subsequent entries use the official engine after86.

## Prepared real acceptance contexts

`tests/modules/migrate-boundary86.test.ts` creates NEW uniquely named scratch
DBs using the declared disposable server, never overwrites/drops existing DBs,
never copies an old DB or invents applied rows. All scratch DBs and safe
journal/XID evidence are preserved for independent root inspection. All source
0..85 files are copied byte-exact into temporary directories. Temporary86 is
the EXACT frozen first guard followed by a later probe/intentional failure;
its temporary metadata honestly pins that temporary file. This is ONLY a
boundary fixture, NOT installed S0 schema acceptance.

1. Fresh complete0..85 commits in a genuine official engine transaction;
   row86 has a different actual xmin. The later probe proves the real prefix
   xmin was visible and correlates actual transaction ID with row86.
2. Genuine prior12-entry official commit survives; remaining prefix commits
   separately before86, preserving the actual first12 rows exactly.
3. A later intentional P0001 in86 rolls back probe/row86 while all86 prefix
   journal rows and their actual transaction remain committed.
4. Another real same-DB client makes the exact guard refuse55006.
5. An ACTUAL PREPARE TRANSACTION makes the guard refuse55006. A disposable
   server with `max_prepared_transactions>0` is REQUIRED. A zero setting
   explicitly fails with an OPEN prerequisite, never substitutes fake rows or
   reports pass. Actual prepared work is rolled back after the proof.
6. A real second bootstrap waits on the same session advisory lock; first
   session discovers that actual waiter without a third observer. The first
   guard refuses55006. The waiter is cancelled, awaited and closed BEFORE
   releasing the first session; no parallel-boot tolerance is claimed.

Root must independently capture/drain each real DB and preserve failures.
The scratch proof file in the temporary directory contains only generated DB
names/case labels/actual journal hashes and transaction IDs, never URLs or
credentials. Test-config URL isolation remains unchanged. These tests do not
use a fake ServiceContext, Tx or current financial proof.

## Manual and packaged runtime boundaries

The manual CLI's fallback URL is EXACTLY drizzle.config.ts's development
fallback. It loads only its caller's `.env` using Node22's standard loader;
existing environment values win, an absent file is ordinary, and unreadable
or malformed load errors become fixed output. It never prints URL, exception
name/message/stack/query/params/cause or arbitrary code values. Error-code
selection uses only fixed allowlisted values and contains hostile getters or
proxy traps. The prepared fake-env child controls pass only fake values and
PATH; importing the CLI does not load environment or connect.

Packaging copies only `scripts/migrate.mjs` and
`src/core/migrate-runner.mjs`, preserving their relative import. No dependency
or entire source copy/install is added. The separate artifact test requires
actual `FREEHOLDER_MIGRATION_ARTIFACT_APP` and
`FREEHOLDER_MIGRATION_ARTIFACT_NODE` test paths. It verifies exact two file
bytes and db metadata, then imports them using the actual bundled runtime
with no inherited secrets and NO environment load/provider/database I/O.
Those are test harness inputs, not public runtime authority. Missing artifact
paths are an explicit skipped/OPEN prerequisite; source copy assertions are
not an artifact pass. If actual Drizzle/postgres/zod resolution fails, report
its exact licensed existing dependency-file inventory before adding copies.
Nothing here claims packaged manual operation is qualified.

## Required integration and rollout

Root must pin the REAL final85, full86 and ordered prefix identities only
after final source assembly and append the genuine normal86 entry. The current
NULL metadata is intentional. Source-pinned file assertions require an exact
finite continuation when root adds those reviewed real pins; do not reset an
old expected hash. Existing original SQL0..85/journal hashes remain unchanged
by THIS leaf; subsequent root composition preserves its newer exact source.
Historical79 import qualifier and baseline-only engine calls are unchanged,
not safe-response boundary evidence.

External CLOSED-SET OS/runtime stop and real backend/prepared drain are still
mandatory. Fresh pg_stat_clear_snapshot inventories plus sorted9-table AX
NOWAIT locks do NOT close the new-backend race. An advisory-lock waiter is
another real backend and correctly refuses. Old unsafe callback validation,
FIN history/current safe-projection requirements, S0/S1 readiness/full-body
pins and B-ready composition remain independent required work. No historical
raw/FIN/MAC/PG bytes are rewritten or re-signed, no old POST is replayed.
Current launch/stable acceptance and full prescribed scope remain open.
