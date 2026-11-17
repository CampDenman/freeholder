#!/usr/bin/env bash
# Copyright (C) 2026 Tony Aly
# SPDX-License-Identifier: Apache-2.0
#
# Run the whole source suite locally in ~20 minutes instead of many hours.
#
# WHY THIS EXISTS
# ---------------
# `vitest.config.ts` sets `fileParallelism: false` deliberately — "one sacred
# database means one database for the suite too: files that truncate spine
# tables must not run beside each other". So a single `pnpm test` runs all of
# the suite's files strictly one at a time. CI never does that: it shards
# across CI_TEST_SHARD_COUNT (40) jobs, each on its own runner with its own
# database (scripts/runtime-balanced-sequencer.ts). Run sequentially on one box
# the same work takes most of a day, which is why a full local run was rarely
# seen through to the end.
#
# This reproduces CI's shape on one machine: N shards, one database each.
#
# FOUR THINGS THAT MAKE IT WORK — each was a real failure before it was fixed
# --------------------------------------------------------------------------
# 1. max_locks_per_transaction. Freeholder has ~601 tables. A migration, and
#    the per-file TRUNCATE of every table, take a lock each. The default 64
#    gives 64 * (max_connections + max_prepared_transactions) ~= 7,040 slots
#    for the WHOLE cluster, so concurrent shards die with "out of shared
#    memory". Use 512.
#
# 2. One migration, then template clones. N concurrent migrations is what
#    exhausts the lock table first. Migrate one database, clone the rest with
#    CREATE DATABASE ... TEMPLATE, and run shards with FREEHOLDER_SKIP_MIGRATE=1.
#
# 3. jit = off, set PER DATABASE as well as cluster-wide. If the local
#    PostgreSQL build links llvmjit.so against a libLLVM the host lacks, ANY
#    query whose planner cost exceeds jit_above_cost dies with
#    "PostgresError 58P01 ... cannot open shared object file", whether or not
#    the query is correct — it triggers with single-digit row counts. Note that
#    CREATE DATABASE ... TEMPLATE does NOT copy per-database settings
#    (pg_db_role_setting is keyed by datid), so this must be reapplied to every
#    clone. A mysterious "Failed query" with a huge SQL dump is usually this:
#    grep the output for 58P01 or llvmjit before suspecting the schema.
#
# 4. Put the cluster on tmpfs. TRUNCATE rewrites every table's relfilenode, so
#    N shards means thousands of file create/unlink operations per reset round.
#    That is filesystem metadata work, which more shared_buffers cannot help:
#    tuning memory alone left failures pinned at the 25s statement_timeout that
#    tests/helpers/spine.ts sets. Moving the data directory to /dev/shm cleared
#    them and was worth roughly 12x throughput.
#
# CLUSTER SETUP — disposable, RAM-backed, no root required
# -------------------------------------------------------
#   BIN=/path/to/postgresql/16/bin
#   # initdb needs libpq even where the server binary resolves it already.
#   LD_LIBRARY_PATH=/path/to/lib "$BIN/initdb" -D /dev/shm/fh-pg -U postgres \
#       --auth=trust --no-instructions
#   cat >> /dev/shm/fh-pg/postgresql.conf <<'CONF'
#   max_locks_per_transaction = 512
#   shared_buffers = 2GB
#   work_mem = 64MB
#   maintenance_work_mem = 1GB
#   max_wal_size = 8GB
#   synchronous_commit = off
#   fsync = off
#   full_page_writes = off
#   jit = off
#   max_connections = 200
#   CONF
#   "$BIN/pg_ctl" -D /dev/shm/fh-pg -l /dev/shm/fh-pg.log \
#       -o "-p 55449 -h 127.0.0.1 -k /tmp" -w start
#
# fsync = off and full_page_writes = off are correct here and ONLY here: this
# cluster holds disposable test data and does not survive a reboot. Never copy
# those two settings to anything that keeps data.
#
# USAGE
#   bash scripts/test-sharded.sh                  # 10 shards
#   N=4 bash scripts/test-sharded.sh              # fewer, if the box is busy
#   PGBASE=postgres://postgres@127.0.0.1:5432 bash scripts/test-sharded.sh
set -u

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
N=${N:-10}
STAMP=${STAMP:-$(date +%Y%m%d%H%M%S)}
OUT=${OUT:-"$ROOT/.test-shards"}
PGBASE="${PGBASE:-postgres://postgres@127.0.0.1:55449}"

# Database names must contain "test" or "drill": scripts/schema-baseline-identity.mjs
# refuses to operate on one that does not, a deliberate guard against pointing a
# destructive run at a real database. Some import helpers are stricter still
# (tests/helpers/crawl-index-process.ts requires
# /^\/freeholder_[a-z0-9_]*test[a-z0-9_]*$/), hence this exact prefix.
TEMPLATE="freeholder_test_template_${STAMP}"

mkdir -p "$OUT"
rm -f "$OUT"/shard-*.log "$OUT"/shard-*.rc
cd "$ROOT" || exit 1

echo "=== migrating template $TEMPLATE ==="
node --input-type=module -e "
import postgres from 'postgres';
import { runMigrationsOnDedicatedSession } from '${ROOT}/src/core/migrate-runner.mjs';
const admin = postgres('${PGBASE}/postgres', { onnotice: () => {} });
await admin.unsafe('DROP DATABASE IF EXISTS ${TEMPLATE}');
await admin.unsafe('CREATE DATABASE ${TEMPLATE}');
await admin.unsafe('ALTER DATABASE ${TEMPLATE} SET jit = off');
await admin.end();
const c = postgres('${PGBASE}/${TEMPLATE}', { max: 1, onnotice: () => {} });
await runMigrationsOnDedicatedSession(c, { migrationsFolder: 'db/migrations' });
const [t] = await c\`select count(*)::int n from information_schema.tables where table_schema='public'\`;
console.log('template ready, tables =', t.n);
await c.end();
" || { echo 'template migration failed'; exit 1; }

echo "=== cloning $N shard databases ==="
node --input-type=module -e "
import postgres from 'postgres';
const admin = postgres('${PGBASE}/postgres', { onnotice: () => {} });
for (let i = 1; i <= ${N}; i++) {
  const db = 'freeholder_test_shard_' + i + '_of_${N}_${STAMP}';
  await admin.unsafe('DROP DATABASE IF EXISTS ' + db);
  await admin.unsafe('CREATE DATABASE ' + db + ' TEMPLATE ${TEMPLATE}');
  await admin.unsafe('ALTER DATABASE ' + db + ' SET jit = off');
}
console.log('cloned ${N} databases');
await admin.end();
" || { echo 'clone failed'; exit 1; }

echo "=== launching $N shards at $(date -Is) ==="
pids=()
for i in $(seq 1 "$N"); do
  DB="freeholder_test_shard_${i}_of_${N}_${STAMP}"
  (
    TEST_DATABASE_URL="${PGBASE}/${DB}" \
    FREEHOLDER_SKIP_MIGRATE=1 \
    NODE_OPTIONS=--max-old-space-size=4096 \
      pnpm exec vitest run --shard="${i}/${N}" >"$OUT/shard-${i}.log" 2>&1
    echo $? >"$OUT/shard-${i}.rc"
  ) &
  pids+=($!)
done
for p in "${pids[@]}"; do wait "$p"; done

echo "=== all shards finished at $(date -Is) ==="
fail=0
for i in $(seq 1 "$N"); do
  rc=$(cat "$OUT/shard-${i}.rc" 2>/dev/null || echo '?')
  files=$(grep -E '^ *Test Files ' "$OUT/shard-${i}.log" | tail -1 | sed 's/^ *//')
  tests=$(grep -E '^ *Tests ' "$OUT/shard-${i}.log" | tail -1 | sed 's/^ *//')
  printf 'shard %2d  rc=%s  %s | %s\n' "$i" "$rc" "${files:-NO SUMMARY}" "${tests:-}"
  [ "$rc" != '0' ] && fail=1
done

echo "=== failing files across all shards ==="
grep -hE '^ ❯ (tests|src)/' "$OUT"/shard-*.log 2>/dev/null | sed 's/^ *//' | sort -u || echo 'none'

# A cluster of failures at ~25000ms means tests/helpers/spine.ts's
# statement_timeout was overrun: the box is contended or the cluster is
# mis-tuned. That is infrastructure, not a product defect — lower N, or
# re-check notes 1-4 above, before investigating the code.
echo "=== failures near the 25s spine statement_timeout (contention signal) ==="
grep -hoE '× .*[0-9]+ms' "$OUT"/shard-*.log 2>/dev/null | grep -cE '2[4-9][0-9]{3}ms$' || true

echo "=== OVERALL: $([ $fail -eq 0 ] && echo GREEN || echo RED) ==="
exit $fail
