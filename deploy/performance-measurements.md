<!-- Copyright (C) 2026 Tony Aly -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Performance measurements (C11.11)

Use an explicitly disposable database: the harness migrates and truncates it,
then inserts and verifies every record count in the selected fixture. The
medium fixture is 5,000 contacts, 20,000 messages, 2,000 orders, 500 products and
10,000 asset metadata rows. Storage bytes and external providers are excluded.

```sh
# TEST_DATABASE_URL names the disposable database by parts — host, port,
# database and the local superuser's credentials — rather than as a URI:
#   host 127.0.0.1, port 55432, database freeholder_perf_test,
#   user and password of the local postgres superuser.
PERF_DATASET=medium PERF_MEASURE_JOBS=1 pnpm perf:budgets
```

Every measurement run prints a header with the commit, host configuration,
command and the families it ran. Keep that header and the complete output
with any run cited as evidence; it is what distinguishes a diagnostic local
run from the §15.1 reference-target acceptance.

## Server surfaces (always measured)

The seeded measurement times the service-layer clocks the §15.1 table names —
admin list, admin detail, search, report and the CMS block render with real
HTML serialization — and evaluates nearest-rank p95 against the budgets. When
the browser family runs, the three surfaces it honestly covers through
whole-page HTTP timing ("Public page, server render", "Admin list (any)",
"Admin detail") are evaluated on the browser numbers instead; the
service-layer values remain in the JSON detail for comparison.

## Job queue latency (`PERF_MEASURE_JOBS=1`)

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

## Browser Core Web Vitals and whole-page HTTP (`PERF_MEASURE_BROWSER=1`)

Requires `PERF_HAS_PLAYWRIGHT=1` and a production build (`pnpm build` first —
the harness refuses to measure a dev server). The harness starts the
standalone build on `PERF_BROWSER_PORT` (default 3100, which must be free),
seeds a real owner session cookie, and drives headless Chromium over:

- the public storefront page (`/perf-home`, the seeded published CMS page —
  `/` on this fixture renders the pre-setup placeholder, which is not
  representative storefront content),
- one admin list (`/admin/contacts`),
- one admin detail (`/admin/contacts/{id}`).

Core Web Vitals are read from PerformanceObserver entries injected by the
harness (no `web-vitals` dependency): LCP from
`largest-contentful-paint`, CLS from un-flagged `layout-shift`, INP from
`event` entries with an interaction id. INP is an honest lab approximation of
the field metric: after each load the harness performs real inputs through
Chromium's event pipeline (a click on the page heading plus key presses), so
an INP sample is the worst interaction latency that load actually produced.
Zero interaction entries fail the run rather than report a fabricated INP.
Event durations are quantized to 16ms buckets, so lab INP is deliberately
coarse — it can prove a violation, and cannot prove much about small
differences under the threshold. "Server render" is the document's
time-to-first-byte, which on localhost has no real network component; the
reference target's number will include it.

Sample strategy: one discarded warm-up load per surface (it pays first-hit
compilation, connection and cache costs that steady-state loads do not),
then `PERF_BROWSER_SAMPLES` loads (default 7) in one browser context. LCP,
INP and CLS report p75; server render reports p95, matching the budget table.
A load that produces no LCP entry or no navigation timing fails the run.

Limitations: lab Chromium over localhost is not field data; the p75 in the
table exists for real-user distributions, and only the §15.1 reference target
can produce those. CLS in a lab load with no late-shifted content undercounts
what ad-hoc layouts do in the field.

## Editor clocks (`PERF_MEASURE_EDITOR=1`)

Same prerequisites and server as the browser family (both flags share one
standalone server). On `/admin/pages/{id}` of the seeded fixture page:

- **First paint** — the FCP of the editing-surface navigation, after asserting
  the fixture title, the block palette ("Add a block") and the preview frame
  are present; one warm-up navigation is discarded, then `PERF_EDITOR_SAMPLES`
  navigations (default 7), reported as p95.
- **Keystroke → preview** — a real keypress in the heading field, then the
  same-origin preview iframe is polled until the typed token renders in it;
  the clock is keypress to observed preview paint, `PERF_KEYSTROKE_SAMPLES`
  times (default 5), reported as p95. One warm-up keystroke is discarded
  first (and its autosave awaited) so one-time type/poll costs and the
  save-triggered frame reload never land inside a timed sample — the same
  discipline as the discarded warm-up navigation in the first-paint family.

The editor overlays its local draft onto the preview frame's typeable
elements in the same commit as each keystroke (no autosave wait, no server
round-trip); autosave still debounces at 1.2s and a save still reloads the
frame from stored state, reconverging anything a text patch cannot express.
The harness reports the number the product actually produces; on this
developer host the steady-state clock sits at the measurement floor
(keypress pacing plus one poll tick), so the row's reference-target evidence
must come from the acceptance run, not a local run.

## Migration wall-clock (`PERF_MEASURE_MIGRATION=1`)

§15.1 budgets "Migration, medium dataset ≤ 60s total — the update window an
owner will actually accept". The honest local measurement of that window is
the full collapsed chain (`0000_reviewed-baseline` → latest in
`db/migrations`) applied to a **fresh** disposable database created beside the
measurement database, timed through the same drizzle migrator production boot
uses (`migrateToLatest`, advisory lock included). It is the largest migration
workload any instance can pay and the only one reproducible without
snapshotting the medium fixture at every historical schema version; on the
reference target it is also what a fresh deploy pays. What it cannot prove is
backfill cost over a populated medium dataset — the chain's data migrations
run over empty tables here — and the run is not accepted as evidence of that.
The apply is validated by counting `drizzle.__drizzle_migrations` journal
rows against the file count before the fresh database is dropped; a mismatch
fails the run. The test database user needs CREATEDB (the local superuser has
it); without it the run fails closed.

## Cold boot to serving (`PERF_MEASURE_BOOT=1`)

Requires the production build (`.next/BUILD_ID`; `pnpm build` first). The
harness spawns the real `pnpm start` `PERF_BOOT_SAMPLES` times (default 3, the
minimum) and reports the nearest-rank p95 of process spawn → first HTTP 200
on `/api/health/live`, against the ≤20s budget. Each boot runs against the
already migrated and seeded fixture database — the restart scenario the
budget row exists for ("Replit and a restarted droplet both pay this on every
deploy") — with migrations at boot, module graph, onboarding sync and the job
runtime all included. After each timed sample the instance must also reach
readiness (`ok: true` on `/api/health`) within 90 seconds or the boot fails:
a process that answers liveness but never serves is not "serving". The
pg-boss schema is warmed once in-process before the timed boots so every
sample pays identical job-runtime work. Ports are scanned from 3101 upward to
avoid the browser-server port.

## What runs where

Small and medium measurements on a developer machine are diagnostic results.
Completion requires the medium fixture on the actual §15.1 reference target
(1 vCPU / 1GB), with its production database settings and storage. Keep the
commit, host configuration, command and complete output with that acceptance
run. A disposable local database configured for faster functional tests is not
reference-host evidence. All six families (server surfaces, browser, editor,
jobs, migration, cold boot) are implemented and fail closed when requested
without their capability; none is accepted as met until the reference-target
run passes. Large fixtures check bounded pagination, and cannot silently pass
requested missing auxiliary measurements. C11.11 remains open until the
reference-target acceptance is complete.
