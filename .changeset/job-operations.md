---
"freeholder": minor
---

Add an owner-visible background-work ledger backed directly by retained
pg-boss runs. Owners can filter queue history, inspect recursively redacted
payloads and outputs, see retry/lease/lifecycle evidence, and receive overview
warnings for failed, dead-lettered, or lease-overdue work.

Every ordinary queue now routes exhausted work to a 90-day dead-letter queue
that preserves its source identity. Step-up-protected, typed-confirmation
controls cancel eligible work, retry retained failed/cancelled runs, or redrive
a diagnosed dead letter through audited service transactions. Agents and API
keys cannot inspect the cross-module payload ledger.
