---
"freeholder": minor
---

Move catalogue refresh and social ingest, health, Google Business Profile, and
publication provider calls out of service-owned database transactions. Human
and agent calls now atomically enqueue bounded jobs; workers perform network
work between short service-layer snapshot and apply transactions, with
idempotency, cancellation safe points, retry policy, audit-redacted provider
responses, and a source gate that prevents the long transactions returning.
