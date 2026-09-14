<!-- Copyright (C) 2026 Tony Aly -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Performance measurements (C11.11)

Use an explicitly disposable database: the harness migrates and truncates it,
then inserts and verifies every record count in the selected fixture. The
medium fixture is 5,000 contacts, 20,000 messages, 2,000 orders, 500 products and
10,000 asset metadata rows. Storage bytes and external providers are excluded.

```sh
TEST_DATABASE_URL=postgres://USER:PASSWORD@HOST/freeholder_perf_test \
PERF_DATASET=medium PERF_MEASURE_JOBS=1 pnpm perf:budgets
```

The JSON measurements in the output include twenty queue samples and the
number of completed probes. Each probe commits through the application's
transactional enqueue path, and the registered application worker must execute
it. The elapsed time uses pg-boss's database `createdOn` and `startedOn`
timestamps, so it measures enqueue to claim without mixing process clocks.
The nearest-rank p95 is compared with the unchanged §15.1 thirty-second limit.
Missing, failed, cancelled, duplicate or invalidly timestamped probes fail the
run. Tests do not invoke handlers directly or fetch jobs manually.

These sequential probes measure baseline dispatch latency in an otherwise idle
probe queue. They do not establish throughput, backlog behavior, provider
latency or worker cold-start time. Normal queue concurrency and polling apply;
the harness does not accelerate the worker for the measurement. The worker is
stopped and its environment setting restored after success or failure.

Small and medium measurements on a developer machine are diagnostic results.
Completion requires the medium fixture on the actual §15.1 reference target
(1 vCPU / 1GB), with its production database settings and storage. Keep the
commit, host configuration, command and complete output with that acceptance
run. A disposable local database configured for faster functional tests is not
reference-host evidence.

Browser/Core Web Vitals, editor, migration and cold-boot clocks remain
unimplemented; requesting them fails rather than passing skipped work. Large
fixtures check bounded pagination, and cannot silently pass requested missing
auxiliary measurements. C11.11 remains open until every required measurement
and the reference-target acceptance are complete.
