---
"freeholder": minor
---

Make transactional event delivery durable per listener. Stable listener
identities, leased receipts, exponential retries, explicit unconsumed and
permanently failing dead letters, and 90-day retention replace the former
whole-event success marker.

Add a human-only event-delivery console with redacted detail and audited,
step-up-protected replay. Replay preserves completed receipts and queues only
unfinished listeners; webhook fan-out additionally deduplicates on the source
outbox event ID.
