---
"freeholder": minor
---

Make background work transactional and operationally bounded. Services now
insert pg-boss jobs in the same Postgres transaction as the business change
that caused them, so rolled-back work cannot run and committed work cannot be
lost between database commit and queue send.

Job definitions carry validated retry, exponential-backoff, global
concurrency, heartbeat lease, and history policies. Durable idempotency keys
deduplicate concurrent callers, reject payload mismatches, expire on a bounded
schedule, and return a stable job ID. Queued and active jobs support
transactional cancellation, deliberate retry, and cooperative cancellation at
safe handler boundaries. Outbound webhook fan-out now uses this contract.
