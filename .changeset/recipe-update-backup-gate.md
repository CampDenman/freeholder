---
"freeholder": patch
---

The Tier-1 recipe gate now enforces the tested backup the 2026-09-21 readiness repair requires. A recipe that wants to stay Tier 1 must declare `operations.backup` producing a custom-format PostgreSQL dump and `operations.restore` that restores it into a database, alongside its existing update/rollback strategy and immutable-pin checks — a rollback pin is only real if the data it returns to still exists (C10.10).
