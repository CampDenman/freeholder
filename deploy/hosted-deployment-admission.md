<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Hosted deployment admission (C10.33)

This is an operator contract for one site's existing database and containers.
It does not grant site-management permissions, claim ownership, create an API
key, end a call, approve a purchase or authorize a deployment. Normal owner and
hosting authority remain required. An older image without the capability is
unsupported; a host must preserve its running service and refuse the cutover.

The accepted image exposes `io.freeholder.deployment.admission.version=1` and
the operator path `scripts/deployment-admission.mjs`. The trusted local operator
runs with the existing OS/Docker authority, as root inside the exact container,
and accepts at most4096 bytes of JSON on stdin. No public mutation endpoint,
UI action or MCP grant exists for this host-only maintenance operation. The
sanitized `/api/health/deployment` endpoint is read-only boot/schema evidence;
it explicitly does not claim ordinary job readiness.

The request fields are `action`, `operationId` (UUID), `token` (random32-byte
hex), `sourceRevision` (accepted image commit), plus `proof` only for resume or
release. The token stays in the host's private operation intent; the database
stores its SHA256. Normal stdout contains only version, own operation/source,
phase and finite work/runtime counts. Errors never copy a query, environment,
DSN, token, raw exception or customer payload into logs.

## State and safety

1. `begin` installs a durable, exclusive-operation hold under the same
   PostgreSQL transaction lock used by new member/group call admission and
   normal job enqueue/retry. Already-admitted transactions must commit before
   the hold returns, so a late call cannot disappear behind a stale snapshot.
   New starts receive a conflict. Existing calls retain End, answering,
   signaling, membership and call-key continuity; no proxy-wide503 is needed.
2. The canonical runtime stops new scheduling under the shared cron admission
   fence and drains accepted handlers through pg-boss `offWork(wait:true)`.
   It never uses a shutdown deadline as evidence that a handler completed.
   Accepted child jobs are reconciled by the existing runtime before its own
   operation-bound acknowledgment. A callback detached from a completed or
   failed handler cannot retain continuation authority indefinitely.
3. `status` reports actual calls, due/pending jobs, active jobs and runtime
   acknowledgments. Missing, stale, foreign, failed or unknown runtime evidence
   is a hold, never zero. The host waits; it cannot force End or cancel a job.
4. `seal` takes the same exclusive transaction lock, verifies actual zero work
   and all required runtime acknowledgments, and retains the durable hold.
   The host rechecks exact operation/source ownership immediately before
   stopping only its qualified container. New starts remain blocked while the
   candidate boots against the same database.
5. After proved public routing or exact private restoration, `resume` restarts
   canonical jobs while the operation still owns its call-admission hold.
   Ordinary `/api/health` must recover before final `release`. A resuming
   operation is never ready for another stop. Release accepts only this
   operation's token and matching `published` or `private_restored` proof.

There is no time-based automatic release and no automatic uncertain replay.
Timeout, ownership change, missing capability, query failure or lost ACK leaves
the hold for explicit reconciliation. It does not permit stopping another
container, resetting a counter or restoring an old database over new writes.
Historical hold records remain after release. An operation UUID that has been
released cannot be reused to begin a different attempt.

Each service module graph prepares and durably registers its canonical producer
before opening an outer mutation transaction. Transactional enqueue, retry,
cancel and redrive use only that prepared resident producer. Standalone seed or
maintenance code calls `prepareServiceJobRuntime()` **before** opening its own
transaction. They never bootstrap a second connection while their caller holds
the shared admission lock: an exclusive hold queued between those two shared
requests would create an application wait cycle. An unprepared direct queue
caller fails closed. A graph born into a hold starts no producer; pure End and
signaling still work, and new calls remain refused.

## Validation and remaining acceptance

Source controls must exercise real PostgreSQL transaction ordering, new-call
refusal, End/signaling continuity, exact operation ownership, unavailable work
inventory and runtime evidence, cron admission and detached callbacks. Runtime
tests must prove an actual pg-boss handler longer than the old shutdown grace
finishes without abort, including startup, dynamic queue registration, accepted
child jobs, late cron delivery and resumption. Fake-container tests additionally
inject a call during an awaited external authority check and require no stop.

These tests do not establish deployed acceptance. Normal hosted build, accepted
image/source and schema, actual private/public host operation, current owner
authority, ordinary readiness and shared consumer acceptance remain open in
`MASTER.md` §43 C10.33. Preserve existing private previews until those proofs
are complete.
