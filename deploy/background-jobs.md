# Background-job operations

Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0

Freeholder runs background work through pg-boss in the same Postgres database
as the application. It does not require Redis or a hosted queue. pg-boss owns
its execution tables in the `pgboss` schema; Freeholder owns only the bounded
`job_idempotency_keys` table in `public`.

## The transaction boundary

A service enqueues caused work with `ctx.queueJob(...)`. Infrastructure code
that already owns a Drizzle transaction calls `enqueueJob(tx, ...)`. There is
no exported best-effort `send()` function.

The pg-boss row is inserted through its Drizzle transaction adapter. The
business mutation, audit row, idempotency claim and queue row therefore share
one commit. If any insert fails or the service throws later, all four roll
back. Code must not enqueue after a service returns or from an uncommitted
event listener.

Outbound webhook fan-out is the first production caller of this contract. Its
delivery rows and immediate `core.deliverWebhooks` nudge are atomic. If queue
storage is unavailable, the listener fails and the transactional outbox keeps
the source event for retry.

## Queue policy

Every `defineJob()` declaration owns these limits beside its handler:

| Policy | Default | Meaning |
|---|---:|---|
| retry limit | 5 | Attempts after the first failure |
| retry delay | 30 seconds | Initial delay |
| exponential backoff | on | Delay grows with pg-boss jitter |
| retry ceiling | 1 hour | Maximum delay |
| concurrency | 1 | Global active jobs for that queue across all replicas |
| lease | 15 minutes | Lost-worker timeout |
| heartbeat | 60 seconds | Automatically refreshed by the active worker |
| terminal history | 30 days | Time pg-boss keeps completed/failed/cancelled rows |

Definitions may tighten or expand these within validated bounds. Freeholder
passes both local and database-backed group concurrency to pg-boss. Merely
setting per-process concurrency is insufficient when two app replicas share a
database.

Queue definitions are reconciled at boot, so retry/lease changes take effect
on an existing instance without deleting its queued work. Queue names and
policies are stable contracts; renaming one is a data migration, not a code
cleanup.

## Idempotency

`idempotencyKey` identifies one logical operation within a job name. Use an
opaque business identifier such as `invoice-send:<invoice-id>:<revision>`;
never put a password, API token, message body or other secret in the key.

- Matching name, key and canonical payload return the original job ID with
  `deduplicated: true`.
- Reusing the same name/key with different data fails the caller transaction.
  It is a programming error, not permission to replace already queued work.
- Concurrent callers serialize on the database unique index and converge on
  one job.
- Claims live for 30 days by default. Callers may set a bounded TTL from one
  minute to one year when the business operation has a different replay
  horizon.
- `core.pruneJobKeys` deletes expired claims daily. Once a claim expires, the
  key may intentionally represent a new operation and receives a new job ID.

Handlers still must tolerate retries. An idempotency key prevents duplicate
enqueue requests; it does not make an external provider atomic with Postgres.
A mail, payment or webhook handler uses the provider's own idempotency key or
records its provider reference before declaring success.

## Leases and cancellation

pg-boss marks a fetched job active and Freeholder configures a heartbeat for
every queue. The worker refreshes it automatically. If a process disappears,
the supervisor returns the expired job to retry until its retry limit is
exhausted.

Handlers receive a `JobExecutionContext` with:

- `signal`, aborted during worker shutdown;
- `attempt`, starting at one;
- `heartbeat()`, for an explicit safe-point refresh;
- `isCancelled()` and `throwIfCancelled()`, for durable cooperative
  cancellation.

Queued and retrying work stops before execution when cancelled. Active code
cannot be safely interrupted in the middle of an arbitrary external side
effect, so long handlers call `throwIfCancelled()` between atomic units. A
handler must not swallow `JobCancelledError` and continue.

`cancelJob(tx, name, id)` and `retryJob(tx, name, id)` accept the caller's
transaction. The permissioned services and owner console use these same
transactional primitives; the UI does not edit pg-boss tables directly.

## Owner history and recovery

Staff with `platform` view access can inspect retained work at `/admin/jobs`.
The summary and filters read pg-boss itself, so the screen cannot drift from a
shadow history table. Run detail shows queue policy, retry count, lease times,
source identity and retained payload/output. Secret-shaped fields are redacted
recursively before they reach the UI. Agents and API keys cannot inspect this
surface even when they hold a broad platform scope because job payloads may
contain cross-module customer data.

Every ordinary queue sends work that exhausts its retry policy to the retained
`core.deadLetter` queue. Dead letters keep their original queue, run ID, age
and retry count for 90 days. No worker consumes that queue automatically: a
person must inspect the failure, correct its cause, and deliberately redrive
it. The overview briefing calls out failed, dead-lettered and lease-overdue
work without exposing payload data.

Cancel, retry and redrive require `platform` manage access, a fresh step-up
proof and exact typed confirmation (`CANCEL`, `RETRY`, or `REDRIVE`). Each
action runs through a service transaction, writes the audit trail and emits a
committed event. Redrive is intentionally rate-shaped one retained failure at
a time in the owner UI; automation can use the same service with a bounded
batch after a human has diagnosed the source queue.

An active run is shown as lease-overdue when its latest heartbeat (or start,
before the first heartbeat) is older than the configured heartbeat/lease
window. That is an operational signal, not permission to enqueue a duplicate:
the pg-boss supervisor remains responsible for lease expiry and retry.

## Process layouts

The default is one process: instrumentation registers definitions, reconciles
queues and schedules, then mounts workers. This is the correct Tier-1 shape
for a single Replit or Droplet deployment.

`FREEHOLDER_JOBS=off` prevents that process from executing handlers. It still
starts the producer half, because web requests must enqueue transactionally
for a dedicated worker. A separate process must run the same image with
`FREEHOLDER_JOBS=on`; `pnpm doctor` warns when the current process has
workers disabled.

During `next build`, neither producer nor worker starts. In tests, workers are
off unless explicitly forced on, preventing maintenance schedules from racing
database fixtures.

## Failure and recovery checklist

1. Run `pnpm doctor` and verify the job registry is populated.
2. Confirm the worker process has database connectivity and is not configured
   with `FREEHOLDER_JOBS=off`.
3. Preserve both the `public` and `pgboss` schemas in database backups. A
   backup that excludes pg-boss can lose committed pending work.
4. Restart the worker. Active jobs whose leases lapse retry automatically;
   do not insert replacement rows by hand.
5. Open `/admin/jobs`, inspect the sanitized failure and fix the underlying
   code or configuration. Retry a retained failed/cancelled run, or redrive a
   dead letter, only after the cause is understood.
6. A repeated deterministic failure is code or configuration trouble. Raising
   its retry limit only delays the diagnosis.

Never log full job payloads merely to diagnose queue state. Payloads may carry
customer data; IDs, names, attempts, states and sanitized error messages are
the operational surface.
